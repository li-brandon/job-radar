// Package entrypoint. Lever/Ashby fetchers, matching, and the CLI land in later tickets.
export const PACKAGE_NAME = "job-radar";

export {
  DEFAULT_DELAY_MS,
  DEFAULT_TIMEOUT_MS,
  GREENHOUSE_API_BASE,
  USER_AGENT,
  fetchGreenhouseJobs,
  greenhouseJobsUrl,
  mapGreenhouseJob,
} from "./fetchers/greenhouse.js";
export type { GreenhouseFetchOptions } from "./fetchers/greenhouse.js";
export { isRemoteLocation, toIsoDate } from "./jobs/job.js";
export type { BoardFetchError, FetchJobsResult, Job } from "./jobs/job.js";

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
