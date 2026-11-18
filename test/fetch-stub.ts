// Shared helpers for fetcher tests: canned JSON responses and a fetch stub that
// only answers known URLs.
import { readFile } from "node:fs/promises";
import { vi } from "vitest";

export async function readFixture(path: string): Promise<string> {
  return readFile(`test/fixtures/${path}.json`, "utf8");
}

export function jsonResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type Route = () => Response | Promise<Response>;

/** Fetch stub that serves canned responses by URL and throws on anything else. */
export function stubFetch(routes: Record<string, Route>) {
  return vi.fn<typeof fetch>(async (input) => {
    const url = String(input);
    const route = routes[url];
    if (!route) throw new Error(`unexpected request to ${url}`);
    return route();
  });
}
