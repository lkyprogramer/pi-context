#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  cpSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DEFAULT_PROVIDER = "openclaw";
const DEFAULT_MODEL = "openclaw/Qwen3.8-27B-WORK";
const DEFAULT_CONTEXT_WINDOW = 200192;
const REQUIRED_HOOKS = [
  "agent_settled",
  "context",
  "input",
  "input_result",
  "session_before_compact",
  "session_tree",
];
const PACK_ENTRY = "./dist/extension.js";

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function abortIfRequested(signal) {
  if (signal?.aborted) throw new DOMException("packed install probe aborted", "AbortError");
}

function requireRepoRoot(repoRoot) {
  if (typeof repoRoot !== "string" || repoRoot.length === 0 || !isAbsolute(repoRoot)) {
    throw new TypeError("repoRoot must be an absolute path");
  }
  const manifest = join(repoRoot, "apps/pi-context-runtime/package.json");
  const entry = join(repoRoot, "apps/pi-context-runtime/src/extension.ts");
  if (!existsSync(manifest) || !existsSync(entry)) throw new Error("repoRoot does not contain pi-context-runtime source");
  return { manifest, entry };
}

function run(command, args, options = {}) {
  abortIfRequested(options.signal);
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    let stdout = "";
    let stderr = "";
    let failure = null;
    let forceKill = null;
    const killTree = (signal) => {
      if (child.pid == null) return;
      try {
        if (process.platform === "win32") child.kill(signal);
        else process.kill(-child.pid, signal);
      } catch (error) {
        if (error?.code !== "ESRCH") throw error;
      }
    };
    const terminate = (error) => {
      failure ??= error;
      killTree("SIGTERM");
      forceKill ??= setTimeout(() => killTree("SIGKILL"), 500);
    };
    const onAbort = () =>
      terminate(options.signal?.reason instanceof Error ? options.signal.reason : new DOMException("packed install probe aborted", "AbortError"));
    options.signal?.addEventListener("abort", onAbort, { once: true });
    const timeoutMs = options.timeoutMs ?? 120_000;
    const timeout = setTimeout(() => terminate(new Error(`${command} timed out after ${timeoutMs}ms`)), timeoutMs);
    const cleanup = () => {
      clearTimeout(timeout);
      if (forceKill) clearTimeout(forceKill);
      options.signal?.removeEventListener("abort", onAbort);
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      cleanup();
      reject(failure ?? error);
    });
    child.on("close", (code, signal) => {
      cleanup();
      if (failure) {
        reject(failure);
        return;
      }
      if (code !== 0) {
        reject(new Error(`${command} ${args.join(" ")} failed (${code ?? signal ?? "unknown"}): ${stderr || stdout}`));
        return;
      }
      resolveRun({ stdout, stderr });
    });
  });
}

function createPackManifest(sourceManifest) {
  return {
    ...sourceManifest,
    files: ["dist"],
    main: PACK_ENTRY,
    types: "./dist/extension.d.ts",
    exports: {
      ".": {
        types: "./dist/extension.d.ts",
        import: PACK_ENTRY,
      },
    },
    pi: { extensions: [PACK_ENTRY] },
    scripts: {},
  };
}

function rewriteWorkspaceImports(dist) {
  const entries = {
    "@pcr/contracts": join(dist, "packages/contracts/src/index.js"),
    "@pcr/core": join(dist, "packages/core/src/index.js"),
    "@pcr/pi-adapter": join(dist, "packages/pi-adapter/src/index.js"),
    "@pcr/runtime": join(dist, "packages/runtime/src/index.js"),
    "@pcr/storage-node": join(dist, "packages/storage-node/src/index.js"),
  };
  const pending = [dist];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(path);
        continue;
      }
      if (!entry.name.endsWith(".js") && !entry.name.endsWith(".d.ts")) continue;
      let source = readFileSync(path, "utf8");
      for (const [specifier, jsTarget] of Object.entries(entries)) {
        // Keep .js specifiers in both .js and .d.ts. Rewriting declaration files to
        // another .d.ts makes value imports (e.g. domainHash) fail TS2846.
        const dtsTarget = jsTarget.replace(/\.js$/u, ".d.ts");
        if (!existsSync(jsTarget)) throw new Error(`compiled workspace entry is missing: ${jsTarget}`);
        if (!existsSync(dtsTarget)) throw new Error(`compiled workspace types are missing: ${dtsTarget}`);
        let replacement = relative(dirname(path), jsTarget).replaceAll("\\", "/");
        if (!replacement.startsWith(".")) replacement = `./${replacement}`;
        source = source.replaceAll(`"${specifier}"`, `"${replacement}"`).replaceAll(`'${specifier}'`, `'${replacement}'`);
      }
      writeFileSync(path, source);
    }
  }
}

export async function packCurrentSource({ repoRoot, outDir, signal } = {}) {
  abortIfRequested(signal);
  const source = requireRepoRoot(repoRoot);
  const workRoot = mkdtempSync(join(tmpdir(), "pcr-t06-pack-"));
  const stage = join(workRoot, "package");
  const dist = join(stage, "dist");
  const destination = outDir ? resolve(outDir) : join(workRoot, "tarballs");
  mkdirSync(dist, { recursive: true });
  mkdirSync(destination, { recursive: true });

  const tsc = join(repoRoot, "node_modules/.bin/tsc");
  if (!existsSync(tsc)) throw new Error("TypeScript compiler missing; run frozen install first");
  await run(
    tsc,
    [
      "--outDir",
      dist,
      "--rootDir",
      repoRoot,
      "--module",
      "NodeNext",
      "--moduleResolution",
      "NodeNext",
      "--target",
      "ES2022",
      "--skipLibCheck",
      "--types",
      "node",
      "--noEmitOnError",
      "--declaration",
      "--declarationMap",
      "false",
      source.entry,
      join(repoRoot, "packages/kernel/src/compaction/candidate.ts"),
    ],
    { cwd: repoRoot, signal },
  );
  abortIfRequested(signal);
  rewriteWorkspaceImports(dist);

  const compiledEntry = join(dist, "apps/pi-context-runtime/src/extension.js");
  if (!existsSync(compiledEntry)) throw new Error("compiled Pi extension entry is missing");
  writeFileSync(
    join(dist, "extension.js"),
    'export { default, createPiContextExtension, register } from "./apps/pi-context-runtime/src/extension.js";\n',
  );
  writeFileSync(
    join(dist, "extension.d.ts"),
    [
      'export { default } from "./apps/pi-context-runtime/src/extension.js";',
      'export * from "./apps/pi-context-runtime/src/extension.js";',
      "export interface PackedInstallResult {",
      "  tarball: string;",
      "  sha256: string;",
      "  loaded: boolean;",
      "  verticalProbePassed: boolean;",
      "}",
      "",
    ].join("\n"),
  );
  const sourceManifest = JSON.parse(readFileSync(source.manifest, "utf8"));
  const packedManifest = createPackManifest(sourceManifest);
  writeFileSync(join(stage, "package.json"), `${JSON.stringify(packedManifest, null, 2)}\n`);

  const packed = await run("npm", ["pack", "--pack-destination", destination, "--json"], {
    cwd: stage,
    signal,
  });
  const report = JSON.parse(packed.stdout);
  const filename = report[0]?.filename;
  if (typeof filename !== "string") throw new Error("npm pack did not report a tarball");
  const tarball = join(destination, filename);
  if (!existsSync(tarball) || statSync(tarball).size === 0) throw new Error("npm pack wrote an empty tarball");
  return {
    tarball,
    sha256: sha256(tarball),
    packageName: packedManifest.name,
    packageVersion: packedManifest.version,
    entry: PACK_ENTRY,
    hostContract: packedManifest.piHostContract,
    packagePolicy: { private: packedManifest.private === true, license: packedManifest.license },
  };
}

export async function verifyPackedPublicTypes(packed, { repoRoot, signal } = {}) {
  abortIfRequested(signal);
  requireRepoRoot(repoRoot);
  if (!packed || typeof packed.tarball !== "string" || sha256(packed.tarball) !== packed.sha256) {
    throw new Error("packed tarball digest mismatch");
  }
  const downstream = mkdtempSync(join(tmpdir(), "pcr-t06-downstream-"));
  const packageRoot = join(downstream, "node_modules", packed.packageName);
  mkdirSync(packageRoot, { recursive: true });
  await run("tar", ["-xzf", packed.tarball, "--strip-components=1", "-C", packageRoot], {
    cwd: downstream,
    signal,
  });
  writeFileSync(join(downstream, "package.json"), '{"private":true,"type":"module"}\n');
  writeFileSync(
    join(downstream, "contract.mts"),
    [
      `import extension, { createPiContextExtension, register, type HostExtensionAPI, type PackedInstallResult } from ${JSON.stringify(packed.packageName)};`,
      "const result: PackedInstallResult = {",
      `  tarball: ${JSON.stringify(packed.tarball)},`,
      `  sha256: ${JSON.stringify(packed.sha256)},`,
      "  loaded: true,",
      "  verticalProbePassed: true,",
      "};",
      "const consume = (pi: HostExtensionAPI) => {",
      "  extension(pi);",
      "  register(pi);",
      "  createPiContextExtension(pi);",
      "};",
      "void result;",
      "void consume;",
      "",
    ].join("\n"),
  );
  const tsc = join(repoRoot, "node_modules/.bin/tsc");
  await run(
    tsc,
    [
      "--noEmit",
      "--strict",
      "--module",
      "NodeNext",
      "--moduleResolution",
      "NodeNext",
      "--target",
      "ES2022",
      "--typeRoots",
      join(repoRoot, "node_modules/@types"),
      join(downstream, "contract.mts"),
    ],
    { cwd: downstream, signal },
  );
  return true;
}

export async function verifyStockHostRejection(packed, { repoRoot, signal } = {}) {
  abortIfRequested(signal);
  requireRepoRoot(repoRoot);
  if (!packed || typeof packed.tarball !== "string" || sha256(packed.tarball) !== packed.sha256) {
    throw new Error("packed tarball digest mismatch");
  }
  const workRoot = mkdtempSync(join(tmpdir(), "pcr-stock-pi-probe-"));
  try {
    const patchedEntry = resolvePiPublicEntry(join(repoRoot, "node_modules/.bin/pi"));
    // pnpm exposes the package root through a workspace symlink. Resolve it before
    // copying so the stock probe cannot reverse the patch through that symlink.
    const patchedRoot = realpathSync(dirname(dirname(patchedEntry)));
    const patchedContractPath = join(patchedRoot, "dist/index.js");
    const patchedContractDigest = sha256(patchedContractPath);
    const stockRoot = join(workRoot, "stock-pi");
    cpSync(patchedRoot, stockRoot, {
      recursive: true,
      filter(source) {
        const name = relative(patchedRoot, source).replaceAll("\\", "/");
        return name !== "node_modules" && !name.startsWith("node_modules/");
      },
    });
    const dependencyRoot = dirname(dirname(patchedRoot));
    rmSync(join(stockRoot, "node_modules"), { recursive: true, force: true });
    if (existsSync(dependencyRoot)) symlinkSync(dependencyRoot, join(stockRoot, "node_modules"), "dir");
    await run(
      "patch",
      ["-p1", "--reverse", "--input", join(repoRoot, "patches/@earendil-works__pi-coding-agent@0.84.4.patch")],
      { cwd: stockRoot, signal },
    );
    if (sha256(patchedContractPath) !== patchedContractDigest) {
      throw new Error("stock probe mutated the repository Pi host");
    }
    const packageRoot = join(workRoot, "package");
    mkdirSync(packageRoot, { recursive: true });
    await run("tar", ["-xzf", packed.tarball, "--strip-components=1", "-C", packageRoot], {
      cwd: workRoot,
      signal,
    });
    const extensionPath = join(packageRoot, packed.entry.replace(/^\.\//u, ""));
    const workspace = join(workRoot, "workspace");
    mkdirSync(workspace, { recursive: true });
    const source = [
      'import { pathToFileURL } from "node:url";',
      "const api = await import(pathToFileURL(process.env.PCR_STOCK_PI_ENTRY).href);",
      "if (api.PCR_INGRESS_METADATA_CONTRACT !== undefined) throw new Error('stock Pi unexpectedly exposes the patched contract');",
      "const loaded = await api.discoverAndLoadExtensions([process.env.PCR_EXTENSION_ENTRY], process.env.PCR_EXTENSION_CWD);",
      "const errors = loaded.errors.map((item) => item.error);",
      "if (!errors.some((error) => error.includes('PCR_PI_INGRESS_METADATA_CONTRACT_MISSING'))) throw new Error(`stock host did not reject the extension: ${errors.join('; ')}`);",
      "process.stdout.write(JSON.stringify({ rejected: true, errors }));",
    ].join("\n");
    const probed = await run(process.execPath, ["--input-type=module", "--eval", source], {
      cwd: workspace,
      signal,
      env: {
        ...process.env,
        PCR_STOCK_PI_ENTRY: join(stockRoot, "dist/index.js"),
        PCR_EXTENSION_ENTRY: extensionPath,
        PCR_EXTENSION_CWD: workspace,
      },
    });
    return { ...JSON.parse(probed.stdout), sourceHostIntact: true };
  } finally {
    rmSync(workRoot, { recursive: true, force: true });
  }
}

function findPackageRoot(root, packageName) {
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === ".git") continue;
      const candidate = join(current, entry.name);
      const manifest = join(candidate, "package.json");
      if (existsSync(manifest)) {
        try {
          if (JSON.parse(readFileSync(manifest, "utf8")).name === packageName) return candidate;
        } catch {
          // Continue scanning malformed third-party metadata; the target manifest is verified below.
        }
      }
      pending.push(candidate);
    }
  }
  return null;
}

function prepareModelConfig(agentDir, modelsPath, provider, modelId, expectedContextWindow, materializeCredentials) {
  if (!existsSync(modelsPath)) throw new Error("Pi models.json is missing");
  const models = JSON.parse(readFileSync(modelsPath, "utf8"));
  const providerConfig = models.providers?.[provider];
  const model = providerConfig?.models?.find((candidate) => candidate.id === modelId || `${provider}/${candidate.id}` === modelId);
  if (!providerConfig || !model) throw new Error(`model ${modelId} is not configured`);
  if (model.contextWindow !== expectedContextWindow) {
    throw new Error(`model ${modelId} context window is ${model.contextWindow}, expected ${expectedContextWindow}`);
  }
  mkdirSync(agentDir, { recursive: true });
  if (materializeCredentials) copyFileSync(modelsPath, join(agentDir, "models.json"));
  writeFileSync(
    join(agentDir, "settings.json"),
    `${JSON.stringify({ defaultProvider: provider, defaultModel: modelId }, null, 2)}\n`,
  );
  return { provider, modelId, contextWindow: model.contextWindow, maxTokens: model.maxTokens };
}

function parseAssistantText(stdout) {
  const messages = stdout
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const event = JSON.parse(line);
        if (event.type === "message_end" && event.message?.role === "assistant") {
          return (event.message.content ?? []).filter((block) => block.type === "text").map((block) => block.text ?? "");
        }
      } catch {
        return [];
      }
      return [];
    });
  return messages.join("\n");
}

function resolvePiPublicEntry(piBin) {
  const workspaceEntry = resolve(
    dirname(piBin),
    "../@earendil-works/pi-coding-agent/dist/index.js",
  );
  if (existsSync(workspaceEntry)) return workspaceEntry;
  let current = dirname(realpathSync(piBin));
  for (let depth = 0; depth < 6; depth += 1) {
    const manifest = join(current, "package.json");
    if (existsSync(manifest)) {
      const parsed = JSON.parse(readFileSync(manifest, "utf8"));
      const entry = join(current, "dist/index.js");
      if (parsed.name === "@earendil-works/pi-coding-agent" && existsSync(entry)) return entry;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error("Pi public package entry is missing next to the selected binary");
}

async function probeInstalledExtension(piBin, extensionPath, cwd, env, signal, timeoutMs) {
  const piEntry = resolvePiPublicEntry(piBin);
  const adjacentNode = join(dirname(piBin), "node");
  const nodeBin = existsSync(adjacentNode) ? adjacentNode : process.execPath;
  const source = [
    'import { pathToFileURL } from "node:url";',
    "const api = await import(pathToFileURL(process.env.PCR_PI_ENTRY).href);",
    "if (typeof api.VERSION !== 'string' || typeof api.discoverAndLoadExtensions !== 'function') throw new Error('Pi public loader unavailable');",
    "const loaded = await api.discoverAndLoadExtensions([process.env.PCR_EXTENSION_ENTRY], process.env.PCR_EXTENSION_CWD);",
    "if (loaded.errors.length > 0) throw new Error(`extension load failed: ${loaded.errors.map((item) => item.error).join('; ')}`);",
    "const extension = loaded.extensions[0];",
    "let aborted = false;",
    "const ctx = { abort() { aborted = true; }, model: { id: 'openclaw/Qwen3.8-27B-WORK' }, thinkingLevel: 'off', signal: undefined };",
    "const invoke = async (name, event) => {",
    "  const handlers = extension?.handlers.get(name) ?? [];",
    "  if (handlers.length === 0) throw new Error(`missing handler ${name}`);",
    "  let value;",
    "  for (const handler of handlers) value = await handler(event, ctx);",
    "  return value;",
    "};",
    "const contextResult = extension ? await invoke('context', { type: 'context', messages: [{ role: 'user', content: 'preserve the current task' }] }) : undefined;",
    "const statusTool = extension?.tools.get('context_status')?.definition;",
    "if (!statusTool) throw new Error('missing context_status tool');",
    "const toolResult = await statusTool.execute('call-t06', {}, undefined, undefined, { workspaceId: 'ws_0123456789abcdef', sessionId: 's1', channel: 'authenticated-user' });",
    "const toolPayload = JSON.parse(toolResult.content[0]?.text ?? '{}');",
    "const compactionResult = extension ? await invoke('session_before_compact', {",
    "  type: 'session_before_compact',",
    "  reason: 'manual',",
    "  preparation: { tokensBefore: 4096, firstKeptEntryId: 'entry-keep', retainedTail: [], messagesToSummarize: [{ role: 'user', content: 'do not deploy production' }], branchScope: 'main', head: 'leaf-a', allow: true },",
    "}) : undefined;",
    "const result = {",
    "  version: api.VERSION,",
    "  hostContract: api.PCR_INGRESS_METADATA_CONTRACT,",
    "  handlers: loaded.extensions.length === 1 ? [...loaded.extensions[0].handlers.keys()].sort() : [],",
    "  errors: loaded.errors.map((item) => item.error),",
    "  extensionCount: loaded.extensions.length,",
    "  behavior: {",
    "    contextPassed: Array.isArray(contextResult?.messages) && contextResult.messages.length > 0 && !aborted,",
    "    toolPassed: toolPayload.claimed === true && toolPayload.workspaceId === 'ws_0123456789abcdef',",
    "    compactionPassed: compactionResult?.compaction?.fromExtension === true && typeof compactionResult.compaction.summary === 'string',",
    "  },",
    "};",
    "process.stdout.write(JSON.stringify(result));",
  ].join("\n");
  const probed = await run(nodeBin, ["--input-type=module", "--eval", source], {
    cwd,
    signal,
    timeoutMs,
    env: {
      ...env,
      PCR_PI_ENTRY: piEntry,
      PCR_EXTENSION_ENTRY: extensionPath,
      PCR_EXTENSION_CWD: cwd,
    },
  });
  return JSON.parse(probed.stdout);
}

async function probeInstalledExactInput(
  piBin,
  extensionPath,
  packageRoot,
  cwd,
  env,
  signal,
  timeoutMs,
) {
  const piEntry = resolvePiPublicEntry(piBin);
  const adjacentNode = join(dirname(piBin), "node");
  const nodeBin = existsSync(adjacentNode) ? adjacentNode : process.execPath;
  const storageEntry = join(packageRoot, "dist/packages/storage-node/src/index.js");
  if (!existsSync(storageEntry)) throw new Error("packed storage entry is missing");
  const source = [
    'import { join } from "node:path";',
    'import { pathToFileURL } from "node:url";',
    "const api = await import(pathToFileURL(process.env.PCR_PI_ENTRY).href);",
    "if (api.PCR_INGRESS_METADATA_CONTRACT !== 'pcr-ingress-metadata-v1') throw new Error('PCR_PI_INGRESS_METADATA_CONTRACT_MISSING');",
    "const loaded = await api.discoverAndLoadExtensions([process.env.PCR_EXTENSION_ENTRY], process.env.PCR_EXTENSION_CWD);",
    "if (loaded.errors.length > 0 || loaded.extensions.length !== 1) throw new Error(`extension load failed: ${loaded.errors.map((item) => item.error).join('; ')}`);",
    "const settings = api.SettingsManager.inMemory({ defaultProvider: 'openclaw', defaultModel: 'Qwen3.8-27B-WORK', defaultTools: [] }, { projectTrusted: true });",
    "const modelRuntime = await api.ModelRuntime.create({ modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });",
    "modelRuntime.registerProvider('openclaw', {",
    "  api: 'openai-completions', baseUrl: 'http://127.0.0.1:1', apiKey: 'offline-packed-key',",
    "  models: [{ id: 'Qwen3.8-27B-WORK', name: 'Qwen3.8-27B-WORK', reasoning: true, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200192, maxTokens: 16384 }],",
    "});",
    "const sessionDir = join(process.env.PCR_EXTENSION_CWD, 'sessions');",
    "const manager = api.SessionManager.create(process.env.PCR_EXTENSION_CWD, sessionDir);",
    "const resourceLoader = new api.DefaultResourceLoader({",
    "  cwd: process.env.PCR_EXTENSION_CWD, agentDir: process.env.PI_CODING_AGENT_DIR, settingsManager: settings,",
    "  noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,",
    "  extensionsOverride: () => loaded,",
    "});",
    "await resourceLoader.reload();",
    "const created = await api.createAgentSession({ cwd: process.env.PCR_EXTENSION_CWD, modelRuntime, model: modelRuntime.getModel('openclaw', 'Qwen3.8-27B-WORK'), settingsManager: settings, resourceLoader, sessionManager: manager, noTools: 'all' });",
    "const providerContexts = [];",
    "const assistant = { role: 'assistant', content: [{ type: 'text', text: 'packed-ok' }], api: 'openai-completions', provider: 'openclaw', model: 'Qwen3.8-27B-WORK', usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: 'stop', timestamp: Date.now() };",
    "created.session.agent.streamFunction = async (_model, context) => { providerContexts.push(JSON.stringify(context)); return { async *[Symbol.asyncIterator]() { yield { type: 'start', partial: assistant }; yield { type: 'done', message: assistant }; }, async result() { return assistant; } }; };",
    "const raw = 'packed product exact input';",
    "await created.session.prompt(raw);",
    "const user = manager.getEntries().find((entry) => entry.type === 'message' && entry.message.role === 'user');",
    "const metadata = user?.ingressMetadata?.['pcr.user-input-receipt.v1'];",
    "if (!user || !metadata) throw new Error('packed input sidecar missing');",
    "await created.session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' });",
    "const storage = await import(pathToFileURL(process.env.PCR_STORAGE_ENTRY).href);",
    "const dataRoot = join(sessionDir, '.context-runtime');",
    "const database = await storage.openWorkspaceSqliteStore({ dataRoot, workspaceId: metadata.cursor.workspaceId, busyTimeoutMs: 1000 });",
    "const ledger = await storage.openWorkspaceUserTurnLedger({ database });",
    "const keys = storage.openLocalWorkspaceBlobKeyProvider({ dataRoot, workspaceId: metadata.cursor.workspaceId });",
    "const blobs = storage.createEncryptedBlobStore({ dataRoot, workspaceId: metadata.cursor.workspaceId, maxBlobBytes: 8 * 1024 * 1024, keys });",
    "let linked; let recovered;",
    "try { linked = await ledger.get(metadata.cursor, metadata.receiptId); recovered = Buffer.from(await blobs.read(metadata.cursor, linked.rawBlobId)).toString('utf8'); } finally { keys.close(); await ledger.close(); await database.close(); }",
    "const providerPayload = providerContexts.join('\\n');",
    "const result = { exactInputPassed: linked?.hostMessageId === user.id && recovered === raw, providerIsolationPassed: !providerPayload.includes('ingressMetadata') && !providerPayload.includes('pcr.user-input-receipt') && !providerPayload.includes('receipt_'), hostMessageId: user.id, receiptId: metadata.receiptId };",
    "process.stdout.write(JSON.stringify(result));",
  ].join("\n");
  const probed = await run(nodeBin, ["--input-type=module", "--eval", source], {
    cwd,
    signal,
    timeoutMs,
    env: {
      ...env,
      PCR_PI_ENTRY: piEntry,
      PCR_EXTENSION_ENTRY: extensionPath,
      PCR_EXTENSION_CWD: cwd,
      PCR_STORAGE_ENTRY: storageEntry,
    },
  });
  return JSON.parse(probed.stdout);
}

function isolatedEnvironment(cleanHome, agentDir, piBin) {
  const env = {
    HOME: cleanHome,
    PATH: `${dirname(piBin)}:${process.env.PATH ?? ""}`,
    PI_CODING_AGENT_DIR: agentDir,
    PI_OFFLINE: "1",
    PI_TELEMETRY: "0",
    npm_config_audit: "false",
    npm_config_fund: "false",
    npm_config_update_notifier: "false",
  };
  for (const name of ["LANG", "LC_ALL", "TERM", "TMPDIR", "TMP", "TEMP"]) {
    if (process.env[name]) env[name] = process.env[name];
  }
  return env;
}

export async function installAndRunVerticalProbe(
  packed,
  {
    repoRoot,
    piBin,
    modelsPath = join(homedir(), ".pi/agent/models.json"),
    provider = DEFAULT_PROVIDER,
    modelId = DEFAULT_MODEL,
    expectedContextWindow = DEFAULT_CONTEXT_WINDOW,
    liveModel = false,
    tempRoot = tmpdir(),
    commandTimeoutMs = 180_000,
    signal,
  } = {},
) {
  abortIfRequested(signal);
  requireRepoRoot(repoRoot);
  const selectedPiBin = piBin ?? join(repoRoot, "node_modules/.bin/pi");
  if (!packed || typeof packed.tarball !== "string" || typeof packed.sha256 !== "string") {
    throw new TypeError("packed tarball receipt is required");
  }
  if (!existsSync(packed.tarball) || sha256(packed.tarball) !== packed.sha256) {
    throw new Error("packed tarball digest mismatch");
  }
  if (!existsSync(selectedPiBin)) throw new Error("Patched Pi binary missing; run nvm use v22.19.0 and pnpm install --frozen-lockfile first");
  if (typeof tempRoot !== "string" || !isAbsolute(tempRoot) || !existsSync(tempRoot)) {
    throw new TypeError("tempRoot must be an existing absolute path");
  }

  const cleanHome = mkdtempSync(join(tempRoot, "pcr-t06-clean-home-"));
  const agentDir = join(cleanHome, ".pi/agent");
  const project = join(cleanHome, "workspace");
  const isolationId = cleanHome.slice(cleanHome.lastIndexOf("/") + 1);
  try {
    mkdirSync(project, { recursive: true });
    const model = prepareModelConfig(agentDir, modelsPath, provider, modelId, expectedContextWindow, liveModel);
    const env = isolatedEnvironment(cleanHome, agentDir, selectedPiBin);
    const installSource = `npm:${packed.tarball}`;

    const version = await run(selectedPiBin, ["--version"], { cwd: project, env, signal, timeoutMs: commandTimeoutMs });
    const piVersion = version.stdout.trim();
    if (!/^0\.84\./.test(piVersion)) throw new Error(`expected Pi 0.84.x, got ${piVersion}`);
    const installed = await run(selectedPiBin, ["install", installSource, "--approve"], {
      cwd: project,
      env,
      signal,
      timeoutMs: commandTimeoutMs,
    });
    const listed = await run(selectedPiBin, ["list", "--approve"], {
      cwd: project,
      env,
      signal,
      timeoutMs: commandTimeoutMs,
    });
    const packageRoot = findPackageRoot(agentDir, packed.packageName);
    if (!packageRoot) throw new Error(`Pi install did not materialize ${packed.packageName}`);
    const extensionPath = join(packageRoot, packed.entry.replace(/^\.\//, ""));
    if (!existsSync(extensionPath)) throw new Error(`installed extension entry is missing: ${packed.entry}`);

    const loaded = await probeInstalledExtension(selectedPiBin, extensionPath, project, env, signal, commandTimeoutMs);
    if (loaded.errors.length > 0 || loaded.extensionCount !== 1) {
      throw new Error(`installed extension failed Pi public loading: ${loaded.errors.join("; ")}`);
    }
    const exactInput = await probeInstalledExactInput(
      selectedPiBin,
      extensionPath,
      packageRoot,
      project,
      env,
      signal,
      commandTimeoutMs,
    );
    const handlers = loaded.handlers;
    const missingHooks = REQUIRED_HOOKS.filter((hook) => !handlers.includes(hook));
    const cliLoaded = installed.stdout.includes("Installed") && listed.stdout.includes(installSource);
    let modelProbe = null;
    if (liveModel) {
      const marker = "PCR_PACKED_INSTALL_OK";
      const response = await run(
        selectedPiBin,
        [
          "--provider",
          provider,
          "--model",
          modelId,
          "--no-session",
          "--offline",
          "--no-tools",
          "--approve",
          "--mode",
          "json",
          "-p",
          `Reply with exactly ${marker} and no other text.`,
        ],
        { cwd: project, env, signal, timeoutMs: commandTimeoutMs },
      );
      const assistantText = parseAssistantText(response.stdout).trim();
      modelProbe = { provider, modelId, markerObserved: assistantText === marker };
    }
    const behavior = { ...loaded.behavior, ...exactInput };
    const behaviorPassed = Object.entries(behavior)
      .filter(([name]) => name.endsWith("Passed"))
      .every(([, value]) => value === true);
    const verticalProbePassed =
      cliLoaded && missingHooks.length === 0 && behaviorPassed && (!liveModel || modelProbe?.markerObserved === true);
    return {
      tarball: packed.tarball,
      sha256: packed.sha256,
      loaded: cliLoaded && loaded.extensionCount === 1,
      verticalProbePassed,
      piVersion,
      isolationId,
      cleanHomeRemoved: true,
      model,
      hostContract: loaded.hostContract,
      requiredHostContract: packed.hostContract,
      handlers,
      missingHooks,
      behavior,
      modelProbe,
    };
  } finally {
    rmSync(cleanHome, { recursive: true, force: true });
  }
}

async function main() {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const liveModel = process.argv.includes("--live-model");
  const packed = await packCurrentSource({ repoRoot });
  const result = await installAndRunVerticalProbe(packed, { repoRoot, liveModel });
  process.stdout.write(
    `${JSON.stringify(
      {
        tarball: result.tarball,
        sha256: result.sha256,
        loaded: result.loaded,
        verticalProbePassed: result.verticalProbePassed,
        piVersion: result.piVersion,
        model: result.model,
        handlers: result.handlers,
        behavior: result.behavior,
        cleanHomeRemoved: result.cleanHomeRemoved,
        modelProbe: result.modelProbe,
        packagePolicy: packed.packagePolicy,
        publicTypesCompiled: await verifyPackedPublicTypes(packed, { repoRoot }),
      },
      null,
      2,
    )}\n`,
  );
  if (!result.loaded || !result.verticalProbePassed) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
