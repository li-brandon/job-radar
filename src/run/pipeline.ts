// The whole `job-radar run` pipeline (LIB-543): config, fetch, match, dedupe,
// seen filter, then local JSON and markdown output. Never calls process.exit.
import { ConfigError, loadConfig } from "../config/load.js";
import type { JobRadarConfig } from "../config/schema.js";
import { fetchAshbyJobs } from "../fetchers/ashby.js";
import { fetchGreenhouseJobs } from "../fetchers/greenhouse.js";
import { fetchLeverJobs } from "../fetchers/lever.js";
import type { FetchOptions } from "../fetchers/options.js";
import type { BoardFetchError, Job } from "../jobs/job.js";
import { dedupeJobs } from "../match/dedupe.js";
import { matchJobs } from "../match/match.js";
import {
  DEFAULT_SEEN_JOBS_PATH,
  SeenJobsError,
  filterUnseen,
  loadSeenJobs,
  recordSeen,
  saveSeenJobs,
  type SeenJobs,
} from "../match/seen.js";
import {
  DEFAULT_DIGEST_PATH,
  DEFAULT_MATCHES_PATH,
  buildMatchesFile,
  formatMatchCount,
  writeDigest,
  writeMatchesFile,
  type MatchRecord,
} from "./digest.js";

export const NO_NEW_MATCHES_MESSAGE = "No new matches.";

export interface RunOptions extends FetchOptions {
  configPath?: string;
  seenPath?: string;
  jsonOutPath?: string;
  mdOutPath?: string;
  /** Timestamp for `generatedAt` and `firstSeenAt`. Defaults to now. */
  now?: Date;
  /** One call per stdout line. Defaults to `process.stdout`. */
  stdout?: (line: string) => void;
  /** One call per stderr line. Also the default for `log`. Defaults to `process.stderr`. */
  stderr?: (line: string) => void;
}

export type RunStatus =
  "new-matches" | "no-new-matches" | "all-sources-failed" | "failed";

export interface RunResult {
  exitCode: 0 | 1;
  status: RunStatus;
  /** Matches reported for the first time in this run, best first. */
  matches: MatchRecord[];
  /** One entry per board that failed to fetch. */
  errors: BoardFetchError[];
}

/**
 * Runs one scan. Exit code 1 only when the config or seen list cannot be
 * loaded, or when every watchlist board failed; partial board failures and
 * runs with nothing new exit 0. Other I/O errors are thrown.
 */
export async function runJobRadar(
  options: RunOptions = {},
): Promise<RunResult> {
  const stdout =
    options.stdout ?? ((line: string) => process.stdout.write(`${line}\n`));
  const stderr =
    options.stderr ?? ((line: string) => process.stderr.write(`${line}\n`));
  const seenPath = options.seenPath ?? DEFAULT_SEEN_JOBS_PATH;
  const jsonOutPath = options.jsonOutPath ?? DEFAULT_MATCHES_PATH;
  const mdOutPath = options.mdOutPath ?? DEFAULT_DIGEST_PATH;
  const now = options.now ?? new Date();

  const failed = (): RunResult => ({
    exitCode: 1,
    status: "failed",
    matches: [],
    errors: [],
  });

  let config: JobRadarConfig;
  try {
    config = await loadConfig(options.configPath);
  } catch (err) {
    if (!(err instanceof ConfigError)) throw err;
    stderr(err.message);
    return failed();
  }

  let seen: SeenJobs;
  try {
    seen = await loadSeenJobs(seenPath);
  } catch (err) {
    if (!(err instanceof SeenJobsError)) throw err;
    stderr(err.message);
    return failed();
  }

  const fetchOptions: FetchOptions = {
    fetch: options.fetch,
    delayMs: options.delayMs,
    timeoutMs: options.timeoutMs,
    log: options.log ?? stderr,
  };
  const jobs: Job[] = [];
  const errors: BoardFetchError[] = [];
  const fetchers = [fetchGreenhouseJobs, fetchLeverJobs, fetchAshbyJobs];
  for (const fetchJobs of fetchers) {
    const result = await fetchJobs(config.watchlist, fetchOptions);
    jobs.push(...result.jobs);
    errors.push(...result.errors);
  }

  // The schema rejects duplicate boards, so each watchlist entry is one board.
  const boards = config.watchlist.length;
  if (boards > 0 && errors.length >= boards) {
    stderr(
      `All ${boards} job ${boards === 1 ? "board" : "boards"} failed; ` +
        "no output was written and the seen list was not updated.",
    );
    return { exitCode: 1, status: "all-sources-failed", matches: [], errors };
  }

  const matches = dedupeJobs(matchJobs(jobs, config.profile));
  const fresh = filterUnseen(matches, seen);
  const file = buildMatchesFile(fresh, now);
  await writeMatchesFile(file, jsonOutPath);
  await writeDigest(file, mdOutPath);

  if (fresh.length === 0) {
    stdout(NO_NEW_MATCHES_MESSAGE);
    return { exitCode: 0, status: "no-new-matches", matches: [], errors };
  }

  await saveSeenJobs(recordSeen(seen, fresh, now), seenPath);
  stdout(
    `Wrote ${formatMatchCount(fresh.length)} to ${jsonOutPath} and ${mdOutPath}.`,
  );
  return { exitCode: 0, status: "new-matches", matches: file.matches, errors };
}
