// In-run dedupe on company + title + location (LIB-542).
import type { Job } from "../jobs/job.js";
import type { JobMatch } from "./match.js";
import {
  normalizeCompany,
  normalizeLocation,
  normalizeTitle,
} from "./normalize.js";

/** Dedupe and the seen list accept raw jobs or scored matches. */
export type JobLike = Job | JobMatch;

export function jobOf(item: JobLike): Job {
  return "job" in item ? item.job : item;
}

/**
 * Stable key: normalized company, title, and location joined by "|".
 * Normalized text never contains "|", so the parts cannot run together.
 */
export function dedupeKey(job: Job): string {
  return [
    normalizeCompany(job.company),
    normalizeTitle(job.title),
    normalizeLocation(job.location, job.remote),
  ].join("|");
}

/** True only when both items were scored and `item` scored higher. */
function outscores(item: JobLike, existing: JobLike): boolean {
  return "job" in item && "job" in existing && item.score > existing.score;
}

/**
 * Keeps one item per dedupe key, at the position of the key's first
 * occurrence. When both items have a score the higher one wins; otherwise
 * (and on equal scores) the first one is kept.
 */
export function dedupeJobs<T extends JobLike>(items: readonly T[]): T[] {
  const kept = new Map<string, T>();
  for (const item of items) {
    const key = dedupeKey(jobOf(item));
    const existing = kept.get(key);
    if (existing === undefined || outscores(item, existing)) {
      kept.set(key, item);
    }
  }
  return [...kept.values()];
}
