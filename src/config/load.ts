import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { configSchema, type JobRadarConfig } from "./schema.js";

/** Gitignored local config, resolved against the current working directory. */
export const DEFAULT_CONFIG_PATH = "config/job-radar.local.json";

/** Thrown for any config problem. `message` is meant to be shown to the user as-is. */
export class ConfigError extends Error {
  readonly configPath: string;
  readonly issues: readonly string[];

  constructor(
    configPath: string,
    summary: string,
    issues: readonly string[] = [],
  ) {
    const details = issues.map((issue) => `\n  - ${issue}`).join("");
    super(`${summary}${details}`);
    this.name = "ConfigError";
    this.configPath = configPath;
    this.issues = issues;
  }
}

function formatPath(path: readonly PropertyKey[]): string {
  let out = "";
  for (const key of path) {
    out +=
      typeof key === "number" ? `[${key}]` : `${out ? "." : ""}${String(key)}`;
  }
  return out || "(root)";
}

/** Validates an already-parsed JSON value. `source` is only used in error messages. */
export function parseConfig(raw: unknown, source = "<inline>"): JobRadarConfig {
  const result = configSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map(
      (issue) => `${formatPath(issue.path)}: ${issue.message}`,
    );
    throw new ConfigError(source, `Invalid config in ${source}:`, issues);
  }
  return result.data;
}

/**
 * Reads, parses, and validates a config file.
 * Defaults to `config/job-radar.local.json` relative to the current working directory.
 */
export async function loadConfig(
  path: string = DEFAULT_CONFIG_PATH,
): Promise<JobRadarConfig> {
  const fullPath = resolve(path);

  let text: string;
  try {
    text = await readFile(fullPath, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new ConfigError(
        fullPath,
        `Config file not found: ${fullPath}. ` +
          "Copy config/job-radar.example.json to config/job-radar.local.json and edit it.",
      );
    }
    throw new ConfigError(
      fullPath,
      `Could not read config file ${fullPath}: ${(err as Error).message}`,
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new ConfigError(
      fullPath,
      `Config file ${fullPath} is not valid JSON: ${(err as Error).message}`,
    );
  }

  return parseConfig(raw, fullPath);
}
