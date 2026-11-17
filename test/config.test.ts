import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ConfigError,
  DEFAULT_CONFIG_PATH,
  loadConfig,
  parseConfig,
} from "../src/index.js";

// Every value in these tests is a fictional placeholder. Never read
// config/job-radar.local.json here.
const EXAMPLE_PATH = "config/job-radar.example.json";
const MINIMAL_FIXTURE = "test/fixtures/config.minimal.json";

let tmp: string;

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "job-radar-config-"));
});

afterAll(async () => {
  await rm(tmp, { recursive: true, force: true });
});

/** Applies `mutate` to a fresh copy of the example and returns the ConfigError. */
async function invalidExample(
  mutate: (cfg: any) => void, // eslint-disable-line @typescript-eslint/no-explicit-any
): Promise<ConfigError> {
  const cfg: unknown = JSON.parse(await readFile(EXAMPLE_PATH, "utf8"));
  mutate(cfg);
  try {
    parseConfig(cfg, "test-config");
  } catch (err) {
    expect(err).toBeInstanceOf(ConfigError);
    return err as ConfigError;
  }
  throw new Error("expected parseConfig to throw");
}

function expectIssueAt(err: ConfigError, path: string): void {
  expect(err.issues.some((issue) => issue.startsWith(`${path}: `))).toBe(true);
  expect(err.message).toContain(path);
}

describe("loadConfig success", () => {
  it("loads the committed example config", async () => {
    const cfg = await loadConfig(EXAMPLE_PATH);
    expect(cfg.profile.titlesInclude).toContain("Widget Engineer");
    expect(cfg.profile.titlesStretch).toEqual(["Senior Widget Engineer"]);
    expect(cfg.profile.seniority).toEqual({
      label: "mid-level",
      minYears: 2,
      maxYears: 5,
    });
    expect(cfg.profile.locations[0]).toEqual({
      name: "Example Metro",
      aliases: ["Example City", "Sample Town"],
    });
    expect(cfg.profile.remote.usRemote).toBe("fallback");
    expect(cfg.profile.pay).toEqual({
      minTopOfRangeBaseUsd: 100000,
      belowMinimum: "flag",
      unlistedPay: "keep",
    });
    expect(cfg.profile.industries).toEqual(["widgets", "sprockets"]);
    expect(cfg.watchlist.map((w) => w.provider).sort()).toEqual([
      "ashby",
      "greenhouse",
      "lever",
    ]);
  });

  it("fills defaults for optional fields", async () => {
    const cfg = await loadConfig(MINIMAL_FIXTURE);
    expect(cfg.profile.titlesStretch).toEqual([]);
    expect(cfg.profile.titlesExclude).toEqual([]);
    expect(cfg.profile.locations).toEqual([]);
    expect(cfg.profile.industries).toEqual([]);
    expect(cfg.profile.seniority).toEqual({ label: "entry-level" });
    expect(cfg.profile.pay.unlistedPay).toBe("keep");
    expect(cfg.profile.pay.belowMinimum).toBe("flag");
  });

  it("defaults to the gitignored local path", () => {
    expect(DEFAULT_CONFIG_PATH).toBe("config/job-radar.local.json");
  });
});

describe("loadConfig file errors", () => {
  it("reports a missing file", async () => {
    const missing = join(tmp, "does-not-exist.json");
    await expect(loadConfig(missing)).rejects.toThrow(ConfigError);
    await expect(loadConfig(missing)).rejects.toThrow(/Config file not found/);
  });

  it("reports malformed JSON", async () => {
    const bad = join(tmp, "malformed.json");
    await writeFile(bad, '{ "profile": ', "utf8");
    await expect(loadConfig(bad)).rejects.toThrow(/is not valid JSON/);
  });

  it("reports schema errors with the file path", async () => {
    const bad = join(tmp, "empty-object.json");
    await writeFile(bad, "{}", "utf8");
    const err = await loadConfig(bad).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConfigError);
    expect((err as ConfigError).configPath).toBe(bad);
    expect((err as ConfigError).message).toContain(bad);
    expectIssueAt(err as ConfigError, "profile");
    expectIssueAt(err as ConfigError, "watchlist");
  });
});

describe("parseConfig schema errors", () => {
  it("rejects a non-object root", () => {
    expect(() => parseConfig([])).toThrow(ConfigError);
  });

  it("rejects a missing required field", async () => {
    const err = await invalidExample((c) => delete c.profile.titlesInclude);
    expectIssueAt(err, "profile.titlesInclude");
  });

  it("rejects an empty include list", async () => {
    const err = await invalidExample((c) => (c.profile.titlesInclude = []));
    expectIssueAt(err, "profile.titlesInclude");
  });

  it("rejects wrong types", async () => {
    const err = await invalidExample(
      (c) => (c.profile.titlesStretch = "Senior Widget Engineer"),
    );
    expectIssueAt(err, "profile.titlesStretch");
  });

  it("rejects empty or blank strings", async () => {
    const err = await invalidExample((c) => {
      c.profile.titlesExclude = ["  "];
      c.profile.locations[1].aliases = [""];
      c.watchlist[0].company = "";
    });
    expectIssueAt(err, "profile.titlesExclude[0]");
    expectIssueAt(err, "profile.locations[1].aliases[0]");
    expectIssueAt(err, "watchlist[0].company");
  });

  it("rejects a location without a name", async () => {
    const err = await invalidExample(
      (c) => (c.profile.locations[0] = { aliases: ["Sample Town"] }),
    );
    expectIssueAt(err, "profile.locations[0].name");
  });

  it("rejects an invalid seniority year range", async () => {
    const err = await invalidExample((c) => {
      c.profile.seniority.minYears = 6;
      c.profile.seniority.maxYears = 3;
    });
    expectIssueAt(err, "profile.seniority.maxYears");
  });

  it("rejects negative or fractional years", async () => {
    const err = await invalidExample((c) => {
      c.profile.seniority.minYears = -1;
      c.profile.seniority.maxYears = 2.5;
    });
    expectIssueAt(err, "profile.seniority.minYears");
    expectIssueAt(err, "profile.seniority.maxYears");
  });

  it("rejects an invalid US-remote mode", async () => {
    const err = await invalidExample(
      (c) => (c.profile.remote.usRemote = "sometimes"),
    );
    expectIssueAt(err, "profile.remote.usRemote");
  });

  it("requires a location when US-remote is off", async () => {
    const err = await invalidExample((c) => {
      c.profile.locations = [];
      c.profile.remote.usRemote = "off";
    });
    expectIssueAt(err, "profile.locations");
  });

  it.each([0, -5, "100000", 1.5, null])(
    "rejects a bad pay minimum: %s",
    async (value) => {
      const err = await invalidExample(
        (c) => (c.profile.pay.minTopOfRangeBaseUsd = value),
      );
      expectIssueAt(err, "profile.pay.minTopOfRangeBaseUsd");
    },
  );

  it("rejects an unsupported unlisted-pay mode", async () => {
    const err = await invalidExample(
      (c) => (c.profile.pay.unlistedPay = "drop"),
    );
    expectIssueAt(err, "profile.pay.unlistedPay");
  });

  it("rejects an empty watchlist", async () => {
    const err = await invalidExample((c) => (c.watchlist = []));
    expectIssueAt(err, "watchlist");
  });

  it("rejects an unknown provider", async () => {
    const err = await invalidExample(
      (c) => (c.watchlist[0].provider = "examplehr"),
    );
    expectIssueAt(err, "watchlist[0].provider");
    expect(err.message).toContain("greenhouse");
  });

  it("rejects a missing or unsafe board token", async () => {
    const err = await invalidExample((c) => {
      delete c.watchlist[0].boardToken;
      c.watchlist[1].boardToken = "acme/../other";
    });
    expectIssueAt(err, "watchlist[0].boardToken");
    expectIssueAt(err, "watchlist[1].boardToken");
  });

  it("rejects duplicate boards", async () => {
    const err = await invalidExample((c) =>
      c.watchlist.push({ ...c.watchlist[0], company: "Example Corp Again" }),
    );
    expectIssueAt(err, "watchlist[3].boardToken");
  });

  it("rejects unknown keys such as the old boardId field", async () => {
    const err = await invalidExample(
      (c) => (c.watchlist[0].boardId = "example-corp"),
    );
    expectIssueAt(err, "watchlist[0]");
    expect(err.message).toContain("boardId");
  });

  it("lists every problem at once", async () => {
    const err = await invalidExample((c) => {
      c.profile.titlesInclude = [];
      c.watchlist[2].provider = "examplehr";
    });
    expect(err.issues.length).toBeGreaterThanOrEqual(2);
  });
});
