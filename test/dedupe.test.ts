import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DEFAULT_SEEN_JOBS_PATH,
  SeenJobsError,
  dedupeJobs,
  dedupeKey,
  emptySeenJobs,
  filterUnseen,
  loadSeenJobs,
  matchJobs,
  normalizeLocation,
  recordSeen,
  saveSeenJobs,
  type Job,
  type JobMatch,
  type MatchProfile,
} from "../src/index.js";

// Every company, title, and place below is a fictional placeholder. These
// tests only touch temp files, never data/seen-jobs.local.json.

function job(overrides: Partial<Job> = {}): Job {
  return {
    company: "Acme",
    title: "Widget Engineer",
    location: "Example City",
    remote: false,
    link: "https://example.com/jobs/1",
    postedAt: null,
    provider: "lever",
    boardToken: "acme",
    sourceJobId: "1",
    ...overrides,
  };
}

function scored(j: Job, score: number): JobMatch {
  return { job: j, score, titleMatch: "include", locationMatch: "none" };
}

const PROFILE: MatchProfile = {
  titlesInclude: ["Widget Engineer"],
  titlesStretch: ["Senior Widget Engineer"],
  titlesExclude: [],
  companiesExclude: [],
  locations: [{ name: "Example Metro", aliases: ["Example City"] }],
  remote: { usRemote: "fallback" },
};

const REMOTE = { remote: true };

let tmp: string;

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "job-radar-seen-"));
});

afterAll(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("normalizeLocation", () => {
  it.each([
    "Remote",
    "remote",
    "Remote - US",
    "US Remote",
    "Remote, USA",
    "Remote (United States)",
    "U.S. - Remote",
  ])("treats %j as plain remote", (location) => {
    expect(normalizeLocation(location)).toBe("remote");
  });

  it("keeps non-US remote regions distinct", () => {
    expect(normalizeLocation("Remote - Canada")).toBe("remote canada");
  });

  it("uses the remote flag when the location is empty", () => {
    expect(normalizeLocation("", true)).toBe("remote");
    expect(normalizeLocation("", false)).toBe("");
  });

  it.each([
    ["Example City", "example city"],
    ["  example   city ", "example city"],
    ["Example City, EX", "example city"],
    ["Example City, EX, USA", "example city"],
    ["Example City, United States", "example city"],
    ["Example-City", "example city"],
  ])("cleans %j to %j", (location, expected) => {
    expect(normalizeLocation(location)).toBe(expected);
  });

  it("only drops a two-letter code after a comma", () => {
    expect(normalizeLocation("Example City EX")).toBe("example city ex");
  });

  it("never drops the only segment", () => {
    expect(normalizeLocation("EX")).toBe("ex");
    expect(normalizeLocation("USA")).toBe("usa");
  });

  it("keeps longer trailing segments", () => {
    const location = "Example City, Sample Region";
    expect(normalizeLocation(location)).toBe("example city sample region");
  });
});

describe("dedupeKey", () => {
  it('treats "Sr." and "Senior" as the same title', () => {
    const sr = dedupeKey(job({ title: "Sr. Widget Engineer" }));
    const senior = dedupeKey(job({ title: "Senior Widget Engineer" }));
    expect(sr).toBe(senior);
  });

  it("ignores case, punctuation, and whitespace in every part", () => {
    const messy = job({
      company: "ACME ",
      title: "widget  engineer",
      location: "example city, EX",
    });
    expect(dedupeKey(messy)).toBe(dedupeKey(job()));
  });

  it("treats remote variants as the same location", () => {
    const keys = ["Remote", "Remote - US", "US Remote"].map((location) =>
      dedupeKey(job({ location, ...REMOTE })),
    );
    expect(new Set(keys).size).toBe(1);
  });

  it("separates different companies, titles, and locations", () => {
    const keys = [
      job(),
      job({ company: "Globex" }),
      job({ title: "Senior Widget Engineer" }),
      job({ location: "Metropolis" }),
      job({ location: "Remote", ...REMOTE }),
    ].map(dedupeKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("ignores provider, board token, and source id", () => {
    const other = job({
      provider: "ashby",
      boardToken: "acme-2",
      sourceJobId: "x",
    });
    expect(dedupeKey(other)).toBe(dedupeKey(job()));
  });
});

describe("dedupeJobs", () => {
  it("keeps the first raw job per key", () => {
    const jobs = [
      job({ sourceJobId: "a", title: "Senior Widget Engineer" }),
      job({ sourceJobId: "b" }),
      job({ sourceJobId: "c", title: "Sr. Widget Engineer" }),
      job({ sourceJobId: "d", location: "Remote - US", ...REMOTE }),
      job({ sourceJobId: "e", location: "US Remote", ...REMOTE }),
    ];
    const ids = dedupeJobs(jobs).map((j) => j.sourceJobId);
    expect(ids).toEqual(["a", "b", "d"]);
  });

  it("keeps the higher-scored match per key, at the first position", () => {
    const low = scored(job({ sourceJobId: "low" }), 5);
    const other = scored(job({ sourceJobId: "other", company: "Globex" }), 10);
    const high = scored(job({ sourceJobId: "high" }), 14);
    const ids = dedupeJobs([low, other, high]).map((m) => m.job.sourceJobId);
    expect(ids).toEqual(["high", "other"]);
  });

  it("keeps the first match on equal scores", () => {
    const jobs = [
      job({ sourceJobId: "first" }),
      job({ sourceJobId: "second", company: "acme" }),
    ];
    const kept = dedupeJobs(matchJobs(jobs, PROFILE));
    expect(kept.map((m) => m.job.sourceJobId)).toEqual(["first"]);
  });

  it("does not mutate its input", () => {
    const jobs = [job({ sourceJobId: "a" }), job({ sourceJobId: "b" })];
    expect(dedupeJobs(jobs)).toHaveLength(1);
    expect(jobs).toHaveLength(2);
  });
});

describe("seen jobs across runs", () => {
  it("defaults to a gitignored path", () => {
    expect(DEFAULT_SEEN_JOBS_PATH).toBe("data/seen-jobs.local.json");
  });

  it("treats a missing file as an empty list", async () => {
    const seen = await loadSeenJobs(join(tmp, "missing", "seen.json"));
    expect(seen).toEqual(emptySeenJobs());
  });

  it("filters out jobs seen in a saved earlier run", async () => {
    const path = join(tmp, "nested", "seen.json");
    const now = new Date("2026-01-15T12:00:00.000Z");

    // Run 1: everything is new.
    const run1 = [
      job({ sourceJobId: "1" }),
      job({ sourceJobId: "2", title: "Senior Widget Engineer" }),
    ];
    const seen1 = await loadSeenJobs(path);
    expect(filterUnseen(run1, seen1)).toEqual(run1);
    await saveSeenJobs(recordSeen(seen1, run1, now), path);

    // Run 2: the same postings spelled differently, plus one new remote job.
    const fresh = job({
      sourceJobId: "3",
      location: "Remote - US",
      ...REMOTE,
    });
    const run2 = [
      job({
        sourceJobId: "1b",
        company: "ACME",
        location: "Example City, EX",
      }),
      job({ sourceJobId: "2b", title: "Sr. Widget Engineer" }),
      fresh,
    ];
    const seen2 = await loadSeenJobs(path);
    expect(seen2.jobs).toHaveLength(2);
    expect(seen2.jobs[0]?.firstSeenAt).toBe(now.toISOString());
    expect(filterUnseen(run2, seen2)).toEqual([fresh]);

    // Run 3: another remote spelling of the job first seen in run 2.
    await saveSeenJobs(recordSeen(seen2, [fresh]), path);
    const seen3 = await loadSeenJobs(path);
    const again = job({ location: "US Remote", ...REMOTE });
    expect(filterUnseen([again], seen3)).toEqual([]);
  });

  it("works on scored matches as well as raw jobs", () => {
    const matches = matchJobs([job()], PROFILE);
    const seen = recordSeen(emptySeenJobs(), matches);
    expect(filterUnseen(matches, seen)).toEqual([]);
    expect(filterUnseen([job()], seen)).toEqual([]);
  });

  it("keeps firstSeenAt and does not mutate the input list", () => {
    const first = new Date("2026-01-01T00:00:00.000Z");
    const seen = recordSeen(emptySeenJobs(), [job()], first);
    const again = recordSeen(seen, [job(), job({ company: "Globex" })]);
    expect(seen.jobs).toHaveLength(1);
    expect(again.jobs).toHaveLength(2);
    expect(again.jobs[0]?.firstSeenAt).toBe(first.toISOString());
  });

  it("writes readable JSON", async () => {
    const path = join(tmp, "readable.json");
    const seen = recordSeen(emptySeenJobs(), [job()], new Date(0));
    await saveSeenJobs(seen, path);
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
      version: 1,
      jobs: [
        {
          key: "acme|widget engineer|example city",
          firstSeenAt: "1970-01-01T00:00:00.000Z",
        },
      ],
    });
  });

  it("refuses to reset history from a broken file", async () => {
    const badJson = join(tmp, "bad.json");
    await writeFile(badJson, "{ not json", "utf8");
    await expect(loadSeenJobs(badJson)).rejects.toThrow(SeenJobsError);

    const badShape = join(tmp, "bad-shape.json");
    await writeFile(badShape, JSON.stringify({ jobs: "nope" }), "utf8");
    await expect(loadSeenJobs(badShape)).rejects.toThrow(/unexpected shape/);
  });
});
