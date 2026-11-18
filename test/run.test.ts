import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { USAGE, main } from "../src/cli.js";
import {
  DEFAULT_DIGEST_PATH,
  DEFAULT_MATCHES_PATH,
  DEFAULT_SEEN_JOBS_PATH,
  NO_NEW_MATCHES_MESSAGE,
  ashbyJobBoardUrl,
  greenhouseJobsUrl,
  leverPostingsUrl,
  matchesFileSchema,
  runJobRadar,
  type RunOptions,
  type RunResult,
  type WatchlistEntry,
} from "../src/index.js";
import { jsonResponse, readFixture, stubFetch } from "./fetch-stub.js";

// Every company, board token, title, and place below is a fictional
// placeholder. Every path is under a temp directory; no test may write the
// default seen or output files, and fetch is always a stub.

const WATCHLIST: WatchlistEntry[] = [
  {
    company: "Example Corp",
    provider: "greenhouse",
    boardToken: "example-corp",
  },
  { company: "Acme", provider: "lever", boardToken: "acme" },
  { company: "Globex", provider: "ashby", boardToken: "globex" },
];

const PROFILE = {
  titlesInclude: ["Widget Engineer", "Backend Widget Engineer"],
  titlesStretch: ["Senior Widget Engineer"],
  titlesExclude: ["Intern"],
  seniority: { label: "mid-level" },
  locations: [
    { name: "Example Metro", aliases: ["Example City", "Sample Town"] },
  ],
  remote: { usRemote: "fallback" },
  pay: { minTopOfRangeBaseUsd: 100000 },
  industries: ["widgets", "sprockets"],
};

const DEFAULT_PATHS = [
  resolve(DEFAULT_SEEN_JOBS_PATH),
  resolve(DEFAULT_MATCHES_PATH),
  resolve(DEFAULT_DIGEST_PATH),
];

async function mtimeOf(path: string): Promise<number | null> {
  try {
    return (await stat(path)).mtimeMs;
  } catch {
    return null;
  }
}

let tmp: string;
let defaultsBefore: (number | null)[];
let caseId = 0;

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "job-radar-run-"));
  defaultsBefore = await Promise.all(DEFAULT_PATHS.map(mtimeOf));
});

afterAll(async () => {
  await rm(tmp, { recursive: true, force: true });
});

interface Case {
  dir: string;
  configPath: string;
  seenPath: string;
  jsonOutPath: string;
  mdOutPath: string;
}

async function newCase(
  config: unknown = { profile: PROFILE, watchlist: WATCHLIST },
): Promise<Case> {
  const dir = join(tmp, `case-${++caseId}`);
  const configPath = join(dir, "config.json");
  await mkdir(dir, { recursive: true });
  await writeFile(configPath, JSON.stringify(config), "utf8");
  return {
    dir,
    configPath,
    seenPath: join(dir, "data", "seen.json"),
    jsonOutPath: join(dir, "out", "matches.json"),
    mdOutPath: join(dir, "out", "digest.md"),
  };
}

async function allBoardsOk() {
  const [gh, lever, ashby] = await Promise.all([
    readFixture("greenhouse/example-corp"),
    readFixture("lever/acme"),
    readFixture("ashby/globex"),
  ]);
  return {
    [greenhouseJobsUrl("example-corp")]: () => jsonResponse(gh),
    [leverPostingsUrl("acme")]: () => jsonResponse(lever),
    [ashbyJobBoardUrl("globex")]: () => jsonResponse(ashby),
  };
}

const notFound = () =>
  new Response("Not Found", { status: 404, statusText: "Not Found" });

async function run(
  c: Case,
  fetch: typeof globalThis.fetch,
  extra: Partial<RunOptions> = {},
): Promise<RunResult & { stdout: string[]; stderr: string[] }> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const result = await runJobRadar({
    configPath: c.configPath,
    seenPath: c.seenPath,
    jsonOutPath: c.jsonOutPath,
    mdOutPath: c.mdOutPath,
    fetch,
    delayMs: 0,
    now: new Date("2026-03-10T09:00:00.000Z"),
    stdout: (line) => stdout.push(line),
    stderr: (line) => stderr.push(line),
    ...extra,
  });
  return { ...result, stdout, stderr };
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

describe("runJobRadar", () => {
  it("writes new matches as JSON and a markdown digest, best first", async () => {
    const c = await newCase();
    const fetch = stubFetch(await allBoardsOk());

    const result = await run(c, fetch);

    expect(result.exitCode).toBe(0);
    expect(result.status).toBe("new-matches");
    expect(fetch).toHaveBeenCalledTimes(3);
    for (const [, init] of fetch.mock.calls) expect(init?.method).toBe("GET");

    const file = matchesFileSchema.parse(await readJson(c.jsonOutPath));
    expect(file.version).toBe(1);
    expect(file.generatedAt).toBe("2026-03-10T09:00:00.000Z");
    expect(file.matches.length).toBeGreaterThan(1);
    expect(file.matches).toEqual(result.matches);

    const scores = file.matches.map((m) => m.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(new Set(file.matches.map((m) => m.key)).size).toBe(scores.length);
    expect(file.matches[0]).toEqual({
      key: "example corp|widget engineer|example city",
      company: "Example Corp",
      title: "Widget Engineer",
      location: "Example City, EX",
      remote: false,
      link: "https://boards.greenhouse.io/example-corp/jobs/1001",
      postedAt: "2026-01-15T12:00:00.000Z",
      provider: "greenhouse",
      boardToken: "example-corp",
      sourceJobId: "1001",
      score: 14,
      titleMatch: "include",
      locationMatch: "location",
      firstSeenAt: "2026-03-10T09:00:00.000Z",
    });
    const titles = file.matches.map((m) => m.title);
    expect(titles).not.toContain("Sprocket Engineer");

    const md = await readFile(c.mdOutPath, "utf8");
    expect(md).toMatch(
      new RegExp(`^# job-radar: ${file.matches.length} new matches\\n`),
    );
    expect(md).toContain(
      "1. [Widget Engineer](https://boards.greenhouse.io/example-corp/jobs/1001)",
    );
    expect(md).toContain("   - Company: Example Corp");
    expect(md).toContain("   - Posted: 2026-01-15");
    let last = -1;
    for (const m of file.matches) {
      const at = md.indexOf(`](${m.link})`);
      expect(at).toBeGreaterThan(last);
      last = at;
    }

    expect(result.stdout).toEqual([
      `Wrote ${file.matches.length} new matches to ${c.jsonOutPath} and ${c.mdOutPath}.`,
    ]);
    const seen = (await readJson(c.seenPath)) as { jobs: { key: string }[] };
    expect(seen.jobs.map((j) => j.key)).toEqual(file.matches.map((m) => m.key));
  });

  it("prints one line and leaves the seen list alone when nothing is new", async () => {
    const c = await newCase();
    const routes = await allBoardsOk();
    await run(c, stubFetch(routes));
    const seenBefore = await readFile(c.seenPath, "utf8");

    const second = await run(c, stubFetch(routes), {
      now: new Date("2026-03-11T09:00:00.000Z"),
    });

    expect(second.exitCode).toBe(0);
    expect(second.status).toBe("no-new-matches");
    expect(second.stdout).toEqual([NO_NEW_MATCHES_MESSAGE]);
    expect(second.stderr).toEqual([]);
    expect(await readFile(c.seenPath, "utf8")).toBe(seenBefore);

    const file = matchesFileSchema.parse(await readJson(c.jsonOutPath));
    expect(file.matches).toEqual([]);
    const md = await readFile(c.mdOutPath, "utf8");
    expect(md).toMatch(/^# job-radar: no new matches\n/);
  });

  it("only records reported matches, so unmatched jobs can surface later", async () => {
    const c = await newCase();
    await run(c, stubFetch(await allBoardsOk()));
    const seen = (await readJson(c.seenPath)) as { jobs: { key: string }[] };
    expect(seen.jobs.some((j) => j.key.includes("sprocket"))).toBe(false);
  });

  it("exits 0 and writes the good boards' matches when one board fails", async () => {
    const c = await newCase();
    const routes = await allBoardsOk();
    const fetch = stubFetch({
      ...routes,
      [greenhouseJobsUrl("example-corp")]: notFound,
      [ashbyJobBoardUrl("globex")]: () => {
        throw new TypeError("fetch failed");
      },
    });

    const result = await run(c, fetch);

    expect(result.exitCode).toBe(0);
    expect(result.errors.map((e) => e.boardToken)).toEqual([
      "example-corp",
      "globex",
    ]);
    expect(result.stderr).toHaveLength(2);
    expect(result.stderr[0]).toContain("HTTP 404");
    const file = matchesFileSchema.parse(await readJson(c.jsonOutPath));
    expect(file.matches.length).toBeGreaterThan(0);
    const companies = new Set(file.matches.map((m) => m.company));
    expect([...companies]).toEqual(["Acme"]);
    expect(result.stdout).toHaveLength(1);
    expect(result.stdout[0]).toMatch(/^Wrote \d+ new matches to /);
  });

  it("exits 0 when the only working board has nothing new", async () => {
    const c = await newCase();
    const fetch = stubFetch({
      [greenhouseJobsUrl("example-corp")]: () =>
        jsonResponse(JSON.stringify({ jobs: [] })),
      [leverPostingsUrl("acme")]: notFound,
      [ashbyJobBoardUrl("globex")]: notFound,
    });

    const result = await run(c, fetch);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toEqual([NO_NEW_MATCHES_MESSAGE]);
  });

  it("exits 1 without touching the seen list when every board fails", async () => {
    const c = await newCase();
    const fetch = stubFetch({
      [greenhouseJobsUrl("example-corp")]: notFound,
      [leverPostingsUrl("acme")]: () => {
        throw new TypeError("fetch failed");
      },
      [ashbyJobBoardUrl("globex")]: () => jsonResponse("<html>"),
    });

    const result = await run(c, fetch);

    expect(result.exitCode).toBe(1);
    expect(result.status).toBe("all-sources-failed");
    expect(result.errors).toHaveLength(3);
    expect(result.stdout).toEqual([]);
    expect(result.stderr.at(-1)).toMatch(/^All 3 job boards failed/);
    for (const path of [c.seenPath, c.jsonOutPath, c.mdOutPath]) {
      expect(await mtimeOf(path)).toBeNull();
    }
  });

  it("does not update an existing seen list when every board fails", async () => {
    const c = await newCase();
    await run(c, stubFetch(await allBoardsOk()));
    const seenBefore = await readFile(c.seenPath, "utf8");

    const result = await run(
      c,
      stubFetch({
        [greenhouseJobsUrl("example-corp")]: notFound,
        [leverPostingsUrl("acme")]: notFound,
        [ashbyJobBoardUrl("globex")]: notFound,
      }),
    );

    expect(result.exitCode).toBe(1);
    expect(result.stdout).not.toContain(NO_NEW_MATCHES_MESSAGE);
    expect(await readFile(c.seenPath, "utf8")).toBe(seenBefore);
  });

  it("fails closed without an injected fetch", async () => {
    const c = await newCase();
    const result = await run(c, undefined as unknown as typeof fetch);
    expect(result.exitCode).toBe(1);
    expect(result.status).toBe("all-sources-failed");
  });

  it("exits 1 when the config file is missing", async () => {
    const c = await newCase();
    const fetch = stubFetch({});
    const result = await run(c, fetch, {
      configPath: join(c.dir, "missing.json"),
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr.join("\n")).toContain("Config file not found");
    expect(fetch).not.toHaveBeenCalled();
    expect(await mtimeOf(c.jsonOutPath)).toBeNull();
  });

  it("exits 1 when the config is invalid", async () => {
    const c = await newCase({ profile: PROFILE, watchlist: [] });
    const fetch = stubFetch({});
    const result = await run(c, fetch);
    expect(result.exitCode).toBe(1);
    expect(result.stderr.join("\n")).toContain("watchlist");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("exits 1 when the seen list is broken, without overwriting it", async () => {
    const c = await newCase();
    await mkdir(join(c.dir, "data"), { recursive: true });
    await writeFile(c.seenPath, "{ not json", "utf8");

    const fetch = stubFetch(await allBoardsOk());
    const result = await run(c, fetch);

    expect(result.exitCode).toBe(1);
    expect(fetch).not.toHaveBeenCalled();
    expect(result.stderr.join("\n")).toContain("not valid JSON");
    expect(await readFile(c.seenPath, "utf8")).toBe("{ not json");
    expect(await mtimeOf(c.jsonOutPath)).toBeNull();
  });
});

describe("cli main", () => {
  function io() {
    const out = { stdout: [] as string[], stderr: [] as string[] };
    return {
      out,
      io: {
        stdout: (line: string) => out.stdout.push(line),
        stderr: (line: string) => out.stderr.push(line),
      },
    };
  }

  const ok: RunResult = {
    exitCode: 0,
    status: "no-new-matches",
    matches: [],
    errors: [],
  };

  const spyRun = () =>
    vi.fn<(options: RunOptions) => Promise<RunResult>>(async () => ok);

  it("passes flags through to the pipeline", async () => {
    const { io: cliIo } = io();
    const runSpy = spyRun();
    const code = await main(
      [
        "run",
        "--config",
        "c.json",
        "--seen",
        "s.json",
        "--json-out",
        "m.json",
        "--md-out",
        "d.md",
      ],
      cliIo,
      runSpy,
    );
    expect(code).toBe(0);
    expect(runSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        configPath: "c.json",
        seenPath: "s.json",
        jsonOutPath: "m.json",
        mdOutPath: "d.md",
      }),
    );
  });

  it("returns the pipeline's exit code", async () => {
    const { io: cliIo } = io();
    const failed: RunResult = { ...ok, exitCode: 1, status: "failed" };
    expect(await main(["run"], cliIo, async () => failed)).toBe(1);
  });

  it.each([[["-h"]], [["--help"]], [["run", "--help"]]])(
    "%j prints usage to stdout and exits 0",
    async (argv) => {
      const { io: cliIo, out } = io();
      const runSpy = spyRun();
      expect(await main(argv, cliIo, runSpy)).toBe(0);
      expect(out.stdout).toEqual([USAGE]);
      expect(runSpy).not.toHaveBeenCalled();
    },
  );

  it.each([
    [[]],
    [["scan"]],
    [["run", "extra"]],
    [["run", "--bogus"]],
    [["run", "--config"]],
  ])("rejects %j with usage on stderr", async (argv) => {
    const { io: cliIo, out } = io();
    const runSpy = spyRun();
    expect(await main(argv, cliIo, runSpy)).not.toBe(0);
    expect(out.stdout).toEqual([]);
    expect(out.stderr).toContain(USAGE);
    expect(runSpy).not.toHaveBeenCalled();
  });

  it("reports unexpected errors and exits 1", async () => {
    const { io: cliIo, out } = io();
    const code = await main(["run"], cliIo, async () => {
      throw new Error("disk full");
    });
    expect(code).toBe(1);
    expect(out.stderr).toEqual(["job-radar: disk full"]);
  });
});

describe("default paths", () => {
  it("are gitignored local files", () => {
    expect(DEFAULT_MATCHES_PATH).toBe("data/matches.local.json");
    expect(DEFAULT_DIGEST_PATH).toBe("data/digest.local.md");
  });

  it("were not created or modified by these tests", async () => {
    const after = await Promise.all(DEFAULT_PATHS.map(mtimeOf));
    expect(after).toEqual(defaultsBefore);
  });
});
