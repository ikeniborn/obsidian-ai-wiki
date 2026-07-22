#!/usr/bin/env node
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { createRequire, register } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { applyDomainEvent, type DomainEntry } from "../src/domain";
import { parseDomainMetadata, stringifyDomainMetadata, domainEntryToMetadataRecords } from "../src/domain-metadata";
import { resolveEffective } from "../src/effective-settings";
import type { LocalConfig } from "../src/local-config";
import { createNativeOpenAiClient } from "../src/native-openai-client";
import {
  DEFAULT_SETTINGS,
  normalizeLlmRuntimeControls,
  type LlmWikiPluginSettings,
  type RunEvent,
} from "../src/types";
import { VaultTools, type VaultAdapter, type VaultStat } from "../src/vault-tools";
import { domainMetadataPath, domainWikiFolder, LEGACY_GLOBAL_DOMAIN_PATH, WIKI_ROOT } from "../src/wiki-path";

register(new URL("./eval-node-loader.mjs", import.meta.url));

interface Options {
  vault: string;
  pluginDir: string;
  domain: string;
  apiKeyFile?: string;
  out: string;
  stopBeforeWipe: boolean;
}

function cloneSettings(settings: LlmWikiPluginSettings): LlmWikiPluginSettings {
  return JSON.parse(JSON.stringify(settings)) as LlmWikiPluginSettings;
}

function mergeSettings(data: Record<string, unknown> | null): LlmWikiPluginSettings {
  const base = cloneSettings(DEFAULT_SETTINGS);
  const caData = (data?.claudeAgent as Record<string, unknown>) ?? {};
  const naData = (data?.nativeAgent as Record<string, unknown>) ?? {};
  const caOps = (caData.operations as Record<string, unknown>) ?? {};
  const naOps = (naData.operations as Record<string, unknown>) ?? {};

  const merged: LlmWikiPluginSettings = {
    ...base,
    ...(data ?? {}),
    timeouts: { ...base.timeouts, ...((data?.timeouts as object) ?? {}) },
    claudeAgent: {
      ...base.claudeAgent,
      ...caData,
      operations: {
        ingest: { ...base.claudeAgent.operations.ingest, ...((caOps.ingest as object) ?? {}) },
        query: { ...base.claudeAgent.operations.query, ...((caOps.query as object) ?? {}) },
        lint: { ...base.claudeAgent.operations.lint, ...((caOps.lint as object) ?? {}) },
        init: { ...base.claudeAgent.operations.init, ...((caOps.init as object) ?? {}) },
        format: { ...base.claudeAgent.operations.format, ...((caOps.format as object) ?? {}) },
      },
    },
    nativeAgent: {
      ...base.nativeAgent,
      ...naData,
      operations: {
        ingest: { ...base.nativeAgent.operations.ingest, ...((naOps.ingest as object) ?? {}) },
        query: { ...base.nativeAgent.operations.query, ...((naOps.query as object) ?? {}) },
        lint: { ...base.nativeAgent.operations.lint, ...((naOps.lint as object) ?? {}) },
        init: { ...base.nativeAgent.operations.init, ...((naOps.init as object) ?? {}) },
        format: { ...base.nativeAgent.operations.format, ...((naOps.format as object) ?? {}) },
      },
    },
    proxy: { ...base.proxy, ...((data?.proxy as object) ?? {}) },
    history: (data?.history as LlmWikiPluginSettings["history"]) ?? [],
  };
  normalizeLlmRuntimeControls(merged);
  return merged;
}

async function readJson(pathname: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await readFile(pathname, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function safeJoin(root: string, vaultPath: string): string {
  const normalized = vaultPath.split("/").filter(Boolean).join(path.sep);
  const resolved = path.resolve(root, normalized);
  const rootResolved = path.resolve(root);
  if (resolved !== rootResolved && !resolved.startsWith(`${rootResolved}${path.sep}`)) {
    throw new Error(`path escapes vault root: ${vaultPath}`);
  }
  return resolved;
}

class FsVaultAdapter implements VaultAdapter {
  constructor(private root: string) {}

  async read(vaultPath: string): Promise<string> {
    return readFile(safeJoin(this.root, vaultPath), "utf8");
  }

  async write(vaultPath: string, data: string): Promise<void> {
    const target = safeJoin(this.root, vaultPath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, data, "utf8");
  }

  async append(vaultPath: string, data: string): Promise<void> {
    const target = safeJoin(this.root, vaultPath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, data, { encoding: "utf8", flag: "a" });
  }

  async list(vaultPath: string): Promise<{ files: string[]; folders: string[] }> {
    const root = safeJoin(this.root, vaultPath);
    const entries = await readdir(root, { withFileTypes: true });
    const prefix = vaultPath.replace(/\/+$/, "");
    const files: string[] = [];
    const folders: string[] = [];
    for (const entry of entries) {
      const child = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) folders.push(child);
      else if (entry.isFile()) files.push(child);
    }
    return { files: files.sort(), folders: folders.sort() };
  }

  async exists(vaultPath: string): Promise<boolean> {
    try {
      await stat(safeJoin(this.root, vaultPath));
      return true;
    } catch {
      return false;
    }
  }

  async stat(vaultPath: string): Promise<VaultStat | null> {
    try {
      const info = await stat(safeJoin(this.root, vaultPath));
      return {
        type: info.isDirectory() ? "folder" : "file",
        ctime: info.ctimeMs,
        mtime: info.mtimeMs,
        size: info.size,
      };
    } catch {
      return null;
    }
  }

  async mkdir(vaultPath: string): Promise<void> {
    await mkdir(safeJoin(this.root, vaultPath), { recursive: true });
  }

  async remove(vaultPath: string): Promise<void> {
    await rm(safeJoin(this.root, vaultPath), { force: true });
  }

  async rmdir(vaultPath: string, recursive: boolean): Promise<void> {
    await rm(safeJoin(this.root, vaultPath), { force: true, recursive });
  }

  async rename(from: string, to: string): Promise<void> {
    await mkdir(path.dirname(safeJoin(this.root, to)), { recursive: true });
    await rm(safeJoin(this.root, to), { force: true, recursive: true });
    await import("node:fs/promises").then((fs) => fs.rename(safeJoin(this.root, from), safeJoin(this.root, to)));
  }
}

async function loadDomains(adapter: FsVaultAdapter): Promise<DomainEntry[]> {
  const domains: DomainEntry[] = [];
  if (await adapter.exists(WIKI_ROOT)) {
    const listed = await adapter.list(WIKI_ROOT);
    for (const folder of listed.folders) {
      const name = folder.split("/").pop() ?? folder;
      if (name.startsWith(".") || name.startsWith("_")) continue;
      const metadataPath = domainMetadataPath(folder);
      if (await adapter.exists(metadataPath)) {
        domains.push(parseDomainMetadata(await adapter.read(metadataPath), metadataPath, name));
      }
    }
  }
  if (domains.length === 0 && await adapter.exists(LEGACY_GLOBAL_DOMAIN_PATH)) {
    const parsed = JSON.parse(await adapter.read(LEGACY_GLOBAL_DOMAIN_PATH)) as DomainEntry[];
    domains.push(...parsed);
  }
  for (const domain of domains) {
    if (domain.wiki_folder.startsWith("!Wiki/")) domain.wiki_folder = domain.wiki_folder.slice("!Wiki/".length);
  }
  return domains;
}

async function saveDomains(adapter: FsVaultAdapter, domains: DomainEntry[]): Promise<void> {
  await adapter.mkdir(WIKI_ROOT);
  for (const domain of domains) {
    const folder = domainWikiFolder(domain.wiki_folder);
    await adapter.mkdir(folder);
    await adapter.write(
      domainMetadataPath(folder),
      stringifyDomainMetadata(domainEntryToMetadataRecords(domain)),
    );
  }
}

function parseArgs(args: string[]): Options {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!flag?.startsWith("--") || value === undefined || value.startsWith("--")) {
      throw new Error("Invalid arguments");
    }
    values.set(flag, value);
  }
  const vault = values.get("--vault");
  const domain = values.get("--domain");
  const out = values.get("--out");
  if (!vault || !domain || !out) {
    throw new Error("Usage: tsx scripts/eval-isolated-reinit.ts --vault <vault> --domain <id> --out <events.jsonl> [--plugin-dir <vault-relative-dir>] [--api-key-file <path>] [--stop-before-wipe true]");
  }
  return {
    vault: path.resolve(vault),
    domain,
    out: path.resolve(out),
    pluginDir: values.get("--plugin-dir") ?? ".obsidian/plugins/ai-wiki",
    apiKeyFile: values.get("--api-key-file"),
    stopBeforeWipe: values.get("--stop-before-wipe") === "true",
  };
}

async function main(args: string[]): Promise<void> {
  const options = parseArgs(args);
  const runtime = globalThis as typeof globalThis & { require?: NodeJS.Require };
  runtime.require ??= createRequire(import.meta.url);
  const { AgentRunner } = await import("../src/agent-runner");

  const adapter = new FsVaultAdapter(options.vault);
  const vaultTools = new VaultTools(adapter, options.vault);
  const data = await readJson(safeJoin(options.vault, `${options.pluginDir}/data.json`));
  const local = {
    iclaudePath: "",
    ...((await readJson(safeJoin(options.vault, `${options.pluginDir}/local.json`)) ?? {}) as Partial<LocalConfig>),
  };
  const settings = resolveEffective(mergeSettings(data), local);
  if (options.apiKeyFile) {
    settings.nativeAgent.apiKey = (await readFile(options.apiKeyFile, "utf8")).trim();
  }
  if (settings.backend !== "native-agent") {
    throw new Error(`Only native-agent is supported by this eval; got ${settings.backend}`);
  }
  if (!settings.nativeAgent.apiKey) throw new Error("Native API key is empty");

  let domains = await loadDomains(adapter);
  const domain = domains.find((entry) => entry.id === options.domain);
  if (!domain) throw new Error(`Domain not found: ${options.domain}`);

  const llm = createNativeOpenAiClient({
    baseURL: settings.nativeAgent.baseUrl,
    apiKey: settings.nativeAgent.apiKey,
    connectionTimeoutMs: settings.llmConnectionTimeoutSec * 1000,
    idleTimeoutMs: settings.llmIdleTimeoutSec * 1000,
    isMobile: false,
    proxyConfig: settings.proxy,
    mobileFetch: globalThis.fetch,
  });
  const runner = new AgentRunner(
    llm,
    settings,
    vaultTools,
    path.basename(options.vault),
    domains,
    undefined,
    false,
  );

  await mkdir(path.dirname(options.out), { recursive: true });
  await writeFile(options.out, "", "utf8");
  const appendEvent = async (event: RunEvent): Promise<void> => {
    await writeFile(options.out, `${JSON.stringify(event)}\n`, { encoding: "utf8", flag: "a" });
  };

  const startedAt = Date.now();
  let finalKind = "completed";
  let errors = 0;
  const ctrl = new AbortController();
  for await (const event of runner.run({
    operation: "init",
    args: [options.domain, "--force"],
    cwd: options.vault,
    signal: ctrl.signal,
    timeoutMs: settings.timeouts.init * 1000,
    domainId: options.domain,
  })) {
    await appendEvent(event);
    if (
      options.stopBeforeWipe
      && event.kind === "tool_use"
      && event.name === "WipeDomain"
    ) {
      finalKind = "stopped-before-wipe";
      ctrl.abort();
      break;
    }
    if (
      event.kind === "domain_created"
      || event.kind === "domain_updated"
      || event.kind === "source_path_added"
      || event.kind === "source_path_removed"
    ) {
      domains = applyDomainEvent(domains, event, { vaultRoot: options.vault });
      await saveDomains(adapter, domains);
    }
    if (event.kind === "error") {
      finalKind = "error";
      errors++;
    }
  }
  const fingerprint = await readFile(options.out, "utf8")
    .then((text) => text.split(/\r?\n/).find((line) => line.includes("\"llm_request_fingerprint\"")));
  console.log(JSON.stringify({
    out: options.out,
    vault: options.vault,
    domain: options.domain,
    durationMs: Date.now() - startedAt,
    finalKind,
    errors,
    firstFingerprint: fingerprint ? JSON.parse(fingerprint) : null,
  }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(`[eval-isolated-reinit] ${(error as Error).message}`);
    process.exitCode = 1;
  });
}
