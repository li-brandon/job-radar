// Config schema for the search profile and company watchlist (LIB-539).
// Only the shape is defined here; matching, scoring, and fetching land in later tickets.
import { z } from "zod";

export const PROVIDERS = ["greenhouse", "lever", "ashby"] as const;
export type Provider = (typeof PROVIDERS)[number];

/** How US-remote postings are treated relative to the configured locations. */
export const US_REMOTE_MODES = ["fallback", "allowed", "off"] as const;
export type UsRemoteMode = (typeof US_REMOTE_MODES)[number];

/** What happens to postings that do not list base pay. Only "keep" is supported. */
export const UNLISTED_PAY_MODES = ["keep"] as const;

/** What happens to postings whose listed base-pay range tops out below the minimum. */
export const BELOW_MIN_PAY_MODES = ["flag", "demote"] as const;

const nonEmptyString = z
  .string()
  .trim()
  .min(1, { message: "must not be empty" });
const stringList = z.array(nonEmptyString);
const years = z.number().int().min(0);

const senioritySchema = z
  .object({
    label: nonEmptyString,
    minYears: years.optional(),
    maxYears: years.optional(),
  })
  .strict()
  .refine(
    (s) =>
      s.minYears === undefined ||
      s.maxYears === undefined ||
      s.minYears <= s.maxYears,
    {
      message: "must be greater than or equal to minYears",
      path: ["maxYears"],
    },
  );

const locationSchema = z
  .object({
    name: nonEmptyString,
    aliases: stringList.default([]),
  })
  .strict();

const remoteSchema = z
  .object({
    usRemote: z.enum(US_REMOTE_MODES),
  })
  .strict();

const paySchema = z
  .object({
    minTopOfRangeBaseUsd: z.number().int().positive(),
    belowMinimum: z.enum(BELOW_MIN_PAY_MODES).default("flag"),
    unlistedPay: z.enum(UNLISTED_PAY_MODES).default("keep"),
  })
  .strict();

const profileSchema = z
  .object({
    titlesInclude: stringList.min(1, {
      message: "must list at least one title",
    }),
    titlesStretch: stringList.default([]),
    titlesExclude: stringList.default([]),
    seniority: senioritySchema,
    locations: z.array(locationSchema).default([]),
    remote: remoteSchema,
    pay: paySchema,
    industries: stringList.default([]),
  })
  .strict()
  .refine((p) => p.locations.length > 0 || p.remote.usRemote !== "off", {
    message: 'must list at least one location when remote.usRemote is "off"',
    path: ["locations"],
  });

const watchlistEntrySchema = z
  .object({
    company: nonEmptyString,
    provider: z.enum(PROVIDERS),
    boardToken: nonEmptyString.regex(/^[A-Za-z0-9._-]+$/, {
      message: "may only contain letters, digits, '.', '_', and '-'",
    }),
  })
  .strict();

const watchlistSchema = z
  .array(watchlistEntrySchema)
  .min(1, { message: "must list at least one company" })
  .superRefine((entries, ctx) => {
    const seen = new Set<string>();
    entries.forEach((entry, i) => {
      const key = `${entry.provider}:${entry.boardToken.toLowerCase()}`;
      if (seen.has(key)) {
        ctx.addIssue({
          code: "custom",
          message: `duplicate ${entry.provider} board "${entry.boardToken}"`,
          path: [i, "boardToken"],
        });
      }
      seen.add(key);
    });
  });

export const configSchema = z
  .object({
    // Free-form note allowed at the top level so the example file can explain itself.
    _comment: z.string().optional(),
    profile: profileSchema,
    watchlist: watchlistSchema,
  })
  .strict();

export type JobRadarConfig = z.infer<typeof configSchema>;
export type SearchProfile = JobRadarConfig["profile"];
export type Seniority = SearchProfile["seniority"];
export type LocationRule = SearchProfile["locations"][number];
export type PayRule = SearchProfile["pay"];
export type WatchlistEntry = JobRadarConfig["watchlist"][number];
