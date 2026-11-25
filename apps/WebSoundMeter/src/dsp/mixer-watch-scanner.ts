// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Lightweight 32-Channel Mixer Input Watch Scanner (`src/dsp/mixer-watch-scanner.ts`).
 *
 * Scans watched console USB inputs in pairs via `Radix2FFT.transformDualReal(4096, 'hann')`
 * with zero per-frame allocations, computing:
 *  - Per-channel broadband `dBFS` input levels for patch drawer signal-activity LEDs
 *  - Per-channel phase-coherent `FeedbackDetector` tracks + onset frame sequences
 *  - Causal zero-lag (`0..1.5 ms`) electrical coupling (`busCouplingScore`) to the Mix Bus
 *    so Pre-Fader muted spare mics picking up delayed (`>= 4 ms`) loudspeaker bleed are ignored
 *  - Narrowband in-phase loop projection (`Re(<R* Y_i>) / <|R|^2>`) for Post-Fader attribution
 */

import { Radix2FFT } from '@foh/dsp';
import {
  MAX_MIXER_WATCH_CHANNELS,
  MixerWatchChannelConfig,
  MixerWatchSessionConfig,
  createDefaultMixerWatchSessionConfig,
} from '../sources/mixer-patch-storage.js';
import {
  MixerChannelFeedbackObservation,
  MixerChannelTrackDetail,
} from './feedback-culprit-resolver.js';
import {
  FeedbackDetector,
  computeTrackMatchToleranceHz,
} from './feedback-detector.js';

const MIXER_FFT_SIZE = 4096;
const MIXER_BIN_COUNT = (MIXER_FFT_SIZE >>> 1) + 1;
const MIXER_RING_MASK = MIXER_FFT_SIZE - 1;
const MIXER_PALETTE = [
  '#f43f5e',
  '#f59e0b',
  '#10b981',
  '#a855f7',
  '#06b6d4',
  '#ec4899',
  '#84cc16',
  '#eab308',
] as const;

interface WatchedChannelRuntime {
  channelIndex: number;
  name: string;
  color: string;
  readonly circ: Float32Array;
  writePtr: number;
  samplesSinceTransform: number;
  rmsDbFs: number;
  busCouplingScore: number;
  readonly specRe: Float32Array;
  readonly specIm: Float32Array;
  readonly detector: FeedbackDetector;
}

export class MixerInputWatchScanner {
  private sampleRate: number;
  private config: MixerWatchSessionConfig = createDefaultMixerWatchSessionConfig();
  private readonly fft = new Radix2FFT(MIXER_FFT_SIZE, 'hann');
  private readonly channels = new Map<number, WatchedChannelRuntime>();

  private readonly busCirc = new Float32Array(MIXER_FFT_SIZE);
  private busWritePtr = 0;
  private busSamplesWritten = 0;
  private busRmsDbFs = -120;
  private hasActiveBus = false;

  private readonly blockA = new Float32Array(MIXER_FFT_SIZE);
  private readonly blockB = new Float32Array(MIXER_FFT_SIZE);
  private readonly busBlock = new Float32Array(MIXER_FFT_SIZE);
  private readonly zeroBlock = new Float32Array(MIXER_FFT_SIZE);
  private readonly busSpecRe = new Float32Array(MIXER_BIN_COUNT);
  private readonly busSpecIm = new Float32Array(MIXER_BIN_COUNT);
  private readonly dummySpecRe = new Float32Array(MIXER_BIN_COUNT);
  private readonly dummySpecIm = new Float32Array(MIXER_BIN_COUNT);

  constructor(sampleRate: number = 48000) {
    this.sampleRate = sampleRate;
  }

  setSampleRate(sampleRate: number): void {
    if (sampleRate > 0 && sampleRate !== this.sampleRate) {
      this.sampleRate = sampleRate;
      this.reset();
    }
  }

  getSampleRate(): number {
    return this.sampleRate;
  }

  getConfig(): MixerWatchSessionConfig {
    return this.config;
  }

  updateConfig(next: MixerWatchSessionConfig): void {
    const prevEnabled = this.config.enabled;
    const prevTapMode = this.config.patch.tapMode;
    this.config = next;

    if (!next.enabled) {
      this.channels.clear();
      this.resetBus();
      return;
    }

    const enabledList: MixerWatchChannelConfig[] = [];
    for (const ch of next.patch.channels) {
      if (ch.enabled && ch.channelIndex >= 0) {
        enabledList.push(ch);
        if (enabledList.length >= MAX_MIXER_WATCH_CHANNELS) break;
      }
    }

    const keepIndices = new Set(enabledList.map((c) => c.channelIndex));
    for (const existingIdx of Array.from(this.channels.keys())) {
      if (!keepIndices.has(existingIdx)) {
        this.channels.delete(existingIdx);
      }
    }

    for (const chCfg of enabledList) {
      const existing = this.channels.get(chCfg.channelIndex);
      if (existing) {
        existing.name = chCfg.name;
        existing.detector.setMode(next.sensitivity);
        if (!prevEnabled || prevTapMode !== next.patch.tapMode) {
          existing.busCouplingScore = 0.5;
        }
      } else {
        const color = MIXER_PALETTE[chCfg.channelIndex % MIXER_PALETTE.length];
        this.channels.set(chCfg.channelIndex, {
          channelIndex: chCfg.channelIndex,
          name: chCfg.name,
          color,
          circ: new Float32Array(MIXER_FFT_SIZE),
          writePtr: 0,
          samplesSinceTransform: 0,
          rmsDbFs: -120,
          busCouplingScore: 0.5,
          specRe: new Float32Array(MIXER_BIN_COUNT),
          specIm: new Float32Array(MIXER_BIN_COUNT),
          detector: new FeedbackDetector(next.sensitivity, 'closed-loop-mix'),
        });
      }
    }
  }

  reset(): void {
    for (const rt of this.channels.values()) {
      rt.circ.fill(0);
      rt.writePtr = 0;
      rt.samplesSinceTransform = 0;
      rt.rmsDbFs = -120;
      rt.busCouplingScore = 0.5;
      rt.detector.reset();
    }
    this.resetBus();
  }

  private resetBus(): void {
    this.busCirc.fill(0);
    this.busWritePtr = 0;
    this.busSamplesWritten = 0;
    this.busRmsDbFs = -120;
    this.hasActiveBus = false;
  }

  /**
   * Feeds multi-channel sample blocks mapped via `channelTapMap` (physical channel -> tap buffer index).
   */
  writeHardwareSamples(
    tapBuffers: readonly Float32Array[],
    channelTapMap: Readonly<Record<number, number>>,
    sampleCount: number,
    effectiveMixBusChannel: number
  ): void {
    if (!this.config.enabled || sampleCount <= 0) return;

    for (const rt of this.channels.values()) {
      const tapIdx = channelTapMap[rt.channelIndex];
      const src = tapIdx !== undefined ? tapBuffers[tapIdx] : undefined;
      this.appendChannelSamples(rt, src, sampleCount);
    }

    if (effectiveMixBusChannel >= 0) {
      const busTap = channelTapMap[effectiveMixBusChannel];
      const busSrc = busTap !== undefined ? tapBuffers[busTap] : undefined;
      this.appendBusSamples(busSrc, sampleCount);
    } else {
      this.hasActiveBus = false;
    }
  }

  /**
   * Direct channel injection helper used by Demo Simulator and unit tests (`physicalChannel -> Float32Array`).
   */
  writeDirectChannelMap(
    channelDataByIndex: ReadonlyMap<number, Float32Array>,
    sampleCount: number,
    busSamples?: Float32Array
  ): void {
    if (!this.config.enabled || sampleCount <= 0) return;
    for (const rt of this.channels.values()) {
      this.appendChannelSamples(rt, channelDataByIndex.get(rt.channelIndex), sampleCount);
    }
    if (busSamples) {
      this.appendBusSamples(busSamples, sampleCount);
    } else {
      this.hasActiveBus = false;
    }
  }

  private appendChannelSamples(
    rt: WatchedChannelRuntime,
    src: Float32Array | undefined,
    sampleCount: number
  ): void {
    let sumSq = 0;
    let ptr = rt.writePtr;
    const circ = rt.circ;
    if (src && src.length >= sampleCount) {
      for (let i = 0; i < sampleCount; i++) {
        const s = src[i];
        sumSq += s * s;
        circ[ptr] = s;
        ptr = (ptr + 1) & MIXER_RING_MASK;
      }
    } else {
      for (let i = 0; i < sampleCount; i++) {
        circ[ptr] = 0;
        ptr = (ptr + 1) & MIXER_RING_MASK;
      }
    }
    rt.writePtr = ptr;
    rt.samplesSinceTransform += sampleCount;
    const blockDb =
      sumSq > 1e-20 ? 10.0 * Math.log10(sumSq / sampleCount) : -120.0;
    rt.rmsDbFs = rt.rmsDbFs <= -119 ? blockDb : 0.65 * rt.rmsDbFs + 0.35 * blockDb;
  }

  private appendBusSamples(src: Float32Array | undefined, sampleCount: number): void {
    let sumSq = 0;
    let ptr = this.busWritePtr;
    if (src && src.length >= sampleCount) {
      for (let i = 0; i < sampleCount; i++) {
        const s = src[i];
        sumSq += s * s;
        this.busCirc[ptr] = s;
        ptr = (ptr + 1) & MIXER_RING_MASK;
      }
    } else {
      for (let i = 0; i < sampleCount; i++) {
        this.busCirc[ptr] = 0;
        ptr = (ptr + 1) & MIXER_RING_MASK;
      }
    }
    this.busWritePtr = ptr;
    this.busSamplesWritten += sampleCount;
    const blockDb =
      sumSq > 1e-20 ? 10.0 * Math.log10(sumSq / sampleCount) : -120.0;
    this.busRmsDbFs =
      this.busRmsDbFs <= -119 ? blockDb : 0.65 * this.busRmsDbFs + 0.35 * blockDb;
    this.hasActiveBus = this.busRmsDbFs > -60.0;
  }

  private extractRingWindow(
    circ: Float32Array,
    writePtr: number,
    out: Float32Array
  ): void {
    const start = (writePtr - MIXER_FFT_SIZE) & MIXER_RING_MASK;
    const first = MIXER_FFT_SIZE - start;
    out.set(circ.subarray(start, MIXER_FFT_SIZE), 0);
    if (first < MIXER_FFT_SIZE) {
      out.set(circ.subarray(0, MIXER_FFT_SIZE - first), first);
    }
  }

  private isSpectrumTonallyDominated(specRe: Float32Array, specIm: Float32Array): boolean {
    let totalPow = 0;
    let maxNeighborhoodPow = 0;
    for (let k = 4; k < MIXER_BIN_COUNT - 4; k++) {
      const p0 = specRe[k] * specRe[k] + specIm[k] * specIm[k];
      totalPow += p0;
      const pTriplet =
        p0 +
        specRe[k - 1] * specRe[k - 1] +
        specIm[k - 1] * specIm[k - 1] +
        specRe[k + 1] * specRe[k + 1] +
        specIm[k + 1] * specIm[k + 1];
      if (pTriplet > maxNeighborhoodPow) {
        maxNeighborhoodPow = pTriplet;
      }
    }
    return totalPow > 1e-12 && maxNeighborhoodPow > 0.3 * totalPow;
  }

  /**
   * Updates causal `0..1.5 ms` electrical coupling score between `chBlock` and `busBlock`
   * during non-sinusoidal broadband program frames so muted pre-fader mics sitting near
   * loudspeakers (`>= 4 ms` air delay) converge toward 0 coupling.
   */
  private updateCausalBusCoupling(
    rt: WatchedChannelRuntime,
    chBlock: Float32Array,
    hasActiveTrack: boolean
  ): void {
    if (!this.hasActiveBus || this.config.patch.tapMode !== 'pre-fader') {
      rt.busCouplingScore = 1.0;
      return;
    }
    // Freeze coupling estimate whenever a narrowband tone/candidate is present (sinusoids correlate periodically at all lags!)
    if (hasActiveTrack || this.isSpectrumTonallyDominated(rt.specRe, rt.specIm)) {
      return;
    }
    if (this.busRmsDbFs < -55.0) {
      return;
    }
    if (rt.rmsDbFs < -65.0) {
      // Mix bus is active while this channel is silent -> slightly decay coupling
      rt.busCouplingScore = Math.max(0.05, rt.busCouplingScore * 0.96);
      return;
    }

    // Evaluate normalized cross-correlation over latest 512 samples (decimated by 2) at causal electrical lags 0..1.5 ms
    const winStart = MIXER_FFT_SIZE - 512;
    const maxElecLag = Math.max(16, Math.round(0.0015 * this.sampleRate)); // ~72 samples @ 48 kHz
    const lagStep = Math.max(4, Math.floor(maxElecLag / 3));

    let eBus = 0;
    let eCh = 0;
    for (let n = winStart; n < MIXER_FFT_SIZE; n += 2) {
      const b = this.busBlock[n];
      const x = chBlock[n];
      eBus += b * b;
      eCh += x * x;
    }
    const denom = Math.sqrt(eBus * eCh);
    if (denom < 1e-9) return;

    let bestCorr = 0;
    for (let lag = 0; lag <= maxElecLag; lag += lagStep) {
      let dot = 0;
      for (let n = winStart; n < MIXER_FFT_SIZE; n += 2) {
        dot += chBlock[n - lag] * this.busBlock[n];
      }
      const corr = Math.abs(dot) / denom;
      if (corr > bestCorr) {
        bestCorr = corr;
      }
    }

    if (bestCorr >= 0.25) {
      const target = Math.min(1.0, bestCorr * 1.45);
      rt.busCouplingScore = 0.7 * rt.busCouplingScore + 0.3 * target;
    } else {
      // Channel has audio while bus has audio, yet zero electrical 0..1.5ms correlation -> delayed room bleed on muted/unrouted mic!
      rt.busCouplingScore = Math.max(0.02, rt.busCouplingScore * 0.82);
    }
  }

  /**
   * Runs one 40 ms analysis tick across all enabled watched channels and returns culprit observations + dBFS levels.
   */
  processTick(dtSeconds: number = 0.04): {
    readonly observations: MixerChannelFeedbackObservation[];
    readonly channelLevelsDbFs: Record<number, number>;
    readonly hasActiveMixBus: boolean;
    readonly enabledChannelCount: number;
  } {
    const channelLevelsDbFs: Record<number, number> = {};
    if (!this.config.enabled || this.channels.size === 0) {
      return {
        observations: [],
        channelLevelsDbFs,
        hasActiveMixBus: false,
        enabledChannelCount: 0,
      };
    }

    if (this.hasActiveBus && this.busSamplesWritten > 0) {
      this.extractRingWindow(this.busCirc, this.busWritePtr, this.busBlock);
      this.fft.transformDualReal(
        this.busBlock,
        this.zeroBlock,
        this.busSpecRe,
        this.busSpecIm,
        this.dummySpecRe,
        this.dummySpecIm,
        true
      );
      this.busSamplesWritten = 0;
    }

    const rtList = Array.from(this.channels.values());
    const dtMs = Math.round(dtSeconds * 1000);
    const df = this.sampleRate / MIXER_FFT_SIZE;
    const observations: MixerChannelFeedbackObservation[] = [];

    for (let i = 0; i < rtList.length; i += 2) {
      const chA = rtList[i];
      const chB = rtList[i + 1];

      this.extractRingWindow(chA.circ, chA.writePtr, this.blockA);
      if (chB) {
        this.extractRingWindow(chB.circ, chB.writePtr, this.blockB);
        this.fft.transformDualReal(
          this.blockA,
          this.blockB,
          chA.specRe,
          chA.specIm,
          chB.specRe,
          chB.specIm,
          true
        );
      } else {
        this.fft.transformDualReal(
          this.blockA,
          this.zeroBlock,
          chA.specRe,
          chA.specIm,
          this.dummySpecRe,
          this.dummySpecIm,
          true
        );
      }

      this.evaluateSingleChannel(chA, this.blockA, dtMs, df, channelLevelsDbFs, observations);
      if (chB) {
        this.evaluateSingleChannel(
          chB,
          this.blockB,
          dtMs,
          df,
          channelLevelsDbFs,
          observations
        );
      }
    }

    return {
      observations,
      channelLevelsDbFs,
      hasActiveMixBus: this.hasActiveBus,
      enabledChannelCount: rtList.length,
    };
  }

  private evaluateSingleChannel(
    rt: WatchedChannelRuntime,
    timeBlock: Float32Array,
    dtMs: number,
    df: number,
    levelsOut: Record<number, number>,
    obsOut: MixerChannelFeedbackObservation[]
  ): void {
    levelsOut[rt.channelIndex] = Math.round(rt.rmsDbFs * 10) / 10;
    const hop = rt.samplesSinceTransform;
    rt.samplesSinceTransform = 0;

    const tracks = rt.detector.processFrame({
      slotId: `mixer-ch-${rt.channelIndex}`,
      slotName: rt.name,
      slotColor: rt.color,
      sampleRate: this.sampleRate,
      fftSize: MIXER_FFT_SIZE,
      splOffsetDb: 100.0,
      dtMs,
      specMRe: rt.specRe,
      specMIm: rt.specIm,
      ...(this.hasActiveBus
        ? {
            specRRe: this.busSpecRe,
            specRIm: this.busSpecIm,
            referenceRmsDb: this.busRmsDbFs,
          }
        : {}),
      hopSamples: hop,
      module: this.dummySpecRe,
      refMode: 'closed-loop-mix',
    });

    const hasActiveRing = rt.detector.hasAnyCandidateOrActiveTrack();
    this.updateCausalBusCoupling(rt, timeBlock, hasActiveRing);

    if (tracks.length === 0) return;

    const details: MixerChannelTrackDetail[] = tracks.map((track) => {
      const tolHz = computeTrackMatchToleranceHz(track.frequencyHz, df);
      const onsetSeq = rt.detector.getTrackOnsetSeqNear(track.frequencyHz, tolHz) ?? 0;

      let inPhaseBusShare: number | undefined;
      if (this.hasActiveBus) {
        const k = Math.max(1, Math.min(MIXER_BIN_COUNT - 2, Math.round(track.frequencyHz / df)));
        let sumCrossRe = 0;
        let sumBusPow = 0;
        for (let b = k - 1; b <= k + 1; b++) {
          const rRe = this.busSpecRe[b];
          const rIm = this.busSpecIm[b];
          const yRe = rt.specRe[b];
          const yIm = rt.specIm[b];
          sumCrossRe += rRe * yRe + rIm * yIm;
          sumBusPow += rRe * rRe + rIm * rIm;
        }
        if (sumBusPow > 1e-12) {
          inPhaseBusShare = sumCrossRe / sumBusPow;
        }
      }

      return {
        track,
        onsetSeq,
        ...(inPhaseBusShare !== undefined ? { inPhaseBusShare } : {}),
      };
    });

    obsOut.push({
      channelIndex: rt.channelIndex,
      channelName: rt.name,
      busCouplingScore: rt.busCouplingScore,
      details,
    });
  }
}
