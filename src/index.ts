// Package entrypoint. Fetchers, matching, and the CLI land in later tickets.
export const PACKAGE_NAME = "job-radar";

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
