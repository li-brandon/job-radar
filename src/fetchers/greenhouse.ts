// Read-only fetcher for the public Greenhouse Job Board API (LIB-540).
// Only GETs https://boards-api.greenhouse.io/v1/boards/{token}/jobs. No auth, no Harvest API.
import { z } from "zod";
import type { WatchlistEntry } from "../config/schema.js";
import {
  isRemoteLocation,
  toIsoDate,
  type FetchJobsResult,
  type Job,
} from "../jobs/job.js";
import { fetchBoards } from "./board.js";
import type { FetchOptions } from "./options.js";

export const GREENHOUSE_API_BASE = "https://boards-api.greenhouse.io/v1/boards";

export type GreenhouseFetchOptions = FetchOptions;

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

/**
 * Fetches every Greenhouse board in the watchlist, one request per board, in order.
 * Non-Greenhouse entries are ignored. A failing board is logged and recorded in
 * `errors`; the remaining boards are still fetched.
 */
export function fetchGreenhouseJobs(
  watchlist: readonly WatchlistEntry[],
  options: GreenhouseFetchOptions = {},
): Promise<FetchJobsResult> {
  return fetchBoards(
    {
      provider: "greenhouse",
      url: greenhouseJobsUrl,
      schema: greenhouseBoardSchema,
      toJobs: (entry, board) =>
        board.jobs.map((job) => mapGreenhouseJob(entry, job)),
    },
    watchlist,
    options,
  );
}
