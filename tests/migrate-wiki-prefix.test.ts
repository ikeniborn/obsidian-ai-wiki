import { describe, it, expect } from "vitest";
import { migrateDomain } from "../src/migrate-wiki-prefix";
import type { VaultAdapter } from "../src/vault-tools";
import type { DomainEntry } from "../src/domain";

function memoryAdapter(initial: Record<string, string>): VaultAdapter & { files: Map<string, string> } {
  const files = new Map(Object.entries(initial));
  return {
    files,
    async read(p: string) {
      const v = files.get(p);
      if (v === undefined) throw new Error(`not found: ${p}`);
      return v;
    },
    async write(p: string, c: string) { files.set(p, c); },
    async append(p: string, c: string) { files.set(p, (files.get(p) ?? "") + c); },
    async list(dir: string) {
      const prefix = dir.endsWith("/") ? dir : dir + "/";
      const out = { files: [] as string[], folders: new Set<string>() };
      for (const k of files.keys()) {
        if (!k.startsWith(prefix)) continue;
        const rest = k.slice(prefix.length);
        if (rest.includes("/")) {
          out.folders.add(prefix + rest.split("/")[0]);
        } else {
          out.files.push(k);
        }
      }
      return { files: out.files, folders: [...out.folders] };
    },
    async exists(p: string) {
      if (files.has(p)) return true;
      const prefix = p.endsWith("/") ? p : p + "/";
      for (const k of files.keys()) if (k.startsWith(prefix)) return true;
      return false;
    },
    async mkdir() { /* no-op */ },
    async remove(p: string) { files.delete(p); },
  };
}

describe("migrateDomain", () => {
  const baseDomain: DomainEntry = {
    id: "work",
    name: "Work",
    wiki_folder: "work",
    source_paths: ["Sources"],
  };

  it("renames unprefixed wiki pages and rewrites body backlinks", async () => {
    const adapter = memoryAdapter({
      "!Wiki/work/entities/Foo.md": "# Foo\n\nSee [[Bar]] for details.",
      "!Wiki/work/entities/Bar.md": "# Bar\n\nRelated to [[Foo]].",
    });
    const domain: DomainEntry = { ...baseDomain };
    const report = await migrateDomain(domain, adapter);
    expect(report.filesRenamed).toBe(2);
    expect(adapter.files.has("!Wiki/work/entities/Foo.md")).toBe(false);
    expect(adapter.files.has("!Wiki/work/entities/Bar.md")).toBe(false);
    expect(adapter.files.get("!Wiki/work/entities/wiki_work_foo.md")).toContain("[[wiki_work_bar]]");
    expect(adapter.files.get("!Wiki/work/entities/wiki_work_bar.md")).toContain("[[wiki_work_foo]]");
    expect(domain.pageNameVersion).toBe(1);
  });

  it("rewrites _index.md entries (wikilink + path)", async () => {
    const adapter = memoryAdapter({
      "!Wiki/work/entities/Foo.md": "# Foo",
      "!Wiki/work/_config/_index.md":
        "# Wiki Index\n\n## entities\n- [[Foo]] entities/Foo.md — описание\n",
    });
    const domain: DomainEntry = { ...baseDomain };
    await migrateDomain(domain, adapter);
    const idx = adapter.files.get("!Wiki/work/_config/_index.md")!;
    expect(idx).toContain("[[wiki_work_foo]]");
    expect(idx).toContain("entities/wiki_work_foo.md");
    expect(idx).not.toContain("[[Foo]]");
    expect(idx).not.toContain("entities/Foo.md");
  });

  it("renames _embeddings.json entries keys", async () => {
    const adapter = memoryAdapter({
      "!Wiki/work/entities/Foo.md": "# Foo",
      "!Wiki/work/_config/_embeddings.json": JSON.stringify({
        entries: { Foo: { hash: "abc", vector: [0.1, 0.2] } },
      }),
    });
    const domain: DomainEntry = { ...baseDomain };
    await migrateDomain(domain, adapter);
    const emb = JSON.parse(adapter.files.get("!Wiki/work/_config/_embeddings.json")!);
    expect(emb.entries.wiki_work_foo).toBeDefined();
    expect(emb.entries.Foo).toBeUndefined();
  });

  it("rewrites _log.md path lines", async () => {
    const adapter = memoryAdapter({
      "!Wiki/work/entities/Foo.md": "# Foo",
      "!Wiki/work/_config/_log.md":
        "# Лог\n- 2026-05-29 СОЗДАНА: entities/Foo.md (stub)\n",
    });
    const domain: DomainEntry = { ...baseDomain };
    await migrateDomain(domain, adapter);
    const log = adapter.files.get("!Wiki/work/_config/_log.md")!;
    expect(log).toContain("entities/wiki_work_foo.md");
    expect(log).not.toContain("entities/Foo.md");
  });

  it("rewrites source wiki_articles", async () => {
    const adapter = memoryAdapter({
      "!Wiki/work/entities/Foo.md": "# Foo",
      "Sources/article.md":
        '---\nwiki_added: 2026-01-01\nwiki_updated: 2026-01-01\nwiki_articles:\n  - "[[Foo]]"\n---\nsource',
    });
    const domain: DomainEntry = { ...baseDomain };
    await migrateDomain(domain, adapter);
    const src = adapter.files.get("Sources/article.md")!;
    expect(src).toContain('[[wiki_work_foo]]');
    expect(src).not.toContain('"[[Foo]]"');
  });

  it("is idempotent — skips when pageNameVersion >= 1", async () => {
    const adapter = memoryAdapter({
      "!Wiki/work/entities/Foo.md": "# Foo",
    });
    const domain: DomainEntry = { ...baseDomain, pageNameVersion: 1 };
    const report = await migrateDomain(domain, adapter);
    expect(report.filesRenamed).toBe(0);
    expect(report.skipped).toBe(true);
    expect(adapter.files.has("!Wiki/work/entities/Foo.md")).toBe(true);
  });

  it("dry-run does not modify files", async () => {
    const before = {
      "!Wiki/work/entities/Foo.md": "# Foo",
    };
    const adapter = memoryAdapter(before);
    const domain: DomainEntry = { ...baseDomain };
    const report = await migrateDomain(domain, adapter, { dryRun: true });
    expect(report.filesRenamed).toBe(1);
    expect(adapter.files.has("!Wiki/work/entities/Foo.md")).toBe(true);
    expect(adapter.files.has("!Wiki/work/entities/wiki_work_foo.md")).toBe(false);
    expect(domain.pageNameVersion).toBeUndefined();
  });

  it("does not touch already-prefixed pages and sets version when all-prefixed", async () => {
    const adapter = memoryAdapter({
      "!Wiki/work/entities/wiki_work_foo.md": "# Foo",
    });
    const domain: DomainEntry = { ...baseDomain };
    const report = await migrateDomain(domain, adapter);
    expect(report.filesRenamed).toBe(0);
    expect(domain.pageNameVersion).toBe(1);
    expect(adapter.files.has("!Wiki/work/entities/wiki_work_foo.md")).toBe(true);
  });

  it("lowercases entity portion of prefixed-but-uppercase stems", async () => {
    const adapter = memoryAdapter({
      "!Wiki/work/entities/wiki_work_Foo.md": "# Foo\nLinks: [[wiki_work_Bar]]",
      "!Wiki/work/entities/wiki_work_Bar.md": "# Bar",
    });
    const domain: DomainEntry = { ...baseDomain };
    const report = await migrateDomain(domain, adapter);
    expect(report.filesRenamed).toBe(2);
    expect(adapter.files.has("!Wiki/work/entities/wiki_work_foo.md")).toBe(true);
    expect(adapter.files.has("!Wiki/work/entities/wiki_work_bar.md")).toBe(true);
    expect(adapter.files.has("!Wiki/work/entities/wiki_work_Foo.md")).toBe(false);
    const fooBody = adapter.files.get("!Wiki/work/entities/wiki_work_foo.md")!;
    expect(fooBody).toContain("[[wiki_work_bar]]");
    expect(domain.pageNameVersion).toBe(1);
  });
});
