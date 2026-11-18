// Copyright (C) 2026 WebSpeakerSim Contributors
// Ported from gll-tools (https://github.com/cwBudde/gll-tools), Copyright (c) Christian-W. Budde (MIT)
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Synthesizes `WebSpeakerSim` `SpeakerDefinition` models (including coherent multi-driver
 * `BoxType` summation, internal `FilterGroup` crossovers, `CaseGeometry` dimensions, and
 * measured `-6 dB` beamwidths) from parsed `EASE_GLL` containers.
 */

import { ISO_THIRD_OCTAVE_BANDS_HZ } from '@foh/acoustics';
import {
  DSP_REFERENCE_SAMPLE_RATE_HZ,
  type BiquadCoefficients,
  type ComplexSample,
  designBiquad,
  designCrossoverSections,
  evaluateBiquadCascade,
} from '@foh/dsp';
import {
  synthesizeParametricBalloon,
  type BalloonSymmetry,
  type DirectivityBalloon,
} from '../../../physics/directivity-balloon.js';
import { DEG_TO_RAD } from '../../../physics/transform3d.js';
import type {
  CabinetDimensionsMeters,
  SpeakerCategory,
  SpeakerDefinition,
} from '../../speaker-schema.js';
import type {
  GllBoxType,
  GllCaseGeometry,
  GllContainer,
  GllFilterGroup,
  GllIirFilterParams,
  GllSourceDefinitionItem,
} from './gll-container-parser.js';
import {
  GllSymmetryType,
  type GllTransferFunction,
  buildSpectrumFrequenciesHz,
  sampleGllBalloonComplexAtWssAngles,
} from './gll-spectrum-parser.js';

const SPEED_OF_SOUND_M_S = 343.0;

function interpolateTfComplexAtHz(tf: GllTransferFunction, freqHz: number): ComplexSample {
  const n = tf.levelDb.length;
  if (n === 0 || tf.definition.bandsPerOctave <= 0 || tf.definition.startFreqHz <= 0) {
    return { re: 1, im: 0 };
  }
  const idxFloat =
    tf.definition.bandsPerOctave * Math.log2(Math.max(1e-3, freqHz) / tf.definition.startFreqHz);
  const i0 = Math.max(0, Math.min(n - 1, Math.floor(idxFloat)));
  const i1 = Math.max(0, Math.min(n - 1, Math.ceil(idxFloat)));
  const frac = Math.max(0, Math.min(1, idxFloat - i0));

  const mag0 = Math.pow(10, tf.levelDb[i0] / 20);
  const mag1 = Math.pow(10, tf.levelDb[i1] / 20);
  const ph0 = (i0 < tf.phaseRad.length ? tf.phaseRad[i0] : 0) - 2 * Math.PI * freqHz * tf.delaySec;
  const ph1 = (i1 < tf.phaseRad.length ? tf.phaseRad[i1] : 0) - 2 * Math.PI * freqHz * tf.delaySec;

  const re = (1 - frac) * mag0 * Math.cos(ph0) + frac * mag1 * Math.cos(ph1);
  const im = (1 - frac) * mag0 * Math.sin(ph0) + frac * mag1 * Math.sin(ph1);
  return { re, im };
}

function compileIirSections(params: GllIirFilterParams): BiquadCoefficients[] {
  const sr = DSP_REFERENCE_SAMPLE_RATE_HZ;
  const fc = Math.max(10, Math.min(sr * 0.45, params.freqCritHz));
  const order = Math.max(1, Math.min(8, params.order));

  if (params.filterType === 0 || params.filterType === 1) {
    const mode = params.filterType === 0 ? 'lowpass' : 'highpass';
    const isLr = params.filterShape === 1;
    const topology = isLr
      ? order >= 6
        ? 'linkwitz-riley-48'
        : order >= 3
          ? 'linkwitz-riley-24'
          : 'linkwitz-riley-12'
      : order >= 6
        ? 'butterworth-48'
        : order === 4 || order === 5
          ? 'butterworth-24'
          : order === 3
            ? 'butterworth-18'
            : 'butterworth-12';
    return designCrossoverSections(mode, { topology, frequencyHz: fc }, sr);
  }

  const q = params.qFactor > 0 ? params.qFactor : Math.SQRT1_2;
  const gain = params.parametricGainDb;
  switch (params.filterType) {
    case 2:
      return [designBiquad('allpass', fc, sr, q, 0)];
    case 3:
    case 4:
      return [designBiquad('peaking', fc, sr, q, gain)];
    case 5:
      return [designBiquad('lowshelf', fc, sr, q, gain)];
    case 6:
      return [designBiquad('highshelf', fc, sr, q, gain)];
    default:
      return [];
  }
}

function evaluateFilterGroupAtHz(group: GllFilterGroup | undefined, freqHz: number): ComplexSample {
  if (!group) return { re: 1, im: 0 };
  let re = 1;
  let im = 0;

  for (const def of group.filters) {
    const bank = def.bank;
    if (!bank || bank.bypass) continue;
    if (bank.muteInput) return { re: 0, im: 0 };

    const bankGain = (bank.invertPolarity ? -1 : 1) * Math.pow(10, bank.gainDb / 20);
    const bankPhase = -2 * Math.PI * freqHz * bank.delaySec;
    const bRe = bankGain * Math.cos(bankPhase);
    const bIm = bankGain * Math.sin(bankPhase);
    const nextRe = re * bRe - im * bIm;
    const nextIm = re * bIm + im * bRe;
    re = nextRe;
    im = nextIm;

    for (const f of bank.filters) {
      if (f.bypass) continue;
      const fGain = (f.invertPolarity ? -1 : 1) * Math.pow(10, f.gainDb / 20);
      const fPhase = -2 * Math.PI * freqHz * f.delaySec;
      let cRe = fGain * Math.cos(fPhase);
      let cIm = fGain * Math.sin(fPhase);

      if (f.kind === 0 && f.logSpectrum) {
        const s = interpolateTfComplexAtHz(f.logSpectrum, freqHz);
        const tRe = cRe * s.re - cIm * s.im;
        const tIm = cRe * s.im + cIm * s.re;
        cRe = tRe;
        cIm = tIm;
      } else if (f.kind === 1 && f.iirParams) {
        const sections = compileIirSections(f.iirParams);
        const s = evaluateBiquadCascade(sections, freqHz, DSP_REFERENCE_SAMPLE_RATE_HZ);
        const tRe = cRe * s.re - cIm * s.im;
        const tIm = cRe * s.im + cIm * s.re;
        cRe = tRe;
        cIm = tIm;
      }

      const outRe = re * cRe - im * cIm;
      const outIm = re * cIm + im * cRe;
      re = outRe;
      im = outIm;
    }
  }

  return { re, im };
}

function inferDimensionsMeters(
  geom: GllCaseGeometry | null,
  category: SpeakerCategory
): CabinetDimensionsMeters {
  const fallback =
    category === 'subwoofer'
      ? { width: 0.58, height: 0.62, depth: 0.68 }
      : { width: 0.36, height: 0.6, depth: 0.35 };
  if (!geom || geom.vertices.length < 4) return fallback;

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;

  for (const v of geom.vertices) {
    if (v.x < minX) minX = v.x;
    if (v.x > maxX) maxX = v.x;
    if (v.y < minY) minY = v.y;
    if (v.y > maxY) maxY = v.y;
    if (v.z < minZ) minZ = v.z;
    if (v.z > maxZ) maxZ = v.z;
    if (geom.isSymmetric) {
      const mirroredY = 2 * geom.symmetryAxis - v.y;
      if (mirroredY < minY) minY = mirroredY;
      if (mirroredY > maxY) maxY = mirroredY;
    }
  }

  let spanX = maxX - minX;
  let spanY = maxY - minY;
  let spanZ = maxZ - minZ;
  const maxSpan = Math.max(spanX, spanY, spanZ);
  // Convert millimeters to meters if spans exceed 5 units
  const scale = maxSpan > 5.0 ? 0.001 : 1.0;
  spanX *= scale;
  spanY *= scale;
  spanZ *= scale;

  return {
    depth: spanX >= 0.08 && spanX <= 3.0 ? Number(spanX.toFixed(3)) : fallback.depth,
    width: spanY >= 0.08 && spanY <= 3.0 ? Number(spanY.toFixed(3)) : fallback.width,
    height: spanZ >= 0.08 && spanZ <= 3.0 ? Number(spanZ.toFixed(3)) : fallback.height,
  };
}

function measureBeamwidthDeg(
  balloon: DirectivityBalloon,
  plane: 'horizontal' | 'vertical'
): number {
  // Measure -6 dB full beamwidth around 2 kHz (or midpoint band for subwoofers)
  let bandIdx = Math.floor(balloon.frequenciesHz.length / 2);
  let bestDist = Number.POSITIVE_INFINITY;
  for (let k = 0; k < balloon.frequenciesHz.length; k++) {
    const dist = Math.abs(Math.log2(balloon.frequenciesHz[k] / 2000));
    if (dist < bestDist) {
      bestDist = dist;
      bandIdx = k;
    }
  }

  const M = balloon.meridianAnglesDeg.length;
  const P = balloon.polarAnglesDeg.length;
  const targetMer = plane === 'horizontal' ? 0 : 90;
  let mIdx = 0;
  let bestMerDiff = Number.POSITIVE_INFINITY;
  for (let m = 0; m < M; m++) {
    const diff = Math.abs(balloon.meridianAnglesDeg[m] - targetMer);
    if (diff < bestMerDiff) {
      bestMerDiff = diff;
      mIdx = m;
    }
  }

  let halfAngle = 180;
  for (let p = 1; p < P; p++) {
    const att = balloon.attenuationDb[(bandIdx * M + mIdx) * P + p];
    if (att <= -6.0) {
      const prevAtt = balloon.attenuationDb[(bandIdx * M + mIdx) * P + (p - 1)];
      const p0 = balloon.polarAnglesDeg[p - 1];
      const p1 = balloon.polarAnglesDeg[p];
      const frac = prevAtt > att ? (prevAtt - -6.0) / (prevAtt - att) : 0;
      halfAngle = p0 + Math.max(0, Math.min(1, frac)) * (p1 - p0);
      break;
    }
  }

  return Math.min(360, Math.max(20, Math.round(halfAngle * 2)));
}

function mapWssSymmetry(sources: readonly GllSourceDefinitionItem[], multiDriver: boolean): BalloonSymmetry {
  if (multiDriver) {
    // Vertically offset LF + HF drivers break vertical symmetry -> full 360 meridian grid preserves exact lobing
    return 'none';
  }
  const sym = sources[0]?.balloonData?.angularResolution.symmetry;
  if (sym === GllSymmetryType.Axial) return 'axial';
  if (sym === GllSymmetryType.Quarter) return 'quadrant';
  return 'none';
}

interface PlacedSourceEntry {
  readonly def: GllSourceDefinitionItem;
  readonly offsetM: { readonly x: number; readonly y: number; readonly z: number };
  readonly filterGroup?: GllFilterGroup;
}

function synthesizeCombinedBalloon(
  entries: readonly PlacedSourceEntry[],
  category: SpeakerCategory
): {
  readonly balloon: DirectivityBalloon;
  readonly sensitivityDbSpl: number;
  readonly low3dBHz: number;
  readonly high3dBHz: number;
} {
  const active = entries.filter((e) => e.def.balloonData && e.def.balloonData.responses.length > 0);
  if (active.length === 0) {
    const lowHz = entries[0]?.def.nominalBandwidthFromHz || (category === 'subwoofer' ? 35 : 55);
    const highHz = entries[0]?.def.nominalBandwidthToHz || (category === 'subwoofer' ? 120 : 20000);
    return {
      balloon: synthesizeParametricBalloon({
        category,
        horizontalDispersionDeg: category === 'subwoofer' ? 360 : 90,
        verticalDispersionDeg: category === 'subwoofer' ? 360 : 60,
        cabinetWidthM: category === 'subwoofer' ? 0.58 : 0.36,
        cabinetHeightM: category === 'subwoofer' ? 0.62 : 0.6,
        lowCutHz: lowHz,
        highCutHz: highHz,
      }),
      sensitivityDbSpl: entries[0]?.def.onAxisLevelDb > 40 ? entries[0].def.onAxisLevelDb : 98,
      low3dBHz: lowHz,
      high3dBHz: highHz,
    };
  }

  // Choose target frequency grid: use primary source's native grid if <= 72 bands, else 1/3-octave ISO grid
  const primaryResp = active[0].def.balloonData!.responses[0];
  const nativeFreqs = buildSpectrumFrequenciesHz(primaryResp.definition);
  const useNative =
    active.length === 1 &&
    nativeFreqs.length >= 8 &&
    nativeFreqs.length <= 72 &&
    nativeFreqs[0] >= 10;
  const frequenciesHz = useNative
    ? Float32Array.from(nativeFreqs)
    : Float32Array.from(ISO_THIRD_OCTAVE_BANDS_HZ);
  const F = frequenciesHz.length;

  const symmetry = mapWssSymmetry(
    active.map((a) => a.def),
    active.length > 1
  );
  const merStep = 10;
  const polStep = 5;
  const M = symmetry === 'axial' ? 1 : symmetry === 'quadrant' ? 10 : 36;
  const P = Math.round(180 / polStep) + 1;

  const meridianAnglesDeg = new Float32Array(M);
  for (let m = 0; m < M; m++) meridianAnglesDeg[m] = m * merStep;
  const polarAnglesDeg = new Float32Array(P);
  for (let p = 0; p < P; p++) polarAnglesDeg[p] = p * polStep;

  // Pre-evaluate per-source native balloon scratch buffers
  const sourceScratch = active.map((entry) => {
    const bDef = entry.def.balloonData!.responses[0].definition;
    const nBands = bDef.pointCount;
    const onAxisMatch =
      entry.def.onAxisSpectrum &&
      entry.def.onAxisSpectrum.levelDb.length === nBands &&
      entry.def.onAxisSpectrum.definition.bandsPerOctave === bDef.bandsPerOctave &&
      Math.abs(entry.def.onAxisSpectrum.definition.startFreqHz - bDef.startFreqHz) < 1e-3;
    return {
      entry,
      bDef,
      nBands,
      onAxisMatch: Boolean(onAxisMatch),
      re: new Float64Array(nBands),
      im: new Float64Array(nBands),
    };
  });

  const gridMagDb = new Float32Array(F * M * P);
  const gridPhaseRad = new Float32Array(F * M * P);

  for (let m = 0; m < M; m++) {
    const merDeg = meridianAnglesDeg[m];
    const merRad = merDeg * DEG_TO_RAD;
    for (let p = 0; p < P; p++) {
      const polDeg = polarAnglesDeg[p];
      const polRad = polDeg * DEG_TO_RAD;

      // Unit direction vector in WSS local cabinet frame (+x_L forward, +y_L left, +z_L top)
      const ux = Math.cos(polRad);
      const uy = Math.sin(polRad) * Math.cos(merRad);
      const uz = Math.sin(polRad) * Math.sin(merRad);

      for (const s of sourceScratch) {
        sampleGllBalloonComplexAtWssAngles(s.entry.def.balloonData!, merDeg, polDeg, s.re, s.im);
      }

      for (let k = 0; k < F; k++) {
        const freq = frequenciesHz[k];
        let sumRe = 0;
        let sumIm = 0;

        for (const s of sourceScratch) {
          // Interpolate source balloon across frequency if needed
          const idxFloat =
            s.bDef.bandsPerOctave * Math.log2(Math.max(1e-3, freq) / s.bDef.startFreqHz);
          const b0 = Math.max(0, Math.min(s.nBands - 1, Math.floor(idxFloat)));
          const b1 = Math.max(0, Math.min(s.nBands - 1, Math.ceil(idxFloat)));
          const frac = Math.max(0, Math.min(1, idxFloat - b0));

          let cRe = (1 - frac) * s.re[b0] + frac * s.re[b1];
          let cIm = (1 - frac) * s.im[b0] + frac * s.im[b1];

          // Multiply by OnAxisSpectrum when present (GLL Convention A)
          if (s.entry.def.onAxisSpectrum) {
            const oa = interpolateTfComplexAtHz(s.entry.def.onAxisSpectrum, freq);
            // Guard against hybrid files where both balloon[0] and OnAxisSpectrum already sit at ~90 dB
            const balloonOnAxisDb = s.entry.def.balloonData!.responses[0]?.levelDb[b0] ?? 0;
            if (balloonOnAxisDb < 40) {
              const tRe = cRe * oa.re - cIm * oa.im;
              const tIm = cRe * oa.im + cIm * oa.re;
              cRe = tRe;
              cIm = tIm;
            }
          }

          // Multiply by linked internal FilterGroup
          if (s.entry.filterGroup) {
            const fg = evaluateFilterGroupAtHz(s.entry.filterGroup, freq);
            const tRe = cRe * fg.re - cIm * fg.im;
            const tIm = cRe * fg.im + cIm * fg.re;
            cRe = tRe;
            cIm = tIm;
          }

          // Apply geometric path-difference phase from driver placement offset
          const pathDeltaM =
            s.entry.offsetM.x * ux + s.entry.offsetM.y * uy + s.entry.offsetM.z * uz;
          if (Math.abs(pathDeltaM) > 1e-6) {
            const geomPhase = (2 * Math.PI * freq * pathDeltaM) / SPEED_OF_SOUND_M_S;
            const cosP = Math.cos(geomPhase);
            const sinP = Math.sin(geomPhase);
            const tRe = cRe * cosP - cIm * sinP;
            const tIm = cRe * sinP + cIm * cosP;
            cRe = tRe;
            cIm = tIm;
          }

          sumRe += cRe;
          sumIm += cIm;
        }

        const mag = Math.hypot(sumRe, sumIm);
        const flatIdx = (k * M + m) * P + p;
        gridMagDb[flatIdx] = mag > 1e-10 ? 20 * Math.log10(mag) : -120;
        gridPhaseRad[flatIdx] = mag > 1e-10 ? Math.atan2(sumIm, sumRe) : 0;
      }
    }
  }

  // Extract on-axis curve (m=0, p=0), sensitivity, and normalize onAxisMagDb to peak = 0 dB
  const onAxisMagDb = new Float32Array(F);
  const onAxisPhaseRad = new Float32Array(F);
  const attenuationDb = new Float32Array(F * M * P);
  const offAxisPhaseRad = new Float32Array(F * M * P);

  let peakOnAxisDb = Number.NEGATIVE_INFINITY;
  for (let k = 0; k < F; k++) {
    const v = gridMagDb[(k * M + 0) * P + 0];
    onAxisMagDb[k] = v;
    onAxisPhaseRad[k] = gridPhaseRad[(k * M + 0) * P + 0];
    if (v > peakOnAxisDb) peakOnAxisDb = v;
  }

  for (let k = 0; k < F; k++) {
    const rawOn = onAxisMagDb[k];
    const rawPh = onAxisPhaseRad[k];
    for (let m = 0; m < M; m++) {
      for (let p = 0; p < P; p++) {
        const idx = (k * M + m) * P + p;
        attenuationDb[idx] = m === 0 && p === 0 ? 0 : Math.min(12, gridMagDb[idx] - rawOn);
        let dPh = gridPhaseRad[idx] - rawPh;
        while (dPh > Math.PI) dPh -= 2 * Math.PI;
        while (dPh < -Math.PI) dPh += 2 * Math.PI;
        offAxisPhaseRad[idx] = dPh;
      }
    }
    if (peakOnAxisDb > -100) {
      onAxisMagDb[k] -= peakOnAxisDb;
    }
  }

  // Derive passband -6 dB / -3 dB limits from normalized onAxisMagDb
  let low3dBHz = frequenciesHz[0];
  let high3dBHz = frequenciesHz[F - 1];
  for (let k = 0; k < F; k++) {
    if (onAxisMagDb[k] >= -3.5) {
      low3dBHz = frequenciesHz[k];
      break;
    }
  }
  for (let k = F - 1; k >= 0; k--) {
    if (onAxisMagDb[k] >= -3.5) {
      high3dBHz = frequenciesHz[k];
      break;
    }
  }

  const sensitivityDbSpl =
    peakOnAxisDb > 45 && peakOnAxisDb < 135
      ? Number(peakOnAxisDb.toFixed(1))
      : entries[0]?.def.onAxisLevelDb > 45
        ? Number(entries[0].def.onAxisLevelDb.toFixed(1))
        : 98;

  return {
    balloon: {
      frequenciesHz,
      symmetry,
      polarAnglesDeg,
      meridianAnglesDeg,
      onAxisMagDb,
      onAxisPhaseRad,
      attenuationDb,
      offAxisPhaseRad,
    },
    sensitivityDbSpl,
    low3dBHz: Math.round(low3dBHz),
    high3dBHz: Math.round(high3dBHz),
  };
}

function detectSpeakerCategory(
  name: string,
  container: GllContainer,
  sources: readonly GllSourceDefinitionItem[]
): SpeakerCategory {
  if (container.enableForSubArrays && /\b(sub|subwoofer|lf|b18|b21|sb|ks|800|900)\b/i.test(name)) {
    return 'subwoofer';
  }
  if (/\b(sub|subwoofer)\b/i.test(name)) {
    return 'subwoofer';
  }
  if (sources.length > 0) {
    const maxHigh = Math.max(...sources.map((s) => s.nominalBandwidthToHz || 0));
    if (maxHigh > 0 && maxHigh <= 250) {
      return 'subwoofer';
    }
  }
  return 'point-source';
}

function buildBoxSpeaker(
  box: GllBoxType,
  container: GllContainer,
  sourceMap: ReadonlyMap<string, GllSourceDefinitionItem>,
  filterMap: ReadonlyMap<string, GllFilterGroup>,
  fallbackFileName: string,
  index: number
): SpeakerDefinition | null {
  const linkBySourceKey = new Map<string, GllFilterGroup>();
  if (box.inputConfig) {
    for (const inp of box.inputConfig.inputs) {
      for (const link of inp.sourceLinks) {
        const fg = filterMap.get(link.filterGrpKey);
        if (fg) linkBySourceKey.set(link.sourceKey, fg);
      }
    }
  }

  const maxCoord = box.sourcePlacements.reduce(
    (acc, sp) =>
      Math.max(acc, Math.abs(sp.position.x), Math.abs(sp.position.y), Math.abs(sp.position.z)),
    0
  );
  const posScale = maxCoord > 5.0 ? 0.001 : 1.0;

  const placed: PlacedSourceEntry[] = [];
  for (const sp of box.sourcePlacements) {
    const def = sourceMap.get(sp.sourceDefKey);
    if (!def) continue;
    placed.push({
      def,
      // Convert GLL (+X front, +Y right, +Z up) -> WSS (+x_L front, +y_L left, +z_L up)
      offsetM: {
        x: (sp.position.x - box.referencePoint.x) * posScale,
        y: -(sp.position.y - box.referencePoint.y) * posScale,
        z: (sp.position.z - box.referencePoint.z) * posScale,
      },
      filterGroup: linkBySourceKey.get(sp.key),
    });
  }

  if (placed.length === 0) return null;

  const displayName =
    container.boxTypes.length === 1 && container.label && box.label !== container.label
      ? `${container.label} (${box.label})`
      : box.label || container.label || fallbackFileName.replace(/\.gll$/i, '');

  const category = detectSpeakerCategory(
    `${container.label} ${box.label}`,
    container,
    placed.map((p) => p.def)
  );
  const { balloon, sensitivityDbSpl, low3dBHz, high3dBHz } = synthesizeCombinedBalloon(
    placed,
    category
  );

  const hDeg =
    category === 'subwoofer'
      ? 360
      : box.horizontalOpeningDeg > 5
        ? Math.round(box.horizontalOpeningDeg)
        : measureBeamwidthDeg(balloon, 'horizontal');
  const vDeg =
    category === 'subwoofer'
      ? 360
      : box.verticalOpeningDeg > 5
        ? Math.round(box.verticalOpeningDeg)
        : measureBeamwidthDeg(balloon, 'vertical');

  const slug = (box.key || displayName)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return {
    id: `gll-${slug || 'box'}-${index + 1}`,
    name: displayName,
    manufacturer: container.company || placed[0].def.companyLabel || 'Imported GLL',
    category,
    origin: 'gll',
    description:
      container.infoText?.replace(/\/n/g, ' ').trim() ||
      `Imported EASE_GLL v${container.formatVersion} (${placed.length} acoustic source${placed.length > 1 ? 's' : ''}) from ${fallbackFileName}`,
    dimensionsMeters: inferDimensionsMeters(box.caseGeometry, category),
    acousticCenterOffset: { x: 0, y: 0, z: 0 },
    nominalDispersionDeg: {
      horizontal: hDeg,
      vertical: vDeg,
    },
    passbandHz: {
      low3dB: low3dBHz,
      high3dB: Math.max(low3dBHz + 40, high3dBHz),
    },
    sensitivity1W1mDbSpl: sensitivityDbSpl,
    maxContinuousSpl1mDb: Math.min(148, Math.round(sensitivityDbSpl + 33)),
    balloon,
  };
}

export function buildSpeakersFromGllContainer(
  container: GllContainer,
  fallbackFileName: string
): SpeakerDefinition[] {
  const sourceMap = new Map<string, GllSourceDefinitionItem>();
  for (const s of container.sourceDefinitions) {
    sourceMap.set(s.key, s);
  }
  const filterMap = new Map<string, GllFilterGroup>();
  for (const fg of container.filterGroups) {
    filterMap.set(fg.key, fg);
  }

  const speakers: SpeakerDefinition[] = [];
  for (let i = 0; i < container.boxTypes.length; i++) {
    const spk = buildBoxSpeaker(
      container.boxTypes[i],
      container,
      sourceMap,
      filterMap,
      fallbackFileName,
      i
    );
    if (spk) speakers.push(spk);
  }

  if (speakers.length > 0) {
    return speakers;
  }

  // Fallback when a GLL defines standalone SourceDefinitions without BoxTypes
  for (let i = 0; i < container.sourceDefinitions.length; i++) {
    const src = container.sourceDefinitions[i];
    const name = src.label || container.label || fallbackFileName.replace(/\.gll$/i, '');
    const category = detectSpeakerCategory(name, container, [src]);
    const { balloon, sensitivityDbSpl, low3dBHz, high3dBHz } = synthesizeCombinedBalloon(
      [{ def: src, offsetM: { x: 0, y: 0, z: 0 } }],
      category
    );
    const slug = (src.key || name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    speakers.push({
      id: `gll-${slug || 'src'}-${i + 1}`,
      name,
      manufacturer: container.company || src.companyLabel || 'Imported GLL',
      category,
      origin: 'gll',
      description:
        src.description ||
        container.infoText ||
        `Imported EASE_GLL v${container.formatVersion} source from ${fallbackFileName}`,
      dimensionsMeters: inferDimensionsMeters(null, category),
      acousticCenterOffset: { x: 0, y: 0, z: 0 },
      nominalDispersionDeg: {
        horizontal: category === 'subwoofer' ? 360 : measureBeamwidthDeg(balloon, 'horizontal'),
        vertical: category === 'subwoofer' ? 360 : measureBeamwidthDeg(balloon, 'vertical'),
      },
      passbandHz: {
        low3dB: low3dBHz,
        high3dB: Math.max(low3dBHz + 40, high3dBHz),
      },
      sensitivity1W1mDbSpl: sensitivityDbSpl,
      maxContinuousSpl1mDb: Math.min(148, Math.round(sensitivityDbSpl + 33)),
      balloon,
    });
  }

  return speakers;
}
