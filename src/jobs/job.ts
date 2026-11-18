// Shared job record produced by every provider fetcher (LIB-540).
import type { Provider } from "../config/schema.js";

/** One opening from a public job board, normalized across providers. */
export interface Job {
  /** Display name from the watchlist entry, not from the provider payload. */
  company: string;
  title: string;
  /** Free-form location text from the provider. Empty string when missing. */
  location: string;
  /** True when the location text says the role is remote. See `isRemoteLocation`. */
  remote: boolean;
  /** Public posting URL. */
  link: string;
  /**
   * When the posting was published, as an ISO 8601 UTC string
   * (e.g. "2026-01-15T12:00:00.000Z"). `null` when the provider gives no usable date.
   */
  postedAt: string | null;
  /** Source metadata, kept for later dedupe. */
  provider: Provider;
  boardToken: string;
  /** The provider's own job id, as a string so every provider fits. */
  sourceJobId: string;
}

/** Board-level failure: one board failed, the rest of the run continues. */
export interface BoardFetchError {
  provider: Provider;
  company: string;
  boardToken: string;
  url: string;
  message: string;
}

/** Jobs from every board that succeeded, plus one entry per board that failed. */
export interface FetchJobsResult {
  jobs: Job[];
  errors: BoardFetchError[];
}

/** Small on-purpose heuristic: the location mentions "remote" as a word. */
export function isRemoteLocation(location: string): boolean {
  return /\bremote\b/i.test(location);
}

/**
 * Normalizes a provider timestamp (date string or Unix epoch milliseconds) to an
 * ISO 8601 UTC string, or `null` if unusable.
 */
export function toIsoDate(
  value: string | number | null | undefined,
): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
