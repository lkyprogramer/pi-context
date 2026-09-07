import { inspectPackedRelease as inspectBuiltRelease } from "../../scripts/release/verify-release.mjs";

export async function inspectPackedRelease() {
  return inspectBuiltRelease();
}
