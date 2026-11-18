// Saved list of jobs already seen in earlier runs (LIB-542).
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import { dedupeKey, jobOf, type JobLike } from "./dedupe.js";

/**
 * Gitignored by the `*.local.json` rule, resolved against the current working
 * directory. It holds company names and titles from real runs: never commit it.
 */
export const DEFAULT_SEEN_JOBS_PATH = "data/seen-jobs.local.json";

const seenJobRecordSchema = z.object({
  key: z.string().min(1),
  firstSeenAt: z.string(),
});

const seenJobsSchema = z.object({
  version: z.literal(1),
  jobs: z.array(seenJobRecordSchema),
});

export type SeenJobs = z.infer<typeof seenJobsSchema>;
export type SeenJobRecord = SeenJobs["jobs"][number];

/** Thrown when the seen file exists but cannot be read or parsed. */
export class SeenJobsError extends Error {
  readonly path: string;

  constructor(path: string, message: string) {
    super(message);
    this.name = "SeenJobsError";
    this.path = path;
  }
}

export function emptySeenJobs(): SeenJobs {
  return { version: 1, jobs: [] };
}

/**
 * Reads the seen list. A missing file is an empty list (first run). A file that
 * exists but is broken throws instead of silently resetting the history.
 */
export async function loadSeenJobs(
  path: string = DEFAULT_SEEN_JOBS_PATH,
): Promise<SeenJobs> {
  const fullPath = resolve(path);
  let text: string;
  try {
    text = await readFile(fullPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return emptySeenJobs();
    }
    throw new SeenJobsError(
      fullPath,
      `Could not read seen-jobs file ${fullPath}: ${(err as Error).message}`,
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new SeenJobsError(
      fullPath,
      `Seen-jobs file ${fullPath} is not valid JSON: ${(err as Error).message}`,
    );
  }
  const result = seenJobsSchema.safeParse(raw);
  if (!result.success) {
    throw new SeenJobsError(
      fullPath,
      `Seen-jobs file ${fullPath} has an unexpected shape.`,
    );
  }
  return result.data;
}

/**
 * Writes the seen list, creating the directory if needed. Writes a temp file
 * first, then renames it, so a crash never leaves a half-written list.
 */
export async function saveSeenJobs(
  seen: SeenJobs,
  path: string = DEFAULT_SEEN_JOBS_PATH,
): Promise<void> {
  const fullPath = resolve(path);
  await mkdir(dirname(fullPath), { recursive: true });
  const tmpPath = `${fullPath}.tmp`;
  await writeFile(tmpPath, `${JSON.stringify(seen, null, 2)}\n`, "utf8");
  await rename(tmpPath, fullPath);
}

/** Items whose dedupe key is not in the seen list, in input order. */
export function filterUnseen<T extends JobLike>(
  items: readonly T[],
  seen: SeenJobs,
): T[] {
  const keys = new Set(seen.jobs.map((record) => record.key));
  return items.filter((item) => !keys.has(dedupeKey(jobOf(item))));
}

/**
 * Returns a new seen list with every item's key added. Keys already present
 * keep their original `firstSeenAt`. The input list is not modified.
 */
export function recordSeen(
  seen: SeenJobs,
  items: readonly JobLike[],
  now: Date = new Date(),
): SeenJobs {
  const keys = new Set(seen.jobs.map((record) => record.key));
  const added: SeenJobRecord[] = [];
  const firstSeenAt = now.toISOString();
  for (const item of items) {
    const key = dedupeKey(jobOf(item));
    if (!keys.has(key)) {
      keys.add(key);
      added.push({ key, firstSeenAt });
    }
  }
  return { version: 1, jobs: [...seen.jobs, ...added] };
}
