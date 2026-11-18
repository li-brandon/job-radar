// Read-only fetcher for the public Ashby Job Posting API (LIB-541).
// Only GETs https://api.ashbyhq.com/posting-api/job-board/{token}. No auth, no apply endpoints.
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

export const ASHBY_API_BASE = "https://api.ashbyhq.com/posting-api/job-board";

const ashbyJobSchema = z.object({
  id: z.union([z.string(), z.number()]),
  title: z.string(),
  jobUrl: z.string(),
  location: z.string().nullish(),
  isRemote: z.boolean().nullish(),
  // "Remote", "Hybrid", or "OnSite". Hybrid jobs also have isRemote: true.
  workplaceType: z.string().nullish(),
  publishedAt: z.string().nullish(),
  listedAt: z.string().nullish(),
});

const ashbyBoardSchema = z.object({
  jobs: z.array(ashbyJobSchema),
});

type AshbyJob = z.infer<typeof ashbyJobSchema>;

export function ashbyJobBoardUrl(boardToken: string): string {
  return `${ASHBY_API_BASE}/${encodeURIComponent(boardToken)}`;
}

// workplaceType wins when present, because Hybrid jobs also set isRemote.
function isRemoteAshbyJob(job: AshbyJob, location: string): boolean {
  const workplaceType = job.workplaceType?.trim();
  if (workplaceType) {
    return workplaceType.toLowerCase() === "remote";
  }
  return job.isRemote === true || isRemoteLocation(location);
}

export function mapAshbyJob(entry: WatchlistEntry, job: AshbyJob): Job {
  const location = job.location?.trim() ?? "";
  return {
    company: entry.company,
    title: job.title,
    location,
    remote: isRemoteAshbyJob(job, location),
    link: job.jobUrl,
    postedAt: toIsoDate(job.publishedAt) ?? toIsoDate(job.listedAt),
    provider: "ashby",
    boardToken: entry.boardToken,
    sourceJobId: String(job.id),
  };
}

/**
 * Fetches every Ashby board in the watchlist, one request per board, in order.
 * Non-Ashby entries are ignored. A failing board is logged and recorded in
 * `errors`; the remaining boards are still fetched.
 */
export function fetchAshbyJobs(
  watchlist: readonly WatchlistEntry[],
  options: FetchOptions = {},
): Promise<FetchJobsResult> {
  return fetchBoards(
    {
      provider: "ashby",
      url: ashbyJobBoardUrl,
      schema: ashbyBoardSchema,
      toJobs: (entry, board) =>
        board.jobs.map((job) => mapAshbyJob(entry, job)),
    },
    watchlist,
    options,
  );
}
