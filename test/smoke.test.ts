import { describe, expect, it } from "vitest";
import { PACKAGE_NAME } from "../src/index.js";

describe("package entrypoint", () => {
  it("loads", () => {
    expect(PACKAGE_NAME).toBe("job-radar");
  });
});
