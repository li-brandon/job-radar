import { describe, expect, it, vi } from "vitest";
import {
  USER_AGENT,
  fetchLeverJobs,
  leverPostingsUrl,
  type WatchlistEntry,
} from "../src/index.js";
import { jsonResponse, readFixture, stubFetch } from "./fetch-stub.js";
import { NETWORK_DISABLED_MESSAGE } from "./setup.js";

// Every company, board token, title, and place below is a fictional placeholder.
// No test here may reach the live Lever API: fetch is always a stub.
const ACME: WatchlistEntry = {
  company: "Acme",
  provider: "lever",
  boardToken: "acme",
};
const INITECH: WatchlistEntry = {
  company: "Initech",
  provider: "lever",
  boardToken: "initech",
};
const GLOBEX: WatchlistEntry = {
  company: "Globex",
  provider: "lever",
  boardToken: "globex",
};

const fixture = (name: string) => readFixture(`lever/${name}`);

describe("leverPostingsUrl", () => {
  it("builds the public Postings API URL for a token", () => {
    expect(leverPostingsUrl("acme")).toBe(
      "https://api.lever.co/v0/postings/acme?mode=json",
    );
  });

  it("encodes the token", () => {
    expect(leverPostingsUrl("a/b c")).toBe(
      "https://api.lever.co/v0/postings/a%2Fb%20c?mode=json",
    );
  });
});

describe("fetchLeverJobs", () => {
  it("requests the board with a GET and a read-only User-Agent", async () => {
    const body = await fixture("acme");
    const fetch = stubFetch({
      [leverPostingsUrl("acme")]: () => jsonResponse(body),
    });

    await fetchLeverJobs([ACME], { fetch, delayMs: 0 });

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("https://api.lever.co/v0/postings/acme?mode=json");
    expect(init?.method).toBe("GET");
    expect(new Headers(init?.headers).get("User-Agent")).toBe(USER_AGENT);
  });

  it("maps each posting to a Job record", async () => {
    const body = await fixture("acme");
    const fetch = stubFetch({
      [leverPostingsUrl("acme")]: () => jsonResponse(body),
    });

    const { jobs, errors } = await fetchLeverJobs([ACME], {
      fetch,
      delayMs: 0,
    });

    expect(errors).toEqual([]);
    expect(jobs).toEqual([
      {
        company: "Acme",
        title: "Widget Engineer",
        location: "Example City, EX",
        remote: false,
        // hostedUrl, not applyUrl.
        link: "https://jobs.lever.co/acme/acme-0001",
        // Epoch milliseconds.
        postedAt: "2026-01-15T12:00:00.000Z",
        provider: "lever",
        boardToken: "acme",
        sourceJobId: "acme-0001",
      },
      {
        company: "Acme",
        title: "Senior Widget Engineer",
        location: "Example City, EX",
        // workplaceType "Remote", any case.
        remote: true,
        link: "https://jobs.lever.co/acme/acme-0002",
        // ISO string with an offset, normalized to UTC.
        postedAt: "2026-01-20T14:30:00.000Z",
        provider: "lever",
        boardToken: "acme",
        sourceJobId: "acme-0002",
      },
      {
        company: "Acme",
        title: "Backend Widget Engineer",
        location: "Remote - Exampleland",
        // Location text says remote, even though workplaceType is "hybrid".
        remote: true,
        link: "https://jobs.lever.co/acme/acme-0003",
        // No createdAt.
        postedAt: null,
        provider: "lever",
        boardToken: "acme",
        sourceJobId: "acme-0003",
      },
      {
        company: "Acme",
        title: "Sprocket Engineer",
        // No categories: empty string, not remote.
        location: "",
        remote: false,
        link: "https://jobs.lever.co/acme/acme-0004",
        postedAt: null,
        provider: "lever",
        boardToken: "acme",
        sourceJobId: "acme-0004",
      },
    ]);
  });

  it("uses the watchlist company name, not anything from the payload", async () => {
    const body = await fixture("initech");
    const fetch = stubFetch({
      [leverPostingsUrl("initech")]: () => jsonResponse(body),
    });

    const { jobs } = await fetchLeverJobs(
      [{ ...INITECH, company: "Initech Widgets" }],
      { fetch, delayMs: 0 },
    );

    expect(jobs.map((job) => job.company)).toEqual(["Initech Widgets"]);
  });

  it("only requests lever entries", async () => {
    const body = await fixture("initech");
    const fetch = stubFetch({
      [leverPostingsUrl("initech")]: () => jsonResponse(body),
    });

    const { jobs, errors } = await fetchLeverJobs(
      [
        { company: "Acme", provider: "greenhouse", boardToken: "acme" },
        INITECH,
        { company: "Globex", provider: "ashby", boardToken: "globex" },
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
      [leverPostingsUrl("initech")]: () => jsonResponse(body),
    });

    const { jobs } = await fetchLeverJobs(
      [INITECH, { ...INITECH, company: "Initech Again" }],
      { fetch, delayMs: 0 },
    );

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(jobs.map((job) => job.company)).toEqual(["Initech"]);
  });

  it("keeps going when one board returns 404 and another throws", async () => {
    const acmeBody = await fixture("acme");
    const initechBody = await fixture("initech");
    const fetch = stubFetch({
      [leverPostingsUrl("globex")]: () =>
        new Response('{"ok":false,"error":"Document not found"}', {
          status: 404,
          statusText: "Not Found",
        }),
      [leverPostingsUrl("acme")]: () => jsonResponse(acmeBody),
      [leverPostingsUrl("example-corp")]: () => {
        throw new TypeError("fetch failed");
      },
      [leverPostingsUrl("initech")]: () => jsonResponse(initechBody),
    });
    const log = vi.fn();
    const EXAMPLE_CORP: WatchlistEntry = {
      company: "Example Corp",
      provider: "lever",
      boardToken: "example-corp",
    };

    const { jobs, errors } = await fetchLeverJobs(
      [GLOBEX, ACME, EXAMPLE_CORP, INITECH],
      { fetch, delayMs: 0, log },
    );

    expect(fetch).toHaveBeenCalledTimes(4);
    expect(jobs.map((job) => `${job.boardToken}:${job.sourceJobId}`)).toEqual([
      "acme:acme-0001",
      "acme:acme-0002",
      "acme:acme-0003",
      "acme:acme-0004",
      "initech:initech-0001",
    ]);
    expect(errors).toEqual([
      {
        provider: "lever",
        company: "Globex",
        boardToken: "globex",
        url: leverPostingsUrl("globex"),
        message: "HTTP 404 Not Found",
      },
      {
        provider: "lever",
        company: "Example Corp",
        boardToken: "example-corp",
        url: leverPostingsUrl("example-corp"),
        message: "network error: fetch failed",
      },
    ]);
    expect(log).toHaveBeenCalledTimes(2);
    expect(log.mock.calls[0]![0]).toContain("[lever] Globex");
    expect(log.mock.calls[0]![0]).toContain('"globex"');
    expect(log.mock.calls[0]![0]).toContain("HTTP 404");
    expect(log.mock.calls[1]![0]).toContain("Example Corp");
    expect(log.mock.calls[1]![0]).toContain("network error");
  });

  it("treats invalid JSON as a per-board failure", async () => {
    const initechBody = await fixture("initech");
    const fetch = stubFetch({
      [leverPostingsUrl("acme")]: () => jsonResponse("<html>not json</html>"),
      [leverPostingsUrl("initech")]: () => jsonResponse(initechBody),
    });
    const log = vi.fn();

    const { jobs, errors } = await fetchLeverJobs([ACME, INITECH], {
      fetch,
      delayMs: 0,
      log,
    });

    expect(jobs.map((job) => job.sourceJobId)).toEqual(["initech-0001"]);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.boardToken).toBe("acme");
    expect(errors[0]!.message).toMatch(/^invalid JSON: /);
    expect(log).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["a malformed posting", "malformed", /^unexpected payload: 0\.text/],
    ["an object instead of an array", null, /^unexpected payload: \(root\)/],
  ])("treats %s as a per-board failure", async (_label, name, message) => {
    const body = name ? await fixture(name) : JSON.stringify({ jobs: [] });
    const initechBody = await fixture("initech");
    const fetch = stubFetch({
      [leverPostingsUrl("acme")]: () => jsonResponse(body),
      [leverPostingsUrl("initech")]: () => jsonResponse(initechBody),
    });

    const { jobs, errors } = await fetchLeverJobs([ACME, INITECH], {
      fetch,
      delayMs: 0,
      log: () => {},
    });

    expect(jobs.map((job) => job.sourceJobId)).toEqual(["initech-0001"]);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.company).toBe("Acme");
    expect(errors[0]!.message).toMatch(message);
  });

  it("fails closed when a test does not inject fetch", async () => {
    // The global fetch is stubbed in test/setup.ts, so the default path never
    // reaches the network. The board is recorded as failed instead.
    const { jobs, errors } = await fetchLeverJobs([ACME], {
      delayMs: 0,
      log: () => {},
    });

    expect(jobs).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toContain(NETWORK_DISABLED_MESSAGE);
  });
});
