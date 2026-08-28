import { DatabaseSync } from "node:sqlite";

export interface FtsCapabilities {
  fts5: boolean;
}

export function probeFts5(): FtsCapabilities {
  try {
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE VIRTUAL TABLE probe_fts USING fts5(body)");
    db.close();
    return { fts5: true };
  } catch {
    return { fts5: false };
  }
}

export function compileSafeFtsQuery(text: string): string {
  return text.replace(/["'*^():{}-]/g, " ").replace(/\s+/g, " ").trim();
}
