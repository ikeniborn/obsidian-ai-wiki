import assert from "node:assert/strict";
import test from "node:test";
import { migrateJsonlDomainStorage } from "../src/migrate-jsonl-domain-storage";
import { parseJsonl } from "../src/jsonl";

class MemoryAdapter {
  files = new Map<string, string>();

  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || [...this.files.keys()].some((p) => p.startsWith(path + "/"));
  }

  async read(path: string): Promise<string> {
    const v = this.files.get(path);
    if (v === undefined) throw new Error(`ENOENT ${path}`);
    return v;
  }

  async write(path: string, data: string): Promise<void> {
    this.files.set(path, data);
  }

  async remove(path: string): Promise<void> {
    this.files.delete(path);
  }

  async rename(from: string, to: string): Promise<void> {
    const v = await this.read(from);
    this.files.delete(from);
    this.files.set(to, v);
  }

  async list(path: string): Promise<{ files: string[]; folders: string[] }> {
    const folders = new Set<string>();
    const files: string[] = [];
    for (const key of this.files.keys()) {
      if (!key.startsWith(path + "/")) continue;
      const rest = key.slice(path.length + 1);
      const first = rest.split("/")[0];
      if (rest.includes("/")) folders.add(`${path}/${first}`);
      else files.push(`${path}/${first}`);
    }
    return { files, folders: [...folders].sort() };
  }
}

function vault(adapter: MemoryAdapter): any {
  return {
    adapter,
    createFolder: async (path: string) => {
      adapter.files.set(`${path}/.keep`, "");
    },
  };
}

test("migrates legacy service files to jsonl, backs up, validates, and deletes legacy files", async () => {
  const adapter = new MemoryAdapter();
  adapter.files.set("!Wiki/_config/_domain.json", JSON.stringify([{
    id: "hld",
    name: "HLD",
    wiki_folder: "hld",
    source_paths: ["src"],
    entity_types: [{ type: "system", description: "System", extraction_cues: ["sys"], wiki_subfolder: "systems" }],
    analyzed_sources: { "src/СКИТ.md": "hash1" },
    analyzed_sources_v2: true,
    analyzed_sources_v3: true,
  }]));
  adapter.files.set("!Wiki/hld/_config/_index.md", "# Wiki Index\n\n## systems\n- hld_system — Legacy annotation\n");
  adapter.files.set("!Wiki/hld/_config/_log.md", "## 2026-07-10 — ingest — hld\n**Tokens:** 10\n\n---\n");
  adapter.files.set("!Wiki/hld/_config/_embeddings.json", JSON.stringify({
    version: 3,
    model: "nomic",
    dimensions: 2,
    entries: {
      hld_system: { chunks: [{ kind: "section", hash: "h1", vector: "", heading: "## Scope", ordinal: 0 }] },
    },
  }));
  adapter.files.set("!Wiki/hld/systems/hld_system.md", [
    "---",
    "type: system",
    "description: Page description",
    "resource:",
    "  - СКИТ",
    "---",
    "# HLD System",
    "## Scope",
    "Body",
  ].join("\n"));

  const report = await migrateJsonlDomainStorage(vault(adapter), { now: "20260711-120000" });

  assert.equal(report.ok, true);
  assert.equal(await adapter.exists("!Wiki/hld/metadata.jsonl"), true);
  assert.equal(await adapter.exists("!Wiki/hld/index.jsonl"), true);
  assert.equal(await adapter.exists("!Wiki/hld/log.jsonl"), true);
  assert.equal(await adapter.exists("!Wiki/.backup/jsonl-domain-storage-20260711-120000/manifest.json"), true);
  assert.equal(await adapter.exists("!Wiki/_config/_domain.json"), false);
  assert.equal(await adapter.exists("!Wiki/hld/_config/_index.md"), false);
  assert.equal(await adapter.exists("!Wiki/hld/_config/_log.md"), false);
  assert.equal(await adapter.exists("!Wiki/hld/_config/_embeddings.json"), false);

  const metadata = parseJsonl(await adapter.read("!Wiki/hld/metadata.jsonl"), "metadata");
  assert.equal(metadata.some((r: any) => r.kind === "entity_type" && r.type === "system"), true);
  assert.equal(metadata.some((r: any) => r.kind === "source_state" && r.path === "src/СКИТ.md"), true);

  const index = parseJsonl(await adapter.read("!Wiki/hld/index.jsonl"), "index");
  assert.equal(index.some((r: any) => r.kind === "page" && r.articleId === "hld_system"), true);

  const log = parseJsonl(await adapter.read("!Wiki/hld/log.jsonl"), "log");
  assert.equal(log[0].kind, "legacy_log_block");
});
