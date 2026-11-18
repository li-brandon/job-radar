// Command-line entry (LIB-543): `npm run job-radar -- run` or `npx tsx src/cli.ts run`.
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { DEFAULT_CONFIG_PATH } from "./config/load.js";
import { DEFAULT_SEEN_JOBS_PATH } from "./match/seen.js";
import { DEFAULT_DIGEST_PATH, DEFAULT_MATCHES_PATH } from "./run/digest.js";
import {
  runJobRadar,
  type RunOptions,
  type RunResult,
} from "./run/pipeline.js";

export const USAGE = `Usage: job-radar run [options]

Fetches every board in the watchlist, matches jobs against the profile, and
writes new matches to local files.

Options:
  --config <path>    config file (default: ${DEFAULT_CONFIG_PATH})
  --seen <path>      seen-jobs file (default: ${DEFAULT_SEEN_JOBS_PATH})
  --json-out <path>  matches JSON output (default: ${DEFAULT_MATCHES_PATH})
  --md-out <path>    markdown digest output (default: ${DEFAULT_DIGEST_PATH})
  -h, --help         show this help`;

export interface CliIo {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

const defaultIo: CliIo = {
  stdout: (line) => process.stdout.write(`${line}\n`),
  stderr: (line) => process.stderr.write(`${line}\n`),
};

function parse(argv: readonly string[]) {
  return parseArgs({
    args: [...argv],
    allowPositionals: true,
    strict: true,
    options: {
      config: { type: "string" },
      seen: { type: "string" },
      "json-out": { type: "string" },
      "md-out": { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
}

/** Parses `argv` (without node and script) and runs the command. Returns the exit code. */
export async function main(
  argv: readonly string[],
  io: CliIo = defaultIo,
  run: (options: RunOptions) => Promise<RunResult> = runJobRadar,
): Promise<number> {
  let parsed: ReturnType<typeof parse>;
  try {
    parsed = parse(argv);
  } catch (err) {
    io.stderr(`job-radar: ${(err as Error).message}`);
    io.stderr(USAGE);
    return 2;
  }

  const { values, positionals } = parsed;
  if (values.help) {
    io.stdout(USAGE);
    return 0;
  }
  if (positionals.length !== 1 || positionals[0] !== "run") {
    const got = positionals.length ? `"${positionals.join(" ")}"` : "nothing";
    io.stderr(`job-radar: expected the "run" command, got ${got}`);
    io.stderr(USAGE);
    return 2;
  }

  try {
    const result = await run({
      configPath: values.config,
      seenPath: values.seen,
      jsonOutPath: values["json-out"],
      mdOutPath: values["md-out"],
      stdout: io.stdout,
      stderr: io.stderr,
    });
    return result.exitCode;
  } catch (err) {
    io.stderr(`job-radar: ${(err as Error).message}`);
    return 1;
  }
}

function isEntrypoint(): boolean {
  const script = process.argv[1];
  if (!script) return false;
  const self = fileURLToPath(import.meta.url);
  try {
    return realpathSync(script) === realpathSync(self);
  } catch {
    return false;
  }
}

if (isEntrypoint()) {
  process.exitCode = await main(process.argv.slice(2));
}
