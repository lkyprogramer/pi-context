import { bindHooks, type PiExtensionAPI } from "./pi/adapter.js";
import { createPlugin } from "./plugin.js";
import { registerSurface } from "./commands.js";
import { DEFAULT_CONFIG } from "./config.js";

export default function register(pi: PiExtensionAPI): void {
  const state = createPlugin(DEFAULT_CONFIG);
  bindHooks(pi, state);
  registerSurface(pi, state);
}

export { register };
