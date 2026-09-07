import { existsSync } from "node:fs";

export function javaAvailable(): boolean {
  return existsSync("/usr/bin/javac") || existsSync("/opt/homebrew/bin/javac");
}
