/**
 * Persistent LedgerStore: daily totals in one JSON file (atomic rename on
 * write), full detail appended to a JSONL ledger per day.
 *
 * Deliberately boring. The budget gate fails closed on store errors, so the
 * store must never be clever: no caches to go stale, no async to race.
 */
import { readFileSync, writeFileSync, appendFileSync, renameSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { CostEvent, LedgerStore } from "./index.ts";

export class FileStore implements LedgerStore {
  private dir: string;
  private totalsPath: string;
  private totals: Record<string, number>;

  constructor(dir: string) {
    this.dir = dir;
    mkdirSync(dir, { recursive: true });
    this.totalsPath = join(dir, "totals.json");
    this.totals = existsSync(this.totalsPath)
      ? JSON.parse(readFileSync(this.totalsPath, "utf8"))
      : {};
  }

  get(key: string): number {
    return this.totals[key] ?? 0;
  }

  add(key: string, micros: number): void {
    this.totals[key] = this.get(key) + micros;
    const tmp = this.totalsPath + ".tmp";
    writeFileSync(tmp, JSON.stringify(this.totals, null, 1));
    renameSync(tmp, this.totalsPath);
  }

  append(event: CostEvent): void {
    const day = event.ts.slice(0, 10);
    appendFileSync(join(this.dir, `ledger-${day}.jsonl`), JSON.stringify(event) + "\n");
  }
}
