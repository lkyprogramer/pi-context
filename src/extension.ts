import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { bindHooks } from "./pi/adapter.js";
import { createPlugin } from "./plugin.js";
import { registerSurface } from "./commands.js";
import { DEFAULT_CONFIG } from "./config.js";

export default function register(pi: ExtensionAPI): void {
  const state = createPlugin(DEFAULT_CONFIG);
  bindHooks(pi, state);
  registerSurface(pi, state);
}

export { register };
