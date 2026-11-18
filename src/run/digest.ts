// JSON and markdown output for one `job-radar run` (LIB-543). Local files only.
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import { PROVIDERS } from "../config/schema.js";
import { dedupeKey } from "../match/dedupe.js";
import type { JobMatch } from "../match/match.js";

/**
 * Gitignored by the `*.local.json` and `*.local.md` rules, resolved against the
 * current working directory. They hold company names and titles from real
 * runs: never commit them.
 */
export const DEFAULT_MATCHES_PATH = "data/matches.local.json";
export const DEFAULT_DIGEST_PATH = "data/digest.local.md";

const matchRecordSchema = z
  .object({
    key: z.string().min(1),
    company: z.string(),
    title: z.string(),
    location: z.string(),
    remote: z.boolean(),
    link: z.string(),
    postedAt: z.string().nullable(),
    provider: z.enum(PROVIDERS),
    boardToken: z.string(),
    sourceJobId: z.string(),
    score: z.number(),
    titleMatch: z.enum(["include", "stretch"]),
    locationMatch: z.enum(["location", "remote", "none"]),
    firstSeenAt: z.string(),
  })
  .strict();

export const matchesFileSchema = z
  .object({
    version: z.literal(1),
    generatedAt: z.string(),
    matches: z.array(matchRecordSchema),
  })
  .strict();

export type MatchesFile = z.infer<typeof matchesFileSchema>;
export type MatchRecord = MatchesFile["matches"][number];

export function toMatchRecord(
  match: JobMatch,
  firstSeenAt: string,
): MatchRecord {
  const { job } = match;
  return {
    key: dedupeKey(job),
    company: job.company,
    title: job.title,
    location: job.location,
    remote: job.remote,
    link: job.link,
    postedAt: job.postedAt,
    provider: job.provider,
    boardToken: job.boardToken,
    sourceJobId: job.sourceJobId,
    score: match.score,
    titleMatch: match.titleMatch,
    locationMatch: match.locationMatch,
    firstSeenAt,
  };
}

/** Matches in the given order (best first), all stamped with `now` as `firstSeenAt`. */
export function buildMatchesFile(
  matches: readonly JobMatch[],
  now: Date = new Date(),
): MatchesFile {
  const at = now.toISOString();
  return {
    version: 1,
    generatedAt: at,
    matches: matches.map((match) => toMatchRecord(match, at)),
  };
}

function escapeMarkdown(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[\\`*_[\]<>#|]/g, "\\$&");
}

function escapeUrl(url: string): string {
  // encodeURIComponent leaves () unescaped, but ")" would end a markdown link.
  return url
    .trim()
    .replace(/[()\s]/g, (c) =>
      c === "(" ? "%28" : c === ")" ? "%29" : encodeURIComponent(c),
    );
}

/** "1 new match", "3 new matches". */
export function formatMatchCount(n: number): string {
  return `${n} new ${n === 1 ? "match" : "matches"}`;
}

function renderMatch(match: MatchRecord, index: number): string {
  const title = escapeMarkdown(match.title) || "(untitled)";
  const location = match.location.trim() || (match.remote ? "Remote" : "");
  const lines = [
    `${index + 1}. [${title}](${escapeUrl(match.link)})`,
    `   - Company: ${escapeMarkdown(match.company)}`,
  ];
  if (location) lines.push(`   - Location: ${escapeMarkdown(location)}`);
  lines.push(`   - Score: ${match.score}`);
  if (match.postedAt) lines.push(`   - Posted: ${match.postedAt.slice(0, 10)}`);
  return lines.join("\n");
}

/** Markdown digest, one numbered entry per match in file order (best first). */
export function renderDigest(file: MatchesFile): string {
  const count = file.matches.length;
  const summary = count === 0 ? "no new matches" : formatMatchCount(count);
  const parts = [`# job-radar: ${summary}`, `Generated ${file.generatedAt}.`];
  if (count > 0) parts.push(file.matches.map(renderMatch).join("\n\n"));
  return `${parts.join("\n\n")}\n`;
}

async function writeFileAtomic(path: string, text: string): Promise<void> {
  const fullPath = resolve(path);
  await mkdir(dirname(fullPath), { recursive: true });
  const tmpPath = `${fullPath}.tmp`;
  await writeFile(tmpPath, text, "utf8");
  await rename(tmpPath, fullPath);
}

/** Validates and writes the matches file as pretty JSON with a trailing newline. */
export async function writeMatchesFile(
  file: MatchesFile,
  path: string = DEFAULT_MATCHES_PATH,
): Promise<void> {
  const valid = matchesFileSchema.parse(file);
  await writeFileAtomic(path, `${JSON.stringify(valid, null, 2)}\n`);
}

export async function writeDigest(
  file: MatchesFile,
  path: string = DEFAULT_DIGEST_PATH,
): Promise<void> {
  await writeFileAtomic(path, renderDigest(file));
}
