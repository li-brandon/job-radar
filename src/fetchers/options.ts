// Shared constants and options for the read-only job-board fetchers.

export const USER_AGENT =
  "job-radar/0.0.0 (+https://github.com/li-brandon/job-radar; read-only)";

/** Default pause between board requests, to stay polite to the API. */
export const DEFAULT_DELAY_MS = 500;

/** Default per-request timeout. One attempt per board; no retries. */
export const DEFAULT_TIMEOUT_MS = 15_000;

export interface FetchOptions {
  /** Defaults to `globalThis.fetch`, looked up at call time. */
  fetch?: typeof fetch;
  /** Pause between board requests in milliseconds. Use 0 in tests. */
  delayMs?: number;
  timeoutMs?: number;
  /** Receives one line per failed board. Defaults to `console.warn`. */
  log?: (message: string) => void;
}
