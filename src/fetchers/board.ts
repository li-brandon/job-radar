// Shared per-provider loop: one GET per board, validate, map, and record failures.
import { setTimeout as sleep } from "node:timers/promises";
import type { z } from "zod";
import type { Provider, WatchlistEntry } from "../config/schema.js";
import type { BoardFetchError, FetchJobsResult, Job } from "../jobs/job.js";
import {
  DEFAULT_DELAY_MS,
  DEFAULT_TIMEOUT_MS,
  USER_AGENT,
  type FetchOptions,
} from "./options.js";

/** How one provider's public board is requested, validated, and mapped. */
export interface BoardSource<T> {
  provider: Provider;
  url: (boardToken: string) => string;
  schema: z.ZodType<T>;
  toJobs: (entry: WatchlistEntry, payload: T) => Job[];
}

/** Fetches one board. Throws an Error with a short reason on any failure. */
async function fetchBoard<T>(
  source: BoardSource<T>,
  entry: WatchlistEntry,
  url: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<Job[]> {
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "GET",
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new Error(`network error: ${(err as Error).message}`, { cause: err });
  }

  if (!res.ok) {
    const status = [res.status, res.statusText].filter(Boolean).join(" ");
    throw new Error(`HTTP ${status}`);
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch (err) {
    throw new Error(`invalid JSON: ${(err as Error).message}`, { cause: err });
  }

  const parsed = source.schema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length
      ? issue.path.map(String).join(".")
      : "(root)";
    const reason = issue?.message ?? "invalid";
    throw new Error(`unexpected payload: ${where}: ${reason}`);
  }

  return source.toJobs(entry, parsed.data);
}

/**
 * Fetches every board in the watchlist for `source.provider`, one request per
 * board, in order. Other providers and repeated boards (same token, any case)
 * are skipped. A failing board is logged and recorded in `errors`; the
 * remaining boards are still fetched.
 */
export async function fetchBoards<T>(
  source: BoardSource<T>,
  watchlist: readonly WatchlistEntry[],
  options: FetchOptions = {},
): Promise<FetchJobsResult> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const delayMs = options.delayMs ?? DEFAULT_DELAY_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const log = options.log ?? ((message: string) => console.warn(message));

  const seen = new Set<string>();
  const entries = watchlist.filter((entry) => {
    if (entry.provider !== source.provider) return false;
    const key = entry.boardToken.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const jobs: Job[] = [];
  const errors: BoardFetchError[] = [];

  for (const [i, entry] of entries.entries()) {
    if (i > 0 && delayMs > 0) await sleep(delayMs);

    const url = source.url(entry.boardToken);
    try {
      jobs.push(
        ...(await fetchBoard(source, entry, url, fetchImpl, timeoutMs)),
      );
    } catch (err) {
      const message = (err as Error).message;
      errors.push({
        provider: source.provider,
        company: entry.company,
        boardToken: entry.boardToken,
        url,
        message,
      });
      log(
        `[${source.provider}] ${entry.company} (board "${entry.boardToken}") failed: ${message}`,
      );
    }
  }

  return { jobs, errors };
}
