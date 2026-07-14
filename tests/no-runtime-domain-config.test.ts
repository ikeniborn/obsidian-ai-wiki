import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { ensureDomainConfig } from "../src/domain-config";
import { VaultTools, type VaultAdapter } from "../src/vault-tools";

const root = process.cwd();

test("normal runtime does not create per-domain _config folders", () => {
  const domainConfig = readFileSync(join(root, "src/domain-config.ts"), "utf8");
  assert.doesNotMatch(domainConfig, /mkdir\(\s*domainConfigDir/);
  assert.doesNotMatch(domainConfig, /legacyDomainConfigDir\([^)]*\).*mkdir/s);
});

test("GLOBAL agent log constants are not used by controller active logging", () => {
  const controller = readFileSync(join(root, "src/controller.ts"), "utf8");
  assert.match(controller, /pluginDir\(\).*agent\.jsonl/s);
  assert.doesNotMatch(controller, /GLOBAL_AGENT_LOG_PATH/);
});

test("legacy per-domain _config files migrate without creating _config folders", async () => {
  const adapter = new MemoryAdapter([
    ["!Wiki", ""],
    ["!Wiki/hld", ""],
    ["!Wiki/hld/_config/_index.md", "{\"slug\":\"legacy\"}\n"],
  ]);
  const vaultTools = new VaultTools(adapter, "");

  await ensureDomainConfig(vaultTools, "!Wiki/hld");

  assert.equal(adapter.files.get("!Wiki/hld/index.jsonl"), "{\"slug\":\"legacy\"}\n");
  assert.equal(adapter.files.has("!Wiki/hld/_config/_index.md"), false);
  assert.equal(adapter.mkdirCalls.includes("!Wiki/hld/_config"), false);
});

class MemoryAdapter implements VaultAdapter {
  readonly files = new Map<string, string>();
  readonly mkdirCalls: string[] = [];

  constructor(entries: Array<[string, string]>) {
    for (const [path, value] of entries) this.files.set(path, value);
  }

  async read(path: string): Promise<string> {
    const value = this.files.get(path);
    if (value === undefined) throw new Error(`ENOENT: ${path}`);
    return value;
  }

  async write(path: string, data: string): Promise<void> {
    this.files.set(path, data);
  }

  async append(path: string, data: string): Promise<void> {
    this.files.set(path, (this.files.get(path) ?? "") + data);
  }

  async list(path: string): Promise<{ files: string[]; folders: string[] }> {
    const prefix = path.endsWith("/") ? path : `${path}/`;
    const files: string[] = [];
    const folders = new Set<string>();
    for (const key of this.files.keys()) {
      if (!key.startsWith(prefix)) continue;
      const rest = key.slice(prefix.length);
      const [head, ...tail] = rest.split("/");
      if (!head) continue;
      if (tail.length > 0) folders.add(`${prefix}${head}`);
      else files.push(key);
    }
    return { files, folders: [...folders] };
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }

  async mkdir(path: string): Promise<void> {
    this.mkdirCalls.push(path);
    this.files.set(path, "");
  }

  async remove(path: string): Promise<void> {
    this.files.delete(path);
  }
}
