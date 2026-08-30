import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

function validateInput(input) {
  if (!input || typeof input !== "object") {
    throw new TypeError("CI gate input is required");
  }
  if (typeof input.name !== "string" || !/^[a-z0-9][a-z0-9-]*$/u.test(input.name)) {
    throw new TypeError(`invalid gate name: ${String(input.name)}`);
  }
  if (typeof input.executable !== "string" || input.executable.length === 0) {
    throw new TypeError("gate executable is required");
  }
  if (!Array.isArray(input.arguments) || input.arguments.some((argument) => typeof argument !== "string")) {
    throw new TypeError("gate arguments must be an array of strings");
  }
  if (typeof input.logPath !== "string" || input.logPath.length === 0 || isAbsolute(input.logPath)) {
    throw new TypeError(`log path is outside workspace: ${String(input.logPath)}`);
  }
}

function scopedLogPath(workspaceRoot, logPath) {
  const absolutePath = resolve(workspaceRoot, logPath);
  const scopedPath = relative(workspaceRoot, absolutePath);
  if (scopedPath === "" || scopedPath === ".." || scopedPath.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) {
    throw new TypeError(`log path is outside workspace: ${logPath}`);
  }
  return absolutePath;
}

async function writeLogAtomically(logPath, content) {
  const parent = dirname(logPath);
  const temporaryPath = resolve(parent, `.ci-gate-${randomUUID()}.log`);
  await mkdir(parent, { recursive: true });
  try {
    await writeFile(temporaryPath, content, { encoding: "utf8", flag: "wx" });
    await rename(temporaryPath, logPath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

export async function runCiGate(input) {
  validateInput(input);
  const workspaceRoot = await realpath(input.workspaceRoot);
  const logPath = scopedLogPath(workspaceRoot, input.logPath);
  const output = [];
  let exitCode = null;
  let aborted = input.signal?.aborted === true;

  try {
    const child = spawn(input.executable, [...input.arguments], {
      cwd: workspaceRoot,
      env: process.env,
      signal: input.signal,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const collect = (chunk, destination) => {
      const buffer = Buffer.from(chunk);
      output.push(buffer);
      if (input.mirrorOutput) destination.write(buffer);
    };
    child.stdout.on("data", (chunk) => collect(chunk, process.stdout));
    child.stderr.on("data", (chunk) => collect(chunk, process.stderr));
    exitCode = await new Promise((resolveExit) => {
      let settled = false;
      const settle = (code) => {
        if (!settled) {
          settled = true;
          resolveExit(code);
        }
      };
      child.once("error", (error) => {
        aborted ||= error?.name === "AbortError" || input.signal?.aborted === true;
        output.push(Buffer.from(`${aborted ? "gate aborted" : String(error)}\n`, "utf8"));
        settle(null);
      });
      child.once("close", (code) => settle(code));
    });
  } catch (error) {
    aborted ||= error?.name === "AbortError" || input.signal?.aborted === true;
    output.push(Buffer.from(`${aborted ? "gate aborted" : String(error)}\n`, "utf8"));
  }

  const status = exitCode === 0 && !aborted ? "passed" : "failed";
  await writeLogAtomically(logPath, Buffer.concat(output));
  return { name: input.name, status, logPath, exitCode, aborted };
}
