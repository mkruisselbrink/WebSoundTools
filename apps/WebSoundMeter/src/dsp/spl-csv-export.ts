// Copyright (C) 2026 WebSoundMeter Contributors
// Inspired by Open Sound Meter (OSM), Copyright (C) Pavel Smokotnin
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Chronological row extraction and UTF-8 CSV formatting for 1-second SPL & Leq logs.
 */

import { SPL_TIER_B_CAPACITY, energyToDb } from './spl-compliance.js';
import type { TierBRingBuffers } from './spl-ring-buffers.js';

export interface SplChronologicalRow {
  timestampIso: string;
  elapsedSec: number;
  lafDb: number;
  lcfDb: number;
  laeq1mDb: number;
  lceq1mDb: number;
  laeq5mDb: number;
  laeq15mDb: number;
  laeq60mDb: number;
  lpeakDb: number;
}

export function extractChronologicalRows(
  tierB: TierBRingBuffers,
  splOffsetDb: number,
  nowMs: number = Date.now()
): SplChronologicalRow[] {
  const n = tierB.count;
  const startIdx = (tierB.head - n + SPL_TIER_B_CAPACITY) % SPL_TIER_B_CAPACITY;
  const rows: SplChronologicalRow[] = [];
  let runningSum300A = 0;

  for (let i = 0; i < n; i++) {
    const idx = (startIdx + i) % SPL_TIER_B_CAPACITY;
    runningSum300A += tierB.energyA[idx];
    if (i >= 300) {
      const oldIdx = (startIdx + i - 300) % SPL_TIER_B_CAPACITY;
      runningSum300A = Math.max(0, runningSum300A - tierB.energyA[oldIdx]);
    }
    const denom5m = Math.max(1, Math.min(300, i + 1));
    const laeq5mDb = energyToDb(runningSum300A / denom5m, splOffsetDb);
    const rowTimeMs = nowMs - (n - 1 - i) * 1000;

    rows.push({
      timestampIso: new Date(rowTimeMs).toISOString(),
      elapsedSec: i + 1,
      lafDb: tierB.shortDbA[idx],
      lcfDb: tierB.shortDbC[idx],
      laeq1mDb: tierB.leq1mDbA[idx],
      lceq1mDb: tierB.leq1mDbC[idx],
      laeq5mDb,
      laeq15mDb: tierB.leq15mDbA[idx],
      laeq60mDb: tierB.leq60mDbA[idx],
      lpeakDb: tierB.peakDb[idx],
    });
  }
  return rows;
}

export function formatSplHistoryCsv(
  slots: ReadonlyArray<{
    slotId: string;
    slotName: string;
    tracker: { getChronologicalRows(nowMs?: number): SplChronologicalRow[] };
  }>,
  nowMs: number = Date.now()
): string {
  const header =
    'timestamp_iso,elapsed_sec,slot_id,slot_name,laf_db,lcf_db,laeq_1m_db,lceq_1m_db,laeq_5m_db,laeq_15m_db,laeq_60m_db,lpeak_db';
  const lines: string[] = [header];

  for (const { slotId, slotName, tracker } of slots) {
    const safeName = slotName.includes(',') ? `"${slotName.replace(/"/g, '""')}"` : slotName;
    const rows = tracker.getChronologicalRows(nowMs);
    for (const r of rows) {
      lines.push(
        [
          r.timestampIso,
          r.elapsedSec,
          slotId,
          safeName,
          r.lafDb.toFixed(1),
          r.lcfDb.toFixed(1),
          r.laeq1mDb.toFixed(1),
          r.lceq1mDb.toFixed(1),
          r.laeq5mDb.toFixed(1),
          r.laeq15mDb.toFixed(1),
          r.laeq60mDb.toFixed(1),
          r.lpeakDb.toFixed(1),
        ].join(',')
      );
    }
  }

  return lines.join('\n') + '\n';
}
