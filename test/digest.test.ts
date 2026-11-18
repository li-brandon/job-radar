import { describe, expect, it } from "vitest";
import {
  buildMatchesFile,
  matchesFileSchema,
  renderDigest,
  type Job,
  type JobMatch,
} from "../src/index.js";

// Every company, title, and place below is a fictional placeholder.

function match(job: Partial<Job>, score = 14): JobMatch {
  return {
    job: {
      company: "Example Corp",
      title: "Widget Engineer",
      location: "Example City, EX",
      remote: false,
      link: "https://example.com/jobs/1",
      postedAt: "2026-01-15T12:00:00.000Z",
      provider: "greenhouse",
      boardToken: "example-corp",
      sourceJobId: "1",
      ...job,
    },
    score,
    titleMatch: "include",
    locationMatch: "location",
  };
}

const NOW = new Date("2026-03-10T09:00:00.000Z");

describe("buildMatchesFile", () => {
  it("builds a valid version 1 file without pay fields", () => {
    const file = buildMatchesFile([match({})], NOW);
    expect(matchesFileSchema.parse(file)).toEqual(file);
    expect(file.matches[0]?.key).toBe(
      "example corp|widget engineer|example city",
    );
    expect(file.matches[0]?.firstSeenAt).toBe(NOW.toISOString());
    expect(Object.keys(file.matches[0]!).join(" ")).not.toMatch(/pay/i);
  });
});

describe("renderDigest", () => {
  it("lists each match with a title link, company, location, score, and date", () => {
    const second = match(
      {
        company: "Globex",
        title: "Senior Widget Engineer",
        location: "",
        remote: true,
        link: "https://example.com/jobs/2",
        postedAt: null,
      },
      7,
    );
    const file = buildMatchesFile([match({}), second], NOW);
    expect(renderDigest(file)).toBe(
      [
        "# job-radar: 2 new matches",
        "",
        "Generated 2026-03-10T09:00:00.000Z.",
        "",
        "1. [Widget Engineer](https://example.com/jobs/1)",
        "   - Company: Example Corp",
        "   - Location: Example City, EX",
        "   - Score: 14",
        "   - Posted: 2026-01-15",
        "",
        "2. [Senior Widget Engineer](https://example.com/jobs/2)",
        "   - Company: Globex",
        "   - Location: Remote",
        "   - Score: 7",
        "",
      ].join("\n"),
    );
  });

  it("uses a singular heading for one match", () => {
    const md = renderDigest(buildMatchesFile([match({})], NOW));
    expect(md.split("\n")[0]).toBe("# job-radar: 1 new match");
  });

  it("renders an empty run without entries", () => {
    expect(renderDigest(buildMatchesFile([], NOW))).toBe(
      "# job-radar: no new matches\n\nGenerated 2026-03-10T09:00:00.000Z.\n",
    );
  });

  it("escapes markdown in job text and link URLs", () => {
    const job = match({
      title: "Widget [Gears] *Engineer*",
      link: "https://example.com/jobs/(3) a",
    });
    const md = renderDigest(buildMatchesFile([job], NOW));
    expect(md).toContain(
      "1. [Widget \\[Gears\\] \\*Engineer\\*](https://example.com/jobs/%283%29%20a)",
    );
  });
});
