export const RETENTION_CONFIG = {
  KEEP_LAST_N: 5, // Keep the last 5 snapshots regardless of age
  KEEP_DAILY_DAYS: 7, // Keep 1 snapshot per day for the last 7 days
  KEEP_WEEKLY_WEEKS: 4, // Keep 1 snapshot per week for the last 4 weeks
} as const;

export interface SnapshotMetaItem {
  snapshotId: string;
  createdAt: string; // ISO date string
  path: string;
}

export interface TieredRetentionResult {
  kept: SnapshotMetaItem[];
  dead: SnapshotMetaItem[];
}

/**
 * Calculates tiered retention matching Restic's policy:
 * 1. Keeps the last N snapshots (default 5).
 * 2. Keeps 1 snapshot per calendar day for the last 7 days.
 * 3. Keeps 1 snapshot per calendar week for the last 4 weeks.
 * Supports an explicit `nowMs` timestamp for deterministic test verification.
 */
export function calculateTieredRetention(
  snapshots: SnapshotMetaItem[],
  nowMs = Date.now()
): TieredRetentionResult {
  // Sort descending by timestamp (newest first)
  const sorted = [...snapshots].sort((a, b) => {
    const timeA = Date.parse(a.createdAt) || 0;
    const timeB = Date.parse(b.createdAt) || 0;
    if (timeA !== timeB) return timeB - timeA;
    return b.snapshotId.localeCompare(a.snapshotId);
  });

  const keptSet = new Set<string>();

  // 1. Keep last N snapshots
  const lastN = sorted.slice(0, RETENTION_CONFIG.KEEP_LAST_N);
  for (const s of lastN) {
    keptSet.add(s.snapshotId);
  }

  // 2. Keep 1 per day for the last 7 days
  const sevenDaysAgoMs = nowMs - RETENTION_CONFIG.KEEP_DAILY_DAYS * 24 * 60 * 60 * 1000;
  const dayBuckets = new Map<string, SnapshotMetaItem>(); // YYYY-MM-DD -> newest snapshot

  for (const s of sorted) {
    const sTime = Date.parse(s.createdAt) || 0;
    if (sTime >= sevenDaysAgoMs && sTime <= nowMs) {
      const dayKey = new Date(sTime).toISOString().slice(0, 10);
      if (!dayBuckets.has(dayKey)) {
        dayBuckets.set(dayKey, s);
      }
    }
  }

  for (const s of dayBuckets.values()) {
    keptSet.add(s.snapshotId);
  }

  // 3. Keep 1 per week for the last 4 weeks (28 days)
  const fourWeeksAgoMs = nowMs - RETENTION_CONFIG.KEEP_WEEKLY_WEEKS * 7 * 24 * 60 * 60 * 1000;
  const weekBuckets = new Map<string, SnapshotMetaItem>(); // year-week -> newest snapshot

  for (const s of sorted) {
    const sTime = Date.parse(s.createdAt) || 0;
    if (sTime >= fourWeeksAgoMs && sTime <= nowMs) {
      const date = new Date(sTime);
      const year = date.getUTCFullYear();
      // Calculate ISO week number
      const startOfYear = new Date(Date.UTC(year, 0, 1));
      const weekNo = Math.ceil(((sTime - startOfYear.getTime()) / 86400000 + startOfYear.getUTCDay() + 1) / 7);
      const weekKey = `${year}-W${String(weekNo).padStart(2, '0')}`;

      if (!weekBuckets.has(weekKey)) {
        weekBuckets.set(weekKey, s);
      }
    }
  }

  for (const s of weekBuckets.values()) {
    keptSet.add(s.snapshotId);
  }

  const kept: SnapshotMetaItem[] = [];
  const dead: SnapshotMetaItem[] = [];

  for (const s of sorted) {
    if (keptSet.has(s.snapshotId)) {
      kept.push(s);
    } else {
      dead.push(s);
    }
  }

  return { kept, dead };
}
