/**
 * Size limits for entry documents.
 * Warning at 1 MB, hard rejection at 2 MB.
 */
export const ENTRY_SIZE_LIMITS = {
  WARNING_BYTES: 1_000_000, // 1 MB
  MAX_BYTES: 2_000_000,     // 2 MB
} as const;
