import { describe, expect, it } from "vitest";
import {
  SCORE_WEIGHTS,
  matchJob,
  matchJobs,
  normalizeTitle,
  type Job,
  type MatchProfile,
  type UsRemoteMode,
} from "../src/index.js";

// Every company, title, and place below is a fictional placeholder.

function job(overrides: Partial<Job> = {}): Job {
  return {
    company: "Example Corp",
    title: "Widget Engineer",
    location: "Example City",
    remote: false,
    link: "https://example.com/jobs/1",
    postedAt: null,
    provider: "greenhouse",
    boardToken: "example-corp",
    sourceJobId: "1",
    ...overrides,
  };
}

function profile(overrides: Partial<MatchProfile> = {}): MatchProfile {
  return {
    titlesInclude: ["Widget Engineer", "Backend Widget Engineer"],
    titlesStretch: ["Senior Widget Engineer"],
    titlesExclude: ["Manager", "Intern"],
    companiesExclude: ["Initech"],
    locations: [
      { name: "Example Metro", aliases: ["Example City", "Sample Town"] },
      { name: "Metropolis", aliases: [] },
    ],
    remote: { usRemote: "fallback" },
    ...overrides,
  };
}

const REMOTE_US = { location: "Remote - US", remote: true };

describe("normalizeTitle", () => {
  it.each([
    ["Sr. Widget Engineer", "senior widget engineer"],
    ["Sr Widget Engineer", "senior widget engineer"],
    ["SENIOR   widget-engineer", "senior widget engineer"],
    ["Jr. Widget Engineer", "junior widget engineer"],
    ["Widget Engineer (Gears & Cogs)", "widget engineer gears and cogs"],
    ["  Widget Engineer, II  ", "widget engineer ii"],
  ])("%j -> %j", (input, expected) => {
    expect(normalizeTitle(input)).toBe(expected);
  });

  it("does not expand abbreviations inside other words", () => {
    expect(normalizeTitle("Srs Widget Engineer")).toBe("srs widget engineer");
  });
});

describe("title matching and scoring", () => {
  it("ranks include titles above stretch titles", () => {
    const p = profile();
    const include = matchJob(job({ title: "Widget Engineer" }), p);
    const stretch = matchJob(job({ title: "Senior Widget Engineer" }), p);
    expect(include?.titleMatch).toBe("include");
    expect(stretch?.titleMatch).toBe("stretch");
    expect(include!.score).toBeGreaterThan(stretch!.score);
  });

  it('matches "Sr." against a "Senior" profile title', () => {
    const m = matchJob(job({ title: "Sr. Widget Engineer" }), profile());
    expect(m?.titleMatch).toBe("stretch");
  });

  it('matches "Senior" against a "Sr" profile title', () => {
    const p = profile({
      titlesInclude: ["Sprocket Engineer"],
      titlesStretch: ["Sr Widget Engineer"],
    });
    const m = matchJob(job({ title: "Senior Widget Engineer" }), p);
    expect(m?.titleMatch).toBe("stretch");
  });

  it("matches a profile title inside a longer job title", () => {
    const m = matchJob(job({ title: "Widget Engineer, Payments" }), profile());
    expect(m?.titleMatch).toBe("include");
  });

  it("lets the longest matching phrase decide", () => {
    // "Backend Widget Engineer" (include) matches; "Senior Widget Engineer"
    // is not a contiguous phrase in this title, so include wins.
    const title = "Senior Backend Widget Engineer";
    const m = matchJob(job({ title }), profile());
    expect(m?.titleMatch).toBe("include");
  });

  it("gives ties to include", () => {
    const p = profile({ titlesStretch: ["Widget Engineer"] });
    const m = matchJob(job({ title: "Widget Engineer" }), p);
    expect(m?.titleMatch).toBe("include");
  });

  it("drops titles that match neither list", () => {
    expect(matchJob(job({ title: "Sprocket Engineer" }), profile())).toBeNull();
    expect(matchJob(job({ title: "Widget" }), profile())).toBeNull();
  });

  it("uses the documented weights", () => {
    const m = matchJob(job(), profile());
    const { title, location } = SCORE_WEIGHTS;
    expect(m?.score).toBe(title.include + location.location);
  });
});

describe("exclusions", () => {
  it.each([
    "Widget Engineering Manager",
    "Widget Manager",
    "Manager, Widget Engineer Team",
    "Widget Engineer Intern",
    "widget engineer - INTERN",
  ])("drops excluded keyword title %j", (title) => {
    expect(matchJob(job({ title }), profile())).toBeNull();
  });

  it("matches exclude keywords on whole words only", () => {
    const title = "Internal Tools Widget Engineer";
    expect(matchJob(job({ title }), profile())).not.toBeNull();
  });

  it("expands abbreviations in exclude keywords too", () => {
    const p = profile({ titlesExclude: ["Senior"] });
    expect(matchJob(job({ title: "Sr. Widget Engineer" }), p)).toBeNull();
  });

  it.each(["Initech", "initech", "  INITECH ", "Initech."])(
    "drops excluded company %j",
    (company) => {
      expect(matchJob(job({ company }), profile())).toBeNull();
    },
  );

  it("does not drop companies that only contain an excluded name", () => {
    const m = matchJob(job({ company: "Initech Labs" }), profile());
    expect(m).not.toBeNull();
  });
});

describe("location matching", () => {
  it.each(["Example Metro", "Example City, EX", "sample town", "Metropolis"])(
    "matches a location name or alias: %j",
    (location) => {
      const m = matchJob(job({ location }), profile());
      expect(m?.locationMatch).toBe("location");
    },
  );

  it("does not match a partial word", () => {
    const p = profile({ locations: [{ name: "Metro", aliases: [] }] });
    const m = matchJob(job({ location: "Metropolis" }), p);
    expect(m?.locationMatch).toBe("none");
  });

  it("keeps on-site jobs elsewhere but ranks them lowest", () => {
    const m = matchJob(job({ location: "Elsewhere" }), profile());
    expect(m?.locationMatch).toBe("none");
    expect(m?.score).toBe(SCORE_WEIGHTS.title.include);
  });
});

describe("remote modes", () => {
  const modes = (usRemote: UsRemoteMode) => profile({ remote: { usRemote } });

  it("fallback keeps remote jobs below location matches", () => {
    const remote = matchJob(job(REMOTE_US), modes("fallback"));
    const local = matchJob(job(), modes("fallback"));
    expect(remote?.locationMatch).toBe("remote");
    expect(remote!.score).toBeLessThan(local!.score);
  });

  it("allowed scores remote jobs like a location match", () => {
    const remote = matchJob(job(REMOTE_US), modes("allowed"));
    const local = matchJob(job(), modes("allowed"));
    expect(remote?.locationMatch).toBe("remote");
    expect(remote!.score).toBe(local!.score);
  });

  it("off drops remote jobs that match no location", () => {
    expect(matchJob(job(REMOTE_US), modes("off"))).toBeNull();
  });

  it("off keeps remote jobs that also match a location", () => {
    const location = "Remote or Example City";
    const m = matchJob(job({ location, remote: true }), modes("off"));
    expect(m?.locationMatch).toBe("location");
  });

  it("off keeps on-site jobs (only remote jobs are dropped)", () => {
    const m = matchJob(job({ location: "Elsewhere" }), modes("off"));
    expect(m?.locationMatch).toBe("none");
  });

  it("uses the remote flag, not only the location text", () => {
    const m = matchJob(job({ location: "", remote: true }), modes("fallback"));
    expect(m?.locationMatch).toBe("remote");
  });
});

describe("matchJobs", () => {
  it("drops, scores, and sorts highest first", () => {
    const jobs = [
      job({
        sourceJobId: "stretch-remote",
        title: "Sr. Widget Engineer",
        ...REMOTE_US,
      }),
      job({ sourceJobId: "include-none", location: "Elsewhere" }),
      job({ sourceJobId: "excluded", company: "Initech" }),
      job({ sourceJobId: "include-local-a" }),
      job({ sourceJobId: "manager", title: "Widget Manager" }),
      job({ sourceJobId: "include-local-b", location: "Metropolis" }),
      job({ sourceJobId: "include-remote", ...REMOTE_US }),
    ];
    const result = matchJobs(jobs, profile());
    // Equal scores (local-a, local-b) keep their input order.
    expect(result.map((m) => m.job.sourceJobId)).toEqual([
      "include-local-a",
      "include-local-b",
      "include-remote",
      "include-none",
      "stretch-remote",
    ]);
  });

  it("does not mutate the input jobs", () => {
    const jobs = [
      job({ title: "Sr. Widget Engineer" }),
      job({ company: "Initech" }),
    ];
    const before = structuredClone(jobs);
    const result = matchJobs(jobs, profile());
    expect(jobs).toEqual(before);
    expect(result).toHaveLength(1);
    expect(result[0]?.job).toBe(jobs[0]);
  });
});
