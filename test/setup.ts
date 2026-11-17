// Fail closed on network access: a test that forgets to inject a fetch stub
// hits this instead of the live API. Vitest restores the real global after
// each test (unstubGlobals in vitest.config.ts).
import { beforeEach, vi } from "vitest";

export const NETWORK_DISABLED_MESSAGE =
  "network access is disabled in tests; inject a fetch stub";

beforeEach(() => {
  vi.stubGlobal("fetch", () => {
    throw new Error(NETWORK_DISABLED_MESSAGE);
  });
});
