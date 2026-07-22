import { domainLogPath } from "./wiki-path";
import type { VaultTools } from "./vault-tools";
import { stringifyJsonl } from "./jsonl";
import { readFileImage, TransactionVaultTools } from "./file-transaction";

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

export interface OperationLogRecord {
  kind: "operation";
  ts: string;
  domainId: string;
  op: string;
  sourcePath?: string;
  filePath?: string;
  entries?: IngestLogEntry[];
  fixed?: string[];
  checkedCount?: number;
  outputTokens?: number;
}

export interface LegacyLogBlockRecord {
  kind: "legacy_log_block";
  ts?: string;
  domainId: string;
  text: string;
}

export function buildLogRecord(
  domainId: string,
  event: LogOperation,
  timestamp = new Date().toISOString(),
): OperationLogRecord {
  if (event.op === "ingest") {
    return {
      kind: "operation",
      ts: timestamp,
      domainId,
      op: event.op,
      sourcePath: event.sourcePath,
      entries: event.entries,
      outputTokens: event.outputTokens,
    };
  }
  if (event.op === "lint") {
    return {
      kind: "operation",
      ts: timestamp,
      domainId,
      op: event.op,
      fixed: event.fixed,
      checkedCount: event.checkedCount,
      outputTokens: event.outputTokens,
    };
  }
  return {
    kind: "operation",
    ts: timestamp,
    domainId,
    op: event.op,
    filePath: event.filePath,
    fixed: event.fixed,
    outputTokens: event.outputTokens,
  };
}

export function parseLegacyLogBlocks(markdown: string, domainId: string): LegacyLogBlockRecord[] {
  return markdown
    .split(/\n---\n?/g)
    .map((text) => text.trim())
    .filter(Boolean)
    .map((text) => {
      const tsMatch = text.match(/^##\s+([0-9T:-]+)/);
      return {
        kind: "legacy_log_block" as const,
        ts: tsMatch?.[1],
        domainId,
        text,
      };
    });
}

export async function appendWikiLog(
  vaultTools: VaultTools,
  domainFolder: string,
  domainId: string,
  event: LogOperation,
): Promise<void> {
  const logPath = domainLogPath(domainFolder);
  const before = await readFileImage(vaultTools, logPath);
  const content = (before.exists ? before.content : "")
    + stringifyJsonl([buildLogRecord(domainId, event)]);
  if (vaultTools instanceof TransactionVaultTools) {
    await vaultTools.writeIfCurrent(logPath, before, content);
  } else {
    await vaultTools.write(logPath, content);
  }
}
