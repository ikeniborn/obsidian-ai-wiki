// Output formatting (Component 7). Console table + optional baseline delta,
// and the Snapshot shape persisted by --out / read by --baseline.
import type { LayerMetrics } from "./eval-metrics";

export interface ConfigSnapshot {
  name: string;
  seed: LayerMetrics;
  union: LayerMetrics;
}

export interface Snapshot {
  vault: string;
  k: number[];
  configs: ConfigSnapshot[];
}

const COLS = ["sR@3", "sR@5", "sR@8", "sMRR", "uR@3", "uR@5", "uR@8", "uMRR"];

/** The 8 metric cells for a config, in column order, given the k set. */
function cells(c: ConfigSnapshot, ks: number[]): number[] {
  const [k0, k1, k2] = ks;
  return [
    c.seed.recall[k0], c.seed.recall[k1], c.seed.recall[k2], c.seed.mrr,
    c.union.recall[k0], c.union.recall[k1], c.union.recall[k2], c.union.mrr,
  ];
}

function delta(cur: number, base: number | undefined): string {
  if (base === undefined) return "";
  const d = cur - base;
  if (Math.abs(d) < 1e-9) return " (=)";
  const arrow = d > 0 ? "▲" : "▼";
  const sign = d >= 0 ? "+" : "";
  return ` (${arrow}${sign}${d.toFixed(3)})`;
}

export function formatTable(snap: Snapshot, baseline?: Snapshot): string {
  const baseByName = new Map(
    (baseline?.configs ?? []).map((c) => [c.name, c]),
  );
  const lines: string[] = [];
  lines.push(["config".padEnd(18), ...COLS.map((c) => c.padStart(8))].join(" "));
  for (const c of snap.configs) {
    const cur = cells(c, snap.k);
    const base = baseByName.get(c.name);
    const baseCells = base ? cells(base, snap.k) : undefined;
    const row = cur.map((v, i) => {
      const d = baseCells ? delta(v, baseCells[i]) : "";
      return `${v.toFixed(3).padStart(8)}${d}`;
    });
    lines.push([c.name.padEnd(18), ...row].join(" "));
  }
  return lines.join("\n");
}
