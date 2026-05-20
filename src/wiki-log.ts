import type { VaultTools } from "./vault-tools";

export interface IngestLogEntry {
  path: string;
  action: "СОЗДАНА" | "ОБНОВЛЕНА";
  statusFrom?: string;
  statusTo: string;
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
    lines.push(`**Источник:** ${event.sourcePath}`);
    lines.push(`**Токены:** ${event.outputTokens}`);
    lines.push("");
    for (const e of event.entries) {
      if (e.action === "СОЗДАНА") {
        lines.push(`- СОЗДАНА: ${e.path} (${e.statusTo})`);
      } else {
        const status = e.statusFrom ? `${e.statusFrom}→${e.statusTo}` : e.statusTo;
        lines.push(`- ОБНОВЛЕНА: ${e.path} (${status})`);
      }
    }
  } else if (event.op === "lint") {
    lines.push(`**Токены:** ${event.outputTokens}`);
    lines.push(`**Проверено:** ${event.checkedCount} | **Исправлено:** ${event.fixed.length}`);
    lines.push("");
    for (const p of event.fixed) lines.push(`- ИСПРАВЛЕНА: ${p}`);
  } else {
    lines.push(`**Файл:** ${event.filePath}`);
    lines.push(`**Токены:** ${event.outputTokens}`);
    lines.push("");
    for (const p of event.fixed) lines.push(`- ИСПРАВЛЕНА: ${p}`);
  }

  lines.push("", "---");
  return "\n" + lines.join("\n") + "\n";
}

export async function appendWikiLog(
  vaultTools: VaultTools,
  logPath: string,
  domainId: string,
  event: LogOperation,
): Promise<void> {
  let existing = "";
  try { existing = await vaultTools.read(logPath); } catch { /* new file */ }
  await vaultTools.write(logPath, existing + buildEntry(domainId, event));
}
