import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export function markerLine(spec) {
  const n = String(spec.marked).padStart(2, "0");
  return `[ERROR] ${spec.token} at build-${n} line ${spec.markLine}`;
}

export function setupLogWorkspace(cwd, spec) {
  const count = spec.count ?? 12;
  const lines = spec.lines ?? 300;
  const marked = spec.marked ?? 7;
  const markLine = spec.markLine ?? 210;
  const token = spec.token ?? "FIRST-ERROR-MARKER";
  const prefix = spec.prefix ?? "build";
  mkdirSync(join(cwd, "logs"), { recursive: true });
  const markedName = `${prefix}-${String(marked).padStart(2, "0")}.log`;
  const markedText = markerLine({ marked, markLine, token });
  for (let n = 1; n <= count; n++) {
    const rows = [];
    for (let i = 1; i <= lines; i++) {
      rows.push(n === marked && i === markLine
        ? markedText
        : `[INFO] maven-${prefix}-${String(n).padStart(2, "0")} line=${i} compiling module ok elapsed=${i}ms`);
    }
    writeFileSync(join(cwd, "logs", `${prefix}-${String(n).padStart(2, "0")}.log`), `${rows.join("\n")}\n`);
  }
  return { file: `logs/${markedName}`, line: markLine, text: markedText };
}

const invoked = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invoked && process.argv[2] && process.argv[3]) {
  setupLogWorkspace(process.argv[2], JSON.parse(process.argv[3]));
}
