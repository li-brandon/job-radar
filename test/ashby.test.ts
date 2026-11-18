import { describe, expect, it, vi } from "vitest";
import {
  USER_AGENT,
  ashbyJobBoardUrl,
  fetchAshbyJobs,
  type WatchlistEntry,
} from "../src/index.js";
import { jsonResponse, readFixture, stubFetch } from "./fetch-stub.js";
import { NETWORK_DISABLED_MESSAGE } from "./setup.js";

// Every company, board token, title, and place below is a fictional placeholder.
// No test here may reach the live Ashby API: fetch is always a stub.
const GLOBEX: WatchlistEntry = {
  company: "Globex",
  provider: "ashby",
  boardToken: "globex",
};
const INITECH: WatchlistEntry = {
  company: "Initech",
  provider: "ashby",
  boardToken: "initech",
};
const ACME: WatchlistEntry = {
  company: "Acme",
  provider: "ashby",
  boardToken: "acme",
};

const fixture = (name: string) => readFixture(`ashby/${name}`);

describe("ashbyJobBoardUrl", () => {
  it("builds the public Job Posting API URL for a token", () => {
    expect(ashbyJobBoardUrl("globex")).toBe(
      "https://api.ashbyhq.com/posting-api/job-board/globex",
    );
  });

  it("encodes the token", () => {
    expect(ashbyJobBoardUrl("a/b c")).toBe(
      "https://api.ashbyhq.com/posting-api/job-board/a%2Fb%20c",
    );
  });
});

describe("fetchAshbyJobs", () => {
  it("requests the board with a GET and a read-only User-Agent", async () => {
    const body = await fixture("globex");
    const fetch = stubFetch({
      [ashbyJobBoardUrl("globex")]: () => jsonResponse(body),
    });

    await fetchAshbyJobs([GLOBEX], { fetch, delayMs: 0 });

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("https://api.ashbyhq.com/posting-api/job-board/globex");
    expect(init?.method).toBe("GET");
    expect(new Headers(init?.headers).get("User-Agent")).toBe(USER_AGENT);
  });

  it("maps each opening to a Job record", async () => {
    const body = await fixture("globex");
    const fetch = stubFetch({
      [ashbyJobBoardUrl("globex")]: () => jsonResponse(body),
    });

    const { jobs, errors } = await fetchAshbyJobs([GLOBEX], {
      fetch,
      delayMs: 0,
    });

    expect(errors).toEqual([]);
    expect(jobs).toEqual([
      {
        company: "Globex",
        title: "Widget Engineer",
        location: "Example City, EX",
        remote: false,
        // jobUrl, not applyUrl.
        link: "https://jobs.ashbyhq.com/globex/globex-job-1",
        postedAt: "2026-01-15T12:00:00.000Z",
        provider: "ashby",
        boardToken: "globex",
        sourceJobId: "globex-job-1",
      },
      {
        company: "Globex",
        title: "Senior Widget Engineer",
        location: "Example City, EX",
        // isRemote flag.
        remote: true,
        link: "https://jobs.ashbyhq.com/globex/globex-job-2",
        // No publishedAt: falls back to listedAt, normalized to UTC.
        postedAt: "2026-01-20T14:30:00.000Z",
        provider: "ashby",
        boardToken: "globex",
        sourceJobId: "globex-job-2",
      },
      {
        company: "Globex",
        title: "Backend Widget Engineer",
        location: "Remote (Exampleland)",
        // Location text says remote, even though isRemote is false.
        remote: true,
        link: "https://jobs.ashbyhq.com/globex/globex-job-3",
        // publishedAt wins over listedAt.
        postedAt: "2026-02-03T08:00:00.000Z",
        provider: "ashby",
        boardToken: "globex",
        sourceJobId: "globex-job-3",
      },
      {
        company: "Globex",
        title: "Sprocket Engineer",
        // No locationName: empty string, not remote.
        location: "",
        remote: false,
        link: "https://jobs.ashbyhq.com/globex/globex-job-4",
        // Neither date present.
        postedAt: null,
        provider: "ashby",
        boardToken: "globex",
        sourceJobId: "globex-job-4",
      },
    ]);
  });

  it("uses the watchlist company name, not anything from the payload", async () => {
    const body = await fixture("initech");
    const fetch = stubFetch({
      [ashbyJobBoardUrl("initech")]: () => jsonResponse(body),
    });

    const { jobs } = await fetchAshbyJobs(
      [{ ...INITECH, company: "Initech Widgets" }],
      { fetch, delayMs: 0 },
    );

    expect(jobs.map((job) => job.company)).toEqual(["Initech Widgets"]);
  });

  it("only requests ashby entries", async () => {
    const body = await fixture("initech");
    const fetch = stubFetch({
      [ashbyJobBoardUrl("initech")]: () => jsonResponse(body),
    });

    const { jobs, errors } = await fetchAshbyJobs(
      [
        { company: "Acme", provider: "greenhouse", boardToken: "acme" },
        INITECH,
        { company: "Globex", provider: "lever", boardToken: "globex" },
      ],
      { fetch, delayMs: 0 },
    );

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(jobs).toHaveLength(1);
    expect(errors).toEqual([]);
  });

  it("requests a repeated board only once", async () => {
    const body = await fixture("initech");
    const fetch = stubFetch({
      [ashbyJobBoardUrl("initech")]: () => jsonResponse(body),
    });

    const { jobs } = await fetchAshbyJobs(
      [INITECH, { ...INITECH, company: "Initech Again" }],
      { fetch, delayMs: 0 },
    );

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(jobs.map((job) => job.company)).toEqual(["Initech"]);
  });

  it("keeps going when one board returns 404 and another throws", async () => {
    const globexBody = await fixture("globex");
    const initechBody = await fixture("initech");
    const fetch = stubFetch({
      [ashbyJobBoardUrl("acme")]: () =>
        new Response("Not Found", { status: 404, statusText: "Not Found" }),
      [ashbyJobBoardUrl("globex")]: () => jsonResponse(globexBody),
      [ashbyJobBoardUrl("example-corp")]: () => {
        throw new TypeError("fetch failed");
      },
      [ashbyJobBoardUrl("initech")]: () => jsonResponse(initechBody),
    });
    const log = vi.fn();
    const EXAMPLE_CORP: WatchlistEntry = {
      company: "Example Corp",
      provider: "ashby",
      boardToken: "example-corp",
    };

    const { jobs, errors } = await fetchAshbyJobs(
      [ACME, GLOBEX, EXAMPLE_CORP, INITECH],
      { fetch, delayMs: 0, log },
    );

    expect(fetch).toHaveBeenCalledTimes(4);
    expect(jobs.map((job) => `${job.boardToken}:${job.sourceJobId}`)).toEqual([
      "globex:globex-job-1",
      "globex:globex-job-2",
      "globex:globex-job-3",
      "globex:globex-job-4",
      "initech:initech-job-1",
    ]);
    expect(errors).toEqual([
      {
        provider: "ashby",
        company: "Acme",
        boardToken: "acme",
        url: ashbyJobBoardUrl("acme"),
        message: "HTTP 404 Not Found",
      },
      {
        provider: "ashby",
        company: "Example Corp",
        boardToken: "example-corp",
        url: ashbyJobBoardUrl("example-corp"),
        message: "network error: fetch failed",
      },
    ]);
    expect(log).toHaveBeenCalledTimes(2);
    expect(log.mock.calls[0]![0]).toContain("[ashby] Acme");
    expect(log.mock.calls[0]![0]).toContain('"acme"');
    expect(log.mock.calls[0]![0]).toContain("HTTP 404");
    expect(log.mock.calls[1]![0]).toContain("Example Corp");
    expect(log.mock.calls[1]![0]).toContain("network error");
  });

  it("treats invalid JSON as a per-board failure", async () => {
    const initechBody = await fixture("initech");
    const fetch = stubFetch({
      [ashbyJobBoardUrl("globex")]: () => jsonResponse("<html>not json</html>"),
      [ashbyJobBoardUrl("initech")]: () => jsonResponse(initechBody),
    });
    const log = vi.fn();

    const { jobs, errors } = await fetchAshbyJobs([GLOBEX, INITECH], {
      fetch,
      delayMs: 0,
      log,
    });

    expect(jobs.map((job) => job.sourceJobId)).toEqual(["initech-job-1"]);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.boardToken).toBe("globex");
    expect(errors[0]!.message).toMatch(/^invalid JSON: /);
    expect(log).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["a malformed jobs array", "malformed"],
    ["a missing jobs key", null],
  ])("treats %s as a per-board failure", async (_label, name) => {
    const body = name ? await fixture(name) : JSON.stringify({ meta: {} });
    const initechBody = await fixture("initech");
    const fetch = stubFetch({
      [ashbyJobBoardUrl("globex")]: () => jsonResponse(body),
      [ashbyJobBoardUrl("initech")]: () => jsonResponse(initechBody),
    });

    const { jobs, errors } = await fetchAshbyJobs([GLOBEX, INITECH], {
      fetch,
      delayMs: 0,
      log: () => {},
    });

    expect(jobs.map((job) => job.sourceJobId)).toEqual(["initech-job-1"]);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.company).toBe("Globex");
    expect(errors[0]!.message).toMatch(/^unexpected payload: jobs/);
  });

  it("fails closed when a test does not inject fetch", async () => {
    // The global fetch is stubbed in test/setup.ts, so the default path never
    // reaches the network. The board is recorded as failed instead.
    const { jobs, errors } = await fetchAshbyJobs([GLOBEX], {
      delayMs: 0,
      log: () => {},
    });

    expect(jobs).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toContain(NETWORK_DISABLED_MESSAGE);
  });
});
