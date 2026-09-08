import { rmSync } from "node:fs";
import { afterEach, expect, it } from "vitest";
import { loadOfficialPi } from "../helpers/official-pi.js";
import { runObserveIdentity } from "../helpers/controlled-provider.js";

const originalHome = process.env.HOME;
const temps: string[] = [];

afterEach(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

it("observe keeps provider messages byte-identical to a session without the plugin", async () => {
  const pi = await loadOfficialPi();
  const { temps: created } = await runObserveIdentity(pi);
  temps.push(...created);
  expect(created.length).toBeGreaterThan(0);
}, 90_000);
