// Copyright (C) 2026 WebSpeakerSim Contributors
// Ported from gll-tools (https://github.com/cwBudde/gll-tools), Copyright (c) Christian-W. Budde (MIT)
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Structured `EGLL` (`EASE_GLL` v3–v6) binary container parser (`Header`, `GenSystem`,
 * `Database`, `BoxTypes`, `CaseGeometry`, `BoxInputConfig`, `SourceDefinitions`, `FilterGroups`).
 */

import {
  GLL_FORMAT_ID,
  GLL_MAGIC,
  GllByteReader,
  parseBufferItems,
} from './gll-binary-reader.js';
import {
  type GllBalloonData,
  type GllTransferFunction,
  parseBalloonData,
  parseCLogSpectrumLP,
  parseTransferFunctionLsPs,
} from './gll-spectrum-parser.js';

export const enum GllSystemType {
  LineArray = 0,
  Cluster = 1,
  Loudspeaker = 2,
}

export interface GllVec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface GllSourceFilterLink {
  readonly sourceKey: string;
  readonly filterGrpKey: string;
}

export interface GllBoxInput {
  readonly label: string;
  readonly ratedImpedanceOhms: number;
  readonly sourceLinks: readonly GllSourceFilterLink[];
}

export interface GllBoxInputConfig {
  readonly label: string;
  readonly key: string;
  readonly inputs: readonly GllBoxInput[];
}

export interface GllBoxSourcePlacement {
  readonly label: string;
  readonly key: string;
  readonly sourceDefKey: string;
  readonly position: GllVec3;
  readonly anglesRad: GllVec3;
}

export interface GllCaseGeometry {
  readonly isSymmetric: boolean;
  readonly symmetryAxis: number;
  readonly vertices: readonly GllVec3[];
}

export interface GllBoxType {
  readonly label: string;
  readonly key: string;
  readonly sourcePlacements: readonly GllBoxSourcePlacement[];
  readonly inputConfig: GllBoxInputConfig | null;
  readonly caseGeometry: GllCaseGeometry | null;
  readonly referencePoint: GllVec3;
  readonly weightKg: number;
  readonly horizontalOpeningDeg: number;
  readonly verticalOpeningDeg: number;
}

export interface GllSourceDefinitionItem {
  readonly key: string;
  readonly label: string;
  readonly companyLabel: string;
  readonly description: string;
  readonly nominalBandwidthFromHz: number;
  readonly nominalBandwidthToHz: number;
  readonly dataType: number;
  readonly balloonData: GllBalloonData | null;
  readonly onAxisLevelDb: number;
  readonly onAxisSpectrum: GllTransferFunction | null;
}

export interface GllIirFilterParams {
  readonly filterType: number; // 0=LP, 1=HP, 2=AP, 3=Peak, 4=PeakSym, 5=LS, 6=HS
  readonly filterShape: number; // 0=Butterworth, 1=LinkwitzRiley, 2=Bessel, 3=SallenKey
  readonly order: number;
  readonly freqCritHz: number;
  readonly alignment: number;
  readonly qFactor: number;
  readonly parametricGainDb: number;
}

export interface GllBaseFilter {
  readonly kind: number; // 0=LogSpectrum, 1=IIR, 2=FIR
  readonly label: string;
  readonly key: string;
  readonly bypass: boolean;
  readonly invertPolarity: boolean;
  readonly gainDb: number;
  readonly delaySec: number;
  readonly logSpectrum: GllTransferFunction | null;
  readonly iirParams: GllIirFilterParams | null;
}

export interface GllFilterBank {
  readonly bypass: boolean;
  readonly invertPolarity: boolean;
  readonly muteInput: boolean;
  readonly gainDb: number;
  readonly delaySec: number;
  readonly filters: readonly GllBaseFilter[];
}

export interface GllFilterGroup {
  readonly label: string;
  readonly key: string;
  readonly filters: ReadonlyArray<{
    readonly label: string;
    readonly key: string;
    readonly bank: GllFilterBank | null;
  }>;
}

export interface GllContainer {
  readonly formatVersion: number;
  readonly subVersion: number;
  readonly label: string;
  readonly key: string;
  readonly systemType: GllSystemType;
  readonly company: string;
  readonly infoText: string;
  readonly copyrightText: string;
  readonly websiteText: string;
  readonly enableForSubArrays: boolean;
  readonly boxTypes: readonly GllBoxType[];
  readonly sourceDefinitions: readonly GllSourceDefinitionItem[];
  readonly filterGroups: readonly GllFilterGroup[];
}

function parseDataFileBuffer(br: GllByteReader, maxOffset: number): void {
  if (br.offset >= maxOffset) return;
  const count = br.readInt32();
  if (count <= 0) return;
  for (let i = 0; i < count; i++) {
    if (br.offset >= maxOffset) break;
    const entrySize = br.readInt32();
    if (entrySize <= 0) break;
    br.seek(Math.min(maxOffset, br.offset + entrySize - 4));
  }
}

function parseBoxInputConfig(br: GllByteReader, maxOffset: number): GllBoxInputConfig | null {
  if (br.offset >= maxOffset) return null;
  const outerSize = br.readInt32();
  if (outerSize <= 0) return null;
  const outerEnd = Math.min(maxOffset, br.offset + outerSize - 4);
  try {
    const cfgSize = br.readInt32();
    if (cfgSize <= 0) return null;
    const cfgEnd = Math.min(outerEnd, br.offset + cfgSize - 4);
    try {
      if (br.readInt16() !== 0) return null;
      br.readInt16(); // sver
      const label = br.readString();
      const key = br.readString();
      const inputs = parseBufferItems<GllBoxInput>(br, cfgEnd, 0, (r, bufEnd) => {
        const blk = r.readInt32();
        if (blk <= 0) return null;
        const end = Math.min(bufEnd, r.offset + blk - 4);
        try {
          if (r.readInt16() !== 0) return null;
          const sver = r.readInt16();
          const inLabel = r.readString();
          const linkCount = r.readInt32();
          const sourceLinks: GllSourceFilterLink[] = [];
          for (let i = 0; i < linkCount && i < 1000; i++) {
            sourceLinks.push({
              sourceKey: r.readString(),
              filterGrpKey: r.readString(),
            });
          }
          const ratedImpedanceOhms = sver >= 1 && r.offset + 8 <= end ? r.readFloat64() : 8.0;
          return { label: inLabel, ratedImpedanceOhms, sourceLinks };
        } finally {
          r.seek(end);
        }
      });
      return { label, key, inputs };
    } finally {
      br.seek(cfgEnd);
    }
  } finally {
    br.seek(outerEnd);
  }
}

function parseCaseGeometry(br: GllByteReader, maxOffset: number): GllCaseGeometry | null {
  if (br.offset >= maxOffset) return null;
  const blockSize = br.readInt32();
  if (blockSize <= 0) return null;
  const endOffset = Math.min(maxOffset, br.offset + blockSize - 4);
  try {
    if (br.readInt16() !== 0) return null;
    br.readInt16(); // subVersion
    const isSymmetric = br.readInt32() !== 0;
    const symmetryAxis = br.readFloat64();
    const vertices = parseBufferItems<GllVec3>(br, endOffset, 0, (r, bufEnd) => {
      const vSize = r.readInt32();
      if (vSize <= 0) return null;
      const vEnd = Math.min(bufEnd, r.offset + vSize - 4);
      try {
        if (r.readInt16() !== 0) return null;
        r.readInt16();
        r.readInt32(); // color
        return r.readVector3D();
      } finally {
        r.seek(vEnd);
      }
    });
    return { isSymmetric, symmetryAxis, vertices };
  } catch {
    return null;
  } finally {
    br.seek(endOffset);
  }
}

function parseBoxTypes(br: GllByteReader, maxOffset: number): GllBoxType[] {
  return parseBufferItems<GllBoxType>(br, maxOffset, 0, (r, bufEnd) => {
    const blockSize = r.readInt32();
    if (blockSize <= 0) return null;
    const endOffset = Math.min(bufEnd, r.offset + blockSize - 4);
    try {
      if (r.readInt16() !== 0) return null;
      const subVersion = r.readInt16();
      const label = r.readString();
      const key = r.readString();

      const sourcePlacements = parseBufferItems<GllBoxSourcePlacement>(
        r,
        endOffset,
        0,
        (sr, sBufEnd) => {
          const sSize = sr.readInt32();
          if (sSize <= 0) return null;
          const sEnd = Math.min(sBufEnd, sr.offset + sSize - 4);
          try {
            if (sr.readInt16() !== 0) return null;
            sr.readInt16();
            const sourceDefKey = sr.readString();
            const position = sr.readVector3D();
            const anglesRad = sr.readVector3D();
            const sLabel = sr.readString();
            const sKey = sr.readString();
            return { label: sLabel, key: sKey, sourceDefKey, position, anglesRad };
          } finally {
            sr.seek(sEnd);
          }
        }
      );

      const inputConfig = parseBoxInputConfig(r, endOffset);
      const caseGeometry = parseCaseGeometry(r, endOffset);
      const _nextPivot = r.offset + 24 <= endOffset ? r.readVector3D() : { x: 0, y: 0, z: 0 };
      void _nextPivot;
      const referencePoint =
        r.offset + 24 <= endOffset ? r.readVector3D() : { x: 0, y: 0, z: 0 };
      const _com = r.offset + 24 <= endOffset ? r.readVector3D() : { x: 0, y: 0, z: 0 };
      void _com;
      const weightKg = r.offset + 8 <= endOffset ? r.readFloat64() : 0;

      let verticalOpeningDeg = 0;
      let horizontalOpeningDeg = 0;
      if (subVersion >= 1 && r.offset + 16 <= endOffset) {
        verticalOpeningDeg = r.readFloat64();
        horizontalOpeningDeg = r.readFloat64();
      }

      return {
        label,
        key,
        sourcePlacements,
        inputConfig,
        caseGeometry,
        referencePoint,
        weightKg,
        horizontalOpeningDeg,
        verticalOpeningDeg,
      };
    } finally {
      r.seek(endOffset);
    }
  });
}

function parseSourceDefinitions(br: GllByteReader, maxOffset: number): GllSourceDefinitionItem[] {
  return parseBufferItems<GllSourceDefinitionItem>(br, maxOffset, 0, (r, bufEnd) => {
    const itemSize = r.readInt32();
    if (itemSize <= 0) return null;
    const itemEnd = Math.min(bufEnd, r.offset + itemSize - 4);
    try {
      if (r.readInt16() !== 0) return null;
      r.readInt16(); // item sver
      const key = r.readString();

      const defSize = r.readInt32();
      if (defSize <= 0) return null;
      const defEnd = Math.min(itemEnd, r.offset + defSize - 4);
      try {
        const versionCheck = r.readInt16();
        if (versionCheck < 0 || versionCheck > 5) return null;
        r.readInt16(); // def sver
        const label = r.readString();
        const companyLabel = r.readString();
        const description = r.readString();
        const nominalBandwidthFromHz = r.readFloat64();
        const nominalBandwidthToHz = r.readFloat64();
        const dataType = r.readInt32();

        const balloonData = parseBalloonData(r, defEnd);

        let onAxisLevelDb = 0;
        let onAxisSpectrum: GllTransferFunction | null = null;
        if (r.offset + 12 <= defEnd) {
          try {
            const onAxisFlags = r.readInt32();
            onAxisLevelDb = r.readFloat64();
            if ((onAxisFlags & 1) !== 0) {
              r.skipBlock(defEnd);
            }
            if (r.offset + 4 <= defEnd) {
              onAxisSpectrum =
                versionCheck < 4 ? parseCLogSpectrumLP(r) : parseTransferFunctionLsPs(r);
            }
          } catch {
            // Optional on-axis spectrum absent or truncated
          }
        }

        return {
          key,
          label,
          companyLabel,
          description,
          nominalBandwidthFromHz,
          nominalBandwidthToHz,
          dataType,
          balloonData,
          onAxisLevelDb,
          onAxisSpectrum,
        };
      } finally {
        r.seek(defEnd);
      }
    } finally {
      r.seek(itemEnd);
    }
  });
}

function parseBaseFilterHeader(br: GllByteReader, maxOffset: number) {
  const blockSize = br.readInt32();
  if (blockSize <= 0) {
    return { bypass: false, invertPolarity: false, gainDb: 0, delaySec: 0, label: '', key: '' };
  }
  const endOffset = Math.min(maxOffset, br.offset + blockSize - 4);
  try {
    if (br.readInt16() !== 0) {
      return { bypass: false, invertPolarity: false, gainDb: 0, delaySec: 0, label: '', key: '' };
    }
    br.readInt16();
    br.readInt32(); // reserved
    const bypass = br.readInt32() !== 0;
    const invertPolarity = br.readInt32() !== 0;
    const gainDb = br.readFloat64();
    const delaySec = br.readFloat64();
    const label = br.readString();
    const key = br.readString();
    return { bypass, invertPolarity, gainDb, delaySec, label, key };
  } finally {
    br.seek(endOffset);
  }
}

function parseGenericFilterBank(br: GllByteReader, maxOffset: number): GllFilterBank | null {
  if (br.offset >= maxOffset) return null;
  const blockSize = br.readInt32();
  if (blockSize <= 0) return null;
  const endOffset = Math.min(maxOffset, br.offset + blockSize - 4);
  try {
    if (br.readInt16() !== 0) return null;
    const sver = br.readInt16();
    br.readInt32(); // reserved
    const bypass = br.readInt32() !== 0;
    const invertPolarity = br.readInt32() !== 0;
    const gainDb = br.readFloat64();
    const delaySec = br.readFloat64();

    const filters: GllBaseFilter[] = [];
    if (br.offset < endOffset) {
      const bufSize = br.readInt32();
      if (bufSize > 0) {
        const bufEnd = Math.min(endOffset, br.offset + bufSize - 4);
        try {
          if (br.readInt16() === 0) {
            br.readInt16();
            const count = br.readInt32();
            for (let i = 0; i < count && br.offset < bufEnd; i++) {
              const kind = br.readInt32();
              const fSize = br.readInt32();
              if (fSize <= 0) break;
              const fEnd = Math.min(bufEnd, br.offset + fSize - 4);
              try {
                const fVCheck = br.readInt16();
                br.readInt16();
                const base = parseBaseFilterHeader(br, fEnd);
                let logSpectrum: GllTransferFunction | null = null;
                let iirParams: GllIirFilterParams | null = null;
                if (kind === 0 && (fVCheck === 0 || fVCheck === 1) && br.offset < fEnd) {
                  logSpectrum =
                    fVCheck === 0 ? parseCLogSpectrumLP(br) : parseTransferFunctionLsPs(br);
                } else if (kind === 1 && fVCheck === 0 && br.offset < fEnd) {
                  const pSize = br.readInt32();
                  if (pSize > 0) {
                    const pEnd = Math.min(fEnd, br.offset + pSize - 4);
                    try {
                      if (br.readInt16() === 0) {
                        br.readInt16();
                        const filterType = br.readInt32();
                        const filterShape = br.readInt32();
                        const order = br.readInt32();
                        const freqCritHz = br.readFloat64();
                        const alignment = br.readInt32();
                        br.readFloat64(); // reserved
                        const qFactor = br.readFloat64();
                        const parametricGainDb = br.readFloat64();
                        iirParams = {
                          filterType,
                          filterShape,
                          order,
                          freqCritHz,
                          alignment,
                          qFactor,
                          parametricGainDb,
                        };
                      }
                    } finally {
                      br.seek(pEnd);
                    }
                  }
                }
                filters.push({
                  kind,
                  ...base,
                  logSpectrum,
                  iirParams,
                });
              } finally {
                br.seek(fEnd);
              }
            }
          }
        } finally {
          br.seek(bufEnd);
        }
      }
    }

    const muteInput = sver >= 1 && br.offset + 4 <= endOffset ? br.readInt32() !== 0 : false;
    return { bypass, invertPolarity, muteInput, gainDb, delaySec, filters };
  } catch {
    return null;
  } finally {
    br.seek(endOffset);
  }
}

function parseFilterGroups(br: GllByteReader, maxOffset: number): GllFilterGroup[] {
  return parseBufferItems<GllFilterGroup>(br, maxOffset, 0, (r, bufEnd) => {
    const blockSize = r.readInt32();
    if (blockSize <= 0) return null;
    const endOffset = Math.min(bufEnd, r.offset + blockSize - 4);
    try {
      if (r.readInt16() !== 0) return null;
      r.readInt16(); // sver
      const label = r.readString();
      const key = r.readString();
      const defs = parseBufferItems(r, endOffset, 0, (dr, dBufEnd) => {
        const dSize = dr.readInt32();
        if (dSize <= 0) return null;
        const dEnd = Math.min(dBufEnd, dr.offset + dSize - 4);
        try {
          if (dr.readInt16() !== 0) return null;
          dr.readInt16();
          const dLabel = dr.readString();
          const dKey = dr.readString();
          const bank = parseGenericFilterBank(dr, dEnd);
          return { label: dLabel, key: dKey, bank };
        } finally {
          dr.seek(dEnd);
        }
      });
      return { label, key, filters: defs };
    } finally {
      r.seek(endOffset);
    }
  });
}

/**
 * Parses a structured `EASE_GLL` (`EGLL` v3–v6) binary container, or returns `null` if the
 * buffer does not carry the standard `EASE_GLL` header + `GenSystem` envelope.
 */
export function parseGllContainer(buffer: ArrayBuffer | Uint8Array): GllContainer | null {
  const br = new GllByteReader(buffer);
  if (br.remaining < 20) return null;

  const magic = br.readAscii(4);
  if (magic !== GLL_MAGIC) return null;

  try {
    br.readInt32(); // reserved (0)
    const formatId = br.readString();
    if (formatId !== GLL_FORMAT_ID) return null;

    const formatVersion = br.readInt16();
    if (formatVersion < 3 || formatVersion > 6) return null;
    const subVersion = br.readInt16();

    if (formatVersion >= 4) {
      br.readBytes(4); // checksum
    }
    if (formatVersion >= 6) {
      const hashLen = br.readInt32();
      if (hashLen < 0 || hashLen > 32) return null;
      br.readBytes(hashLen);
    }

    // GenSystem block
    const sysSize = br.readInt32();
    if (sysSize <= 0) return null;
    const sysStart = br.offset;
    const sysEnd = Math.min(br.length, sysStart + sysSize - 4);

    if (br.readInt16() !== 0) return null;
    const sysSubVersion = br.readInt16();
    const label = br.readString();
    br.readFloat64(); // version
    const key = br.readString();
    const systemType = br.readInt32() as GllSystemType;
    const company = br.readString();
    const infoText = br.readString();
    const copyrightText = br.readString();
    br.readString(); // supportText
    const websiteText = br.readString();
    br.readString(); // emailText
    br.readInt32(); // backgroundColor

    let boxTypes: GllBoxType[] = [];
    let sourceDefinitions: GllSourceDefinitionItem[] = [];
    let filterGroups: GllFilterGroup[] = [];

    if (br.offset + 4 <= sysEnd) {
      const dbSize = br.readInt32();
      if (dbSize > 0) {
        const dbEnd = Math.min(sysEnd, br.offset + dbSize - 4);
        try {
          if (br.readInt16() === 0) {
            br.readInt16(); // dbSubVersion
            br.readInt32(); // header field 1
            br.readInt32(); // header field 2

            parseDataFileBuffer(br, dbEnd); // 1. DataFiles
            boxTypes = parseBoxTypes(br, dbEnd); // 2. BoxTypes
            br.skipBlock(dbEnd); // 3. Frames
            br.skipBlock(dbEnd); // 4. Connectors
            br.skipBlock(dbEnd); // 5. Limits
            sourceDefinitions = parseSourceDefinitions(br, dbEnd); // 6. SourceDefinitions
            br.skipBlock(dbEnd); // 7. Warnings
            filterGroups = parseFilterGroups(br, dbEnd); // 8. FilterGroups
          }
        } finally {
          br.seek(dbEnd);
        }
      }
    }

    let enableForSubArrays = false;
    if (sysSubVersion >= 1 && br.offset + 4 <= sysEnd) {
      const flags = br.readInt32();
      enableForSubArrays = (flags & 0x02) !== 0;
    }

    return {
      formatVersion,
      subVersion,
      label,
      key,
      systemType,
      company,
      infoText,
      copyrightText,
      websiteText,
      enableForSubArrays,
      boxTypes,
      sourceDefinitions,
      filterGroups,
    };
  } catch {
    return null;
  }
}
