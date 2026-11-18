// Matches and scores jobs against the search profile (LIB-542).
//
// Pay: the shared Job record has no pay fields and no fetcher provides them, so
// every job is treated as unlisted pay and kept (`pay.unlistedPay: "keep"`).
// Seniority years and industries are not scored.
import type { SearchProfile, UsRemoteMode } from "../config/schema.js";
import type { Job } from "../jobs/job.js";
import {
  containsPhrase,
  normalizeCompany,
  normalizeText,
  normalizeTitle,
} from "./normalize.js";

export type TitleMatch = "include" | "stretch";
export type LocationMatch = "location" | "remote" | "none";

/** A job that passed every filter. `job` is the original record, unchanged. */
export interface JobMatch {
  job: Job;
  score: number;
  titleMatch: TitleMatch;
  locationMatch: LocationMatch;
}

/** The profile fields matching reads. A full `SearchProfile` fits. */
export type MatchProfile = Pick<
  SearchProfile,
  | "titlesInclude"
  | "titlesStretch"
  | "titlesExclude"
  | "companiesExclude"
  | "locations"
  | "remote"
>;

/**
 * Score parts, added together. Title outweighs location, so every include
 * title ranks above every stretch title. With `usRemote: "allowed"` a remote
 * job earns the `location` weight; with `"fallback"` it earns `remote`.
 */
export const SCORE_WEIGHTS = {
  title: { include: 10, stretch: 5 },
  location: { location: 4, remote: 2, none: 0 },
} as const;

interface CompiledProfile {
  include: string[];
  stretch: string[];
  exclude: string[];
  companiesExclude: Set<string>;
  locations: string[];
  usRemote: UsRemoteMode;
}

function compile(profile: MatchProfile): CompiledProfile {
  const titles = (list: readonly string[]) =>
    list.map(normalizeTitle).filter(Boolean);
  return {
    include: titles(profile.titlesInclude),
    stretch: titles(profile.titlesStretch),
    exclude: titles(profile.titlesExclude),
    companiesExclude: new Set(profile.companiesExclude.map(normalizeCompany)),
    locations: profile.locations
      .flatMap((loc) => [loc.name, ...loc.aliases])
      .map(normalizeText)
      .filter(Boolean),
    usRemote: profile.remote.usRemote,
  };
}

/** Longest phrase in `list` found in `title`, in tokens; 0 when none match. */
function longestMatch(title: string, list: readonly string[]): number {
  let best = 0;
  for (const phrase of list) {
    if (containsPhrase(title, phrase)) {
      best = Math.max(best, phrase.split(" ").length);
    }
  }
  return best;
}

/**
 * The most specific (longest) matching phrase decides, so with "Widget
 * Engineer" included and "Senior Widget Engineer" as a stretch, "Sr. Widget
 * Engineer" is a stretch match. Ties go to include.
 */
function titleMatchFor(
  title: string,
  profile: CompiledProfile,
): TitleMatch | null {
  const include = longestMatch(title, profile.include);
  const stretch = longestMatch(title, profile.stretch);
  if (include === 0 && stretch === 0) return null;
  return include >= stretch ? "include" : "stretch";
}

function matchCompiled(job: Job, profile: CompiledProfile): JobMatch | null {
  if (profile.companiesExclude.has(normalizeCompany(job.company))) return null;

  const title = normalizeTitle(job.title);
  if (profile.exclude.some((phrase) => containsPhrase(title, phrase))) {
    return null;
  }
  const titleMatch = titleMatchFor(title, profile);
  if (!titleMatch) return null;

  const location = normalizeText(job.location);
  let locationMatch: LocationMatch;
  let locationScore: number;
  if (profile.locations.some((phrase) => containsPhrase(location, phrase))) {
    locationMatch = "location";
    locationScore = SCORE_WEIGHTS.location.location;
  } else if (job.remote) {
    // Every remote job counts as US-remote; the country is not parsed.
    if (profile.usRemote === "off") return null;
    locationMatch = "remote";
    locationScore =
      profile.usRemote === "allowed"
        ? SCORE_WEIGHTS.location.location
        : SCORE_WEIGHTS.location.remote;
  } else {
    locationMatch = "none";
    locationScore = SCORE_WEIGHTS.location.none;
  }

  return {
    job,
    score: SCORE_WEIGHTS.title[titleMatch] + locationScore,
    titleMatch,
    locationMatch,
  };
}

/** Scores one job, or returns `null` when the profile drops it. */
export function matchJob(job: Job, profile: MatchProfile): JobMatch | null {
  return matchCompiled(job, compile(profile));
}

/**
 * Scores every job, drops the ones the profile excludes, and returns the rest
 * highest score first. Equal scores keep their input order.
 */
export function matchJobs(
  jobs: readonly Job[],
  profile: MatchProfile,
): JobMatch[] {
  const compiled = compile(profile);
  return jobs
    .map((job) => matchCompiled(job, compiled))
    .filter((m): m is JobMatch => m !== null)
    .sort((a, b) => b.score - a.score);
}
