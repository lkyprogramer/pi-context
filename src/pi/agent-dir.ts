import { homedir } from "node:os";
import { join } from "node:path";

/** Same env var official Pi honours in `getAgentDir()` (`${APP_NAME.toUpperCase()}_CODING_AGENT_DIR`). */
export const PI_AGENT_DIR_ENV = "PI_CODING_AGENT_DIR";

function expandTilde(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return path;
}

/**
 * Resolve the Pi agent dir without importing the host package at runtime
 * (dist/extension.js is loaded from a staging dir that has no node_modules).
 * Precedence mirrors Pi: env var, then the dir the host handed us, then ~/.pi/agent.
 * A whitespace-only env value is ignored; a relative env path is passed through
 * unchanged (Pi resolves it against its own cwd the same way, we do not re-anchor it).
 */
export function resolveAgentDir(ctxAgentDir?: string | null): string {
  const fromEnv = process.env[PI_AGENT_DIR_ENV]?.trim();
  if (fromEnv) return expandTilde(fromEnv);
  if (typeof ctxAgentDir === "string" && ctxAgentDir.trim()) return ctxAgentDir;
  return join(homedir(), ".pi", "agent");
}
