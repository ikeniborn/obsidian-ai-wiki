import { domainLogPath } from "./wiki-path";
import type { VaultTools } from "./vault-tools";

export interface IngestLogEntry {
  path: string;
  action: "CREATED" | "UPDATED" | "DELETED" | "MERGED";
  statusFrom?: string;
  statusTo?: string;
}

export type LogOperation =
  | { op: "ingest"; sourcePath: string; entries: IngestLogEntry[]; outputTokens: number }
  | { op: "lint";   domainId: string;  fixed: string[]; checkedCount: number; outputTokens: number }
  | { op: "fix";    filePath: string;  fixed: string[]; outputTokens: number };

function ts(): string {
  return new Date().toISOString().slice(0, 19);
}

function buildEntry(domainId: string, event: LogOperation): string {
  const header = `## ${ts()} — ${event.op} — ${domainId}`;
  const lines: string[] = [header];

  if (event.op === "ingest") {
    lines.push(`**Source:** ${event.sourcePath}`);
    lines.push(`**Tokens:** ${event.outputTokens}`);
    lines.push("");
    for (const e of event.entries) {
      if (e.action === "CREATED") {
        lines.push(`- CREATED: ${e.path} (${e.statusTo ?? "unknown"})`);
      } else if (e.action === "UPDATED") {
        const status = e.statusFrom ? `${e.statusFrom}→${e.statusTo}` : (e.statusTo ?? "unknown");
        lines.push(`- UPDATED: ${e.path} (${status})`);
      } else if (e.action === "MERGED") {
        lines.push(`- MERGED: ${e.path}`);
      } else {
        lines.push(`- DELETED: ${e.path}`);
      }
    }
  } else if (event.op === "lint") {
    lines.push(`**Tokens:** ${event.outputTokens}`);
    lines.push(`**Checked:** ${event.checkedCount} | **Fixed:** ${event.fixed.length}`);
    lines.push("");
    for (const p of event.fixed) lines.push(`- FIXED: ${p}`);
  } else {
    lines.push(`**File:** ${event.filePath}`);
    lines.push(`**Tokens:** ${event.outputTokens}`);
    lines.push("");
    for (const p of event.fixed) lines.push(`- FIXED: ${p}`);
  }

  lines.push("", "---");
  return "\n" + lines.join("\n") + "\n";
}

export async function appendWikiLog(
  vaultTools: VaultTools,
  domainFolder: string,
  domainId: string,
  event: LogOperation,
): Promise<void> {
  const logPath = domainLogPath(domainFolder);
  let existing = "";
  try { existing = await vaultTools.read(logPath); } catch { /* new file */ }
  await vaultTools.write(logPath, existing + buildEntry(domainId, event));
}
