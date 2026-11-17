import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import {
  USER_AGENT,
  fetchGreenhouseJobs,
  greenhouseJobsUrl,
  isRemoteLocation,
  type WatchlistEntry,
} from "../src/index.js";
import { NETWORK_DISABLED_MESSAGE } from "./setup.js";

// Every company, board token, title, and place below is a fictional placeholder.
// No test here may reach the live Greenhouse API: fetch is always a stub.
const FIXTURES = "test/fixtures/greenhouse";

const EXAMPLE_CORP: WatchlistEntry = {
  company: "Example Corp",
  provider: "greenhouse",
  boardToken: "example-corp",
};
const INITECH: WatchlistEntry = {
  company: "Initech",
  provider: "greenhouse",
  boardToken: "initech",
};
const GLOBEX: WatchlistEntry = {
  company: "Globex",
  provider: "greenhouse",
  boardToken: "globex",
};

async function fixture(name: string): Promise<string> {
  return readFile(`${FIXTURES}/${name}.json`, "utf8");
}

function jsonResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type Route = () => Response | Promise<Response>;

/** Fetch stub that serves canned responses by URL and throws on anything else. */
function stubFetch(routes: Record<string, Route>) {
  return vi.fn<typeof fetch>(async (input) => {
    const url = String(input);
    const route = routes[url];
    if (!route) throw new Error(`unexpected request to ${url}`);
    return route();
  });
}

describe("greenhouseJobsUrl", () => {
  it("builds the public Job Board API URL for a token", () => {
    expect(greenhouseJobsUrl("example-corp")).toBe(
      "https://boards-api.greenhouse.io/v1/boards/example-corp/jobs",
    );
  });
});

describe("isRemoteLocation", () => {
  it.each([
    ["Remote", true],
    ["REMOTE", true],
    ["Remote - Exampleland", true],
    ["Example City, EX (remote)", true],
    ["Example City, EX", false],
    ["Hybrid - Sample Town", false],
    ["Remoteville", false],
    ["", false],
  ])("%j -> %s", (location, expected) => {
    expect(isRemoteLocation(location)).toBe(expected);
  });
});

describe("fetchGreenhouseJobs", () => {
  it("requests the board with a GET and a read-only User-Agent", async () => {
    const body = await fixture("example-corp");
    const fetch = stubFetch({
      [greenhouseJobsUrl("example-corp")]: () => jsonResponse(body),
    });

    await fetchGreenhouseJobs([EXAMPLE_CORP], { fetch, delayMs: 0 });

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(
      "https://boards-api.greenhouse.io/v1/boards/example-corp/jobs",
    );
    expect(init?.method).toBe("GET");
    expect(new Headers(init?.headers).get("User-Agent")).toBe(USER_AGENT);
    expect(USER_AGENT).toMatch(/^job-radar\/\S+ \(.*read-only\)$/);
  });

  it("maps each opening to a Job record", async () => {
    const body = await fixture("example-corp");
    const fetch = stubFetch({
      [greenhouseJobsUrl("example-corp")]: () => jsonResponse(body),
    });

    const { jobs, errors } = await fetchGreenhouseJobs([EXAMPLE_CORP], {
      fetch,
      delayMs: 0,
    });

    expect(errors).toEqual([]);
    expect(jobs).toEqual([
      {
        company: "Example Corp",
        title: "Widget Engineer",
        location: "Example City, EX",
        remote: false,
        link: "https://boards.greenhouse.io/example-corp/jobs/1001",
        postedAt: "2026-01-15T12:00:00.000Z",
        provider: "greenhouse",
        boardToken: "example-corp",
        sourceJobId: "1001",
      },
      {
        company: "Example Corp",
        title: "Senior Widget Engineer",
        location: "Remote - Exampleland",
        remote: true,
        link: "https://boards.greenhouse.io/example-corp/jobs/1002",
        // first_published wins over updated_at, normalized to UTC.
        postedAt: "2026-01-20T14:30:00.000Z",
        provider: "greenhouse",
        boardToken: "example-corp",
        sourceJobId: "1002",
      },
      {
        company: "Example Corp",
        title: "Backend Widget Engineer",
        location: "Hybrid - Sample Town",
        remote: false,
        link: "https://boards.greenhouse.io/example-corp/jobs/1003",
        // No first_published: falls back to updated_at.
        postedAt: "2026-02-03T08:00:00.000Z",
        provider: "greenhouse",
        boardToken: "example-corp",
        sourceJobId: "1003",
      },
      {
        company: "Example Corp",
        title: "Sprocket Engineer",
        // No location object: empty string, not remote.
        location: "",
        remote: false,
        link: "https://boards.greenhouse.io/example-corp/jobs/1004",
        // Neither date present.
        postedAt: null,
        provider: "greenhouse",
        boardToken: "example-corp",
        sourceJobId: "1004",
      },
    ]);
  });

  it("uses the watchlist company name, not anything from the payload", async () => {
    const body = await fixture("initech");
    const fetch = stubFetch({
      [greenhouseJobsUrl("initech")]: () => jsonResponse(body),
    });
    const renamed = { ...INITECH, company: "Initech Widgets" };

    const { jobs } = await fetchGreenhouseJobs([renamed], {
      fetch,
      delayMs: 0,
    });

    expect(jobs.map((job) => job.company)).toEqual(["Initech Widgets"]);
  });

  it("only requests greenhouse entries", async () => {
    const body = await fixture("initech");
    const fetch = stubFetch({
      [greenhouseJobsUrl("initech")]: () => jsonResponse(body),
    });

    const { jobs, errors } = await fetchGreenhouseJobs(
      [
        { company: "Acme", provider: "lever", boardToken: "acme" },
        INITECH,
        { company: "Globex", provider: "ashby", boardToken: "globex" },
      ],
      { fetch, delayMs: 0 },
    );

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(jobs).toHaveLength(1);
    expect(errors).toEqual([]);
  });

  it("returns nothing and makes no requests when there are no greenhouse entries", async () => {
    const fetch = stubFetch({});
    const result = await fetchGreenhouseJobs(
      [{ company: "Acme", provider: "lever", boardToken: "acme" }],
      { fetch, delayMs: 0 },
    );
    expect(result).toEqual({ jobs: [], errors: [] });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps going when one board returns 404 and another throws", async () => {
    const exampleBody = await fixture("example-corp");
    const initechBody = await fixture("initech");
    const fetch = stubFetch({
      [greenhouseJobsUrl("globex")]: () =>
        new Response("Not Found", { status: 404, statusText: "Not Found" }),
      [greenhouseJobsUrl("example-corp")]: () => jsonResponse(exampleBody),
      [greenhouseJobsUrl("acme")]: () => {
        throw new TypeError("fetch failed");
      },
      [greenhouseJobsUrl("initech")]: () => jsonResponse(initechBody),
    });
    const log = vi.fn();
    const ACME: WatchlistEntry = {
      company: "Acme",
      provider: "greenhouse",
      boardToken: "acme",
    };

    const { jobs, errors } = await fetchGreenhouseJobs(
      [GLOBEX, EXAMPLE_CORP, ACME, INITECH],
      { fetch, delayMs: 0, log },
    );

    expect(fetch).toHaveBeenCalledTimes(4);
    expect(jobs.map((job) => `${job.boardToken}:${job.sourceJobId}`)).toEqual([
      "example-corp:1001",
      "example-corp:1002",
      "example-corp:1003",
      "example-corp:1004",
      "initech:2001",
    ]);
    expect(errors).toEqual([
      {
        provider: "greenhouse",
        company: "Globex",
        boardToken: "globex",
        url: greenhouseJobsUrl("globex"),
        message: "HTTP 404 Not Found",
      },
      {
        provider: "greenhouse",
        company: "Acme",
        boardToken: "acme",
        url: greenhouseJobsUrl("acme"),
        message: "network error: fetch failed",
      },
    ]);
    expect(log).toHaveBeenCalledTimes(2);
    expect(log.mock.calls[0]![0]).toContain("Globex");
    expect(log.mock.calls[0]![0]).toContain('"globex"');
    expect(log.mock.calls[0]![0]).toContain("HTTP 404");
    expect(log.mock.calls[1]![0]).toContain("Acme");
    expect(log.mock.calls[1]![0]).toContain("network error");
  });

  it("treats invalid JSON as a per-board failure", async () => {
    const initechBody = await fixture("initech");
    const fetch = stubFetch({
      [greenhouseJobsUrl("example-corp")]: () =>
        jsonResponse("<html>not json</html>"),
      [greenhouseJobsUrl("initech")]: () => jsonResponse(initechBody),
    });
    const log = vi.fn();

    const { jobs, errors } = await fetchGreenhouseJobs(
      [EXAMPLE_CORP, INITECH],
      { fetch, delayMs: 0, log },
    );

    expect(jobs.map((job) => job.sourceJobId)).toEqual(["2001"]);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.boardToken).toBe("example-corp");
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
      [greenhouseJobsUrl("example-corp")]: () => jsonResponse(body),
      [greenhouseJobsUrl("initech")]: () => jsonResponse(initechBody),
    });

    const { jobs, errors } = await fetchGreenhouseJobs(
      [EXAMPLE_CORP, INITECH],
      { fetch, delayMs: 0, log: () => {} },
    );

    expect(jobs.map((job) => job.sourceJobId)).toEqual(["2001"]);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.company).toBe("Example Corp");
    expect(errors[0]!.message).toMatch(/^unexpected payload: jobs/);
  });

  it("fails closed when a test does not inject fetch", async () => {
    // The global fetch is stubbed in test/setup.ts, so the default path never
    // reaches the network. The board is recorded as failed instead.
    const log = vi.fn();
    const { jobs, errors } = await fetchGreenhouseJobs([EXAMPLE_CORP], {
      delayMs: 0,
      log,
    });

    expect(jobs).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toContain(NETWORK_DISABLED_MESSAGE);
  });
});
