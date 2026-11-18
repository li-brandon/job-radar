// Package entrypoint. The CLI lives in src/cli.ts.
export const PACKAGE_NAME = "job-radar";

export {
  DEFAULT_DELAY_MS,
  DEFAULT_TIMEOUT_MS,
  USER_AGENT,
} from "./fetchers/options.js";
export type { FetchOptions } from "./fetchers/options.js";
export {
  GREENHOUSE_API_BASE,
  fetchGreenhouseJobs,
  greenhouseJobsUrl,
  mapGreenhouseJob,
} from "./fetchers/greenhouse.js";
export type { GreenhouseFetchOptions } from "./fetchers/greenhouse.js";
export {
  LEVER_API_BASE,
  fetchLeverJobs,
  leverPostingsUrl,
  mapLeverPosting,
} from "./fetchers/lever.js";
export {
  ASHBY_API_BASE,
  ashbyJobBoardUrl,
  fetchAshbyJobs,
  mapAshbyJob,
} from "./fetchers/ashby.js";
export { isRemoteLocation, toIsoDate } from "./jobs/job.js";
export type { BoardFetchError, FetchJobsResult, Job } from "./jobs/job.js";

export {
  containsPhrase,
  normalizeCompany,
  normalizeLocation,
  normalizeText,
  normalizeTitle,
} from "./match/normalize.js";
export { SCORE_WEIGHTS, matchJob, matchJobs } from "./match/match.js";
export type {
  JobMatch,
  LocationMatch,
  MatchProfile,
  TitleMatch,
} from "./match/match.js";
export { dedupeJobs, dedupeKey, jobOf } from "./match/dedupe.js";
export type { JobLike } from "./match/dedupe.js";
export {
  DEFAULT_SEEN_JOBS_PATH,
  SeenJobsError,
  emptySeenJobs,
  filterUnseen,
  loadSeenJobs,
  recordSeen,
  saveSeenJobs,
} from "./match/seen.js";
export type { SeenJobRecord, SeenJobs } from "./match/seen.js";

export {
  DEFAULT_DIGEST_PATH,
  DEFAULT_MATCHES_PATH,
  buildMatchesFile,
  formatMatchCount,
  matchesFileSchema,
  renderDigest,
  toMatchRecord,
  writeDigest,
  writeMatchesFile,
} from "./run/digest.js";
export type { MatchRecord, MatchesFile } from "./run/digest.js";
export { NO_NEW_MATCHES_MESSAGE, runJobRadar } from "./run/pipeline.js";
export type { RunOptions, RunResult, RunStatus } from "./run/pipeline.js";

export {
  ConfigError,
  DEFAULT_CONFIG_PATH,
  loadConfig,
  parseConfig,
} from "./config/load.js";
export {
  BELOW_MIN_PAY_MODES,
  PROVIDERS,
  UNLISTED_PAY_MODES,
  US_REMOTE_MODES,
  configSchema,
} from "./config/schema.js";
export type {
  JobRadarConfig,
  LocationRule,
  PayRule,
  Provider,
  SearchProfile,
  Seniority,
  UsRemoteMode,
  WatchlistEntry,
} from "./config/schema.js";
