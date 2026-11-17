// Read-only fetcher for the public Greenhouse Job Board API (LIB-540).
// Only GETs https://boards-api.greenhouse.io/v1/boards/{token}/jobs. No auth, no Harvest API.
import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";
import type { WatchlistEntry } from "../config/schema.js";
import {
  isRemoteLocation,
  toIsoDate,
  type BoardFetchError,
  type FetchJobsResult,
  type Job,
} from "../jobs/job.js";

export const GREENHOUSE_API_BASE = "https://boards-api.greenhouse.io/v1/boards";

export const USER_AGENT =
  "job-radar/0.0.0 (+https://github.com/li-brandon/job-radar; read-only)";

/** Default pause between board requests, to stay polite to the API. */
export const DEFAULT_DELAY_MS = 500;

/** Default per-request timeout. One attempt per board; no retries. */
export const DEFAULT_TIMEOUT_MS = 15_000;

export interface GreenhouseFetchOptions {
  /** Defaults to `globalThis.fetch`, looked up at call time. */
  fetch?: typeof fetch;
  /** Pause between board requests in milliseconds. Use 0 in tests. */
  delayMs?: number;
  timeoutMs?: number;
  /** Receives one line per failed board. Defaults to `console.warn`. */
  log?: (message: string) => void;
}

const greenhouseJobSchema = z.object({
  id: z.number(),
  title: z.string(),
  absolute_url: z.string(),
  location: z.object({ name: z.string().nullish() }).nullish(),
  first_published: z.string().nullish(),
  updated_at: z.string().nullish(),
});

const greenhouseBoardSchema = z.object({
  jobs: z.array(greenhouseJobSchema),
});

type GreenhouseJob = z.infer<typeof greenhouseJobSchema>;

export function greenhouseJobsUrl(boardToken: string): string {
  return `${GREENHOUSE_API_BASE}/${encodeURIComponent(boardToken)}/jobs`;
}

export function mapGreenhouseJob(
  entry: WatchlistEntry,
  job: GreenhouseJob,
): Job {
  const location = job.location?.name?.trim() ?? "";
  return {
    company: entry.company,
    title: job.title,
    location,
    remote: isRemoteLocation(location),
    link: job.absolute_url,
    postedAt: toIsoDate(job.first_published) ?? toIsoDate(job.updated_at),
    provider: "greenhouse",
    boardToken: entry.boardToken,
    sourceJobId: String(job.id),
  };
}

/** Fetches one board. Throws an Error with a short reason on any failure. */
async function fetchBoard(
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

  const parsed = greenhouseBoardSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length
      ? issue.path.map(String).join(".")
      : "(root)";
    const reason = issue?.message ?? "invalid";
    throw new Error(`unexpected payload: ${where}: ${reason}`);
  }

  return parsed.data.jobs.map((job) => mapGreenhouseJob(entry, job));
}

/**
 * Fetches every Greenhouse board in the watchlist, one request per board, in order.
 * Non-Greenhouse entries are ignored. A failing board is logged and recorded in
 * `errors`; the remaining boards are still fetched.
 */
export async function fetchGreenhouseJobs(
  watchlist: readonly WatchlistEntry[],
  options: GreenhouseFetchOptions = {},
): Promise<FetchJobsResult> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const delayMs = options.delayMs ?? DEFAULT_DELAY_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const log = options.log ?? ((message: string) => console.warn(message));

  const entries = watchlist.filter((entry) => entry.provider === "greenhouse");
  const jobs: Job[] = [];
  const errors: BoardFetchError[] = [];

  for (const [i, entry] of entries.entries()) {
    if (i > 0 && delayMs > 0) await sleep(delayMs);

    const url = greenhouseJobsUrl(entry.boardToken);
    try {
      jobs.push(...(await fetchBoard(entry, url, fetchImpl, timeoutMs)));
    } catch (err) {
      const message = (err as Error).message;
      errors.push({
        provider: "greenhouse",
        company: entry.company,
        boardToken: entry.boardToken,
        url,
        message,
      });
      log(
        `[greenhouse] ${entry.company} (board "${entry.boardToken}") failed: ${message}`,
      );
    }
  }

  return { jobs, errors };
}
