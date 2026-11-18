// Read-only fetcher for the public Lever Postings API (LIB-541).
// Only GETs https://api.lever.co/v0/postings/{token}?mode=json. No auth, no apply endpoints.
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

export const LEVER_API_BASE = "https://api.lever.co/v0/postings";

const leverPostingSchema = z.object({
  id: z.union([z.string(), z.number()]),
  text: z.string(),
  hostedUrl: z.string(),
  categories: z.object({ location: z.string().nullish() }).nullish(),
  // Epoch milliseconds in practice; ISO strings are accepted too.
  createdAt: z.union([z.number(), z.string()]).nullish(),
  workplaceType: z.string().nullish(),
});

/** Lever returns a bare array of postings, not a `{ jobs }` object. */
const leverBoardSchema = z.array(leverPostingSchema);

type LeverPosting = z.infer<typeof leverPostingSchema>;

export function leverPostingsUrl(boardToken: string): string {
  return `${LEVER_API_BASE}/${encodeURIComponent(boardToken)}?mode=json`;
}

export function mapLeverPosting(
  entry: WatchlistEntry,
  posting: LeverPosting,
): Job {
  const location = posting.categories?.location?.trim() ?? "";
  return {
    company: entry.company,
    title: posting.text,
    location,
    remote:
      posting.workplaceType?.toLowerCase() === "remote" ||
      isRemoteLocation(location),
    link: posting.hostedUrl,
    postedAt: toIsoDate(posting.createdAt),
    provider: "lever",
    boardToken: entry.boardToken,
    sourceJobId: String(posting.id),
  };
}

/**
 * Fetches every Lever board in the watchlist, one request per board, in order.
 * Non-Lever entries are ignored. A failing board is logged and recorded in
 * `errors`; the remaining boards are still fetched.
 */
export function fetchLeverJobs(
  watchlist: readonly WatchlistEntry[],
  options: FetchOptions = {},
): Promise<FetchJobsResult> {
  return fetchBoards(
    {
      provider: "lever",
      url: leverPostingsUrl,
      schema: leverBoardSchema,
      toJobs: (entry, postings) =>
        postings.map((posting) => mapLeverPosting(entry, posting)),
    },
    watchlist,
    options,
  );
}
