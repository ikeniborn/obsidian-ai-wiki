"use strict";

// eval/incremental-sources/run.ts
var import_node_fs = require("node:fs");
var import_node_path = require("node:path");
var import_node_os = require("node:os");

// src/incremental-sources.ts
function computeChangedSources(input) {
  const { sourceFiles, wikiPages } = input;
  const changed = [];
  for (const src of sourceFiles) {
    const associated = wikiPages.filter((p) => p.sources.includes(src.stem));
    if (associated.length === 0) {
      changed.push(src.path);
      continue;
    }
    if (src.mtime === null || associated.some((p) => p.mtime === null)) {
      changed.push(src.path);
      continue;
    }
    const oldestPage = Math.min(...associated.map((p) => p.mtime));
    if (src.mtime > oldestPage) changed.push(src.path);
  }
  return { changed };
}
function capList(names, cap = 20) {
  if (names.length <= cap) return { shown: names, overflow: 0 };
  return { shown: names.slice(0, cap), overflow: names.length - cap };
}

// src/vault-tools.ts
function codePointsHex(name) {
  return Array.from(name).map((ch) => "U+" + (ch.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0")).join(" ");
}
function isNotFound(e) {
  const err = e;
  if (err?.code === "ENOENT") return true;
  return /ENOENT|no such file|not exist/i.test(String(err?.message ?? ""));
}
var VaultTools = class {
  constructor(adapter, basePath, vault) {
    this.adapter = adapter;
    this.basePath = basePath;
    this.vault = vault;
  }
  adapter;
  basePath;
  vault;
  get vaultRoot() {
    return this.basePath;
  }
  async read(vaultPath) {
    try {
      return await this.adapter.read(vaultPath);
    } catch (e) {
      if (!isNotFound(e)) throw e;
      await this.diagnose(vaultPath);
      const resolved = await this.resolveOnDiskPath(vaultPath);
      if (resolved !== vaultPath) {
        const data = await this.adapter.read(resolved);
        const formLabel = resolved === vaultPath.normalize("NFD") ? "NFD" : "NFC";
        console.warn(`[ai-wiki] read recovered (${formLabel}): ${vaultPath}`);
        return data;
      }
      throw e;
    }
  }
  async write(vaultPath, content) {
    const target = await this.resolveOnDiskPath(vaultPath);
    const segments = target.split("/").slice(0, -1);
    for (let i = 1; i <= segments.length; i++) {
      const partial = segments.slice(0, i).join("/");
      let exists = false;
      try {
        exists = await this.adapter.exists(partial);
      } catch {
      }
      if (!exists) {
        try {
          await this.adapter.mkdir(partial);
        } catch {
        }
      }
    }
    if (this.vault) {
      const indexed = this.vault.getAbstractFileByPath(target);
      if (indexed) {
        await this.vault.modify(indexed, content);
      } else {
        try {
          await this.vault.create(target, content);
        } catch {
          await this.adapter.write(target, content);
        }
      }
    } else {
      await this.adapter.write(target, content);
    }
  }
  /**
   * Return the path form that actually exists on disk (the input, its NFC, or
   * its NFD form), or the input unchanged for a genuinely new file. ASCII paths
   * normalize to themselves, so both retry branches are skipped — zero effect
   * on the common case. Used by both read (recovery) and write (guard).
   */
  async resolveOnDiskPath(vaultPath) {
    if (await this.adapter.exists(vaultPath)) return vaultPath;
    const nfc = vaultPath.normalize("NFC");
    if (nfc !== vaultPath && await this.adapter.exists(nfc)) return nfc;
    const nfd = vaultPath.normalize("NFD");
    if (nfd !== vaultPath && await this.adapter.exists(nfd)) return nfd;
    return vaultPath;
  }
  /**
   * Emit one compact console.warn explaining a read miss: filename codepoints,
   * whether the name is decomposable, per-form existence, and the actual parent
   * dirents (capped at 20). Enough to confirm the cause from a single repro.
   */
  async diagnose(vaultPath) {
    const name = vaultPath.split("/").pop() ?? vaultPath;
    const nfc = vaultPath.normalize("NFC");
    const nfd = vaultPath.normalize("NFD");
    const probe = async (p) => {
      try {
        return await this.adapter.exists(p) ? "OK" : "ENOENT";
      } catch {
        return "ERR";
      }
    };
    const nfcResult = await probe(nfc);
    const nfdResult = await probe(nfd);
    let dirents = "n/a";
    try {
      const parent = vaultPath.split("/").slice(0, -1).join("/");
      const { files } = await this.adapter.list(parent);
      dirents = JSON.stringify(files.map((f) => f.split("/").pop()).slice(0, 20));
    } catch {
    }
    console.warn(
      `[ai-wiki] read miss: ${JSON.stringify(vaultPath)}
  filename codepoints: ${codePointsHex(name)}
  nfc!=nfd: ${nfc !== nfd}
  forms: NFC\u2192${nfcResult} NFD\u2192${nfdResult}
  parent dirents: ${dirents}`
    );
  }
  async listFiles(vaultDir) {
    const exists = await this.adapter.exists(vaultDir);
    if (!exists) return [];
    return this._listRecursive(vaultDir);
  }
  async _listRecursive(vaultDir) {
    const result = await this.adapter.list(vaultDir);
    const deeper = await Promise.all(result.folders.map((f) => this._listRecursive(f)));
    return [...result.files, ...deeper.flat()];
  }
  async readAll(paths) {
    const entries = await Promise.all(
      paths.map(async (p) => {
        try {
          return [p, await this.read(p)];
        } catch {
          return null;
        }
      })
    );
    return new Map(entries.filter((e) => e !== null));
  }
  async exists(vaultPath) {
    return this.adapter.exists(vaultPath);
  }
  /** Modification time in epoch ms, or null when unavailable (missing file or no stat support). */
  async mtime(vaultPath) {
    if (!this.adapter.stat) return null;
    const s = await this.adapter.stat(vaultPath);
    return s ? s.mtime : null;
  }
  async readBinary(vaultPath) {
    if (!this.adapter.readBinary) throw new Error("readBinary not supported by this adapter");
    return this.adapter.readBinary(vaultPath);
  }
  async writeBinary(vaultPath, data) {
    if (!this.adapter.writeBinary) throw new Error("writeBinary not supported by this adapter");
    const segments = vaultPath.split("/").slice(0, -1);
    for (let i = 1; i <= segments.length; i++) {
      const partial = segments.slice(0, i).join("/");
      let exists = false;
      try {
        exists = await this.adapter.exists(partial);
      } catch {
      }
      if (!exists) {
        try {
          await this.adapter.mkdir(partial);
        } catch {
        }
      }
    }
    await this.adapter.writeBinary(vaultPath, data);
  }
  /**
   * Resolve an Obsidian wiki-link to a vault-relative path. Returns null when the
   * adapter cannot resolve it: falling back to the raw linkpath would let an
   * unresolved embed like `![[../../secret.png]]` reach read/readBinary, which on
   * desktop escapes the vault root via path.join. Callers must skip on null.
   */
  resolveLink(linkpath, sourcePath) {
    return this.adapter.resolveLink?.(linkpath, sourcePath) ?? null;
  }
  /**
   * Render an Excalidraw file to a base64 PNG via the host plugin (wired in
   * controller). Returns null when no renderer is available (no host plugin,
   * mobile, or render error) — callers treat null as "Vision skipped".
   */
  async renderExcalidrawPng(resolvedPath) {
    return await this.adapter.renderExcalidrawPng?.(resolvedPath) ?? null;
  }
  async mkdir(vaultPath) {
    return this.adapter.mkdir(vaultPath);
  }
  async remove(vaultPath) {
    await this.adapter.remove?.(vaultPath);
  }
  async removeSubfolders(vaultDir) {
    const exists = await this.adapter.exists(vaultDir);
    if (!exists) return;
    const { folders } = await this.adapter.list(vaultDir);
    for (const folder of folders) {
      try {
        await this.adapter.rmdir?.(folder, true);
      } catch {
      }
    }
  }
  toVaultPath(absolutePath) {
    const base = this.basePath.endsWith("/") ? this.basePath : this.basePath + "/";
    if (!absolutePath.startsWith(base)) return null;
    return absolutePath.slice(base.length);
  }
};

// eval/incremental-sources/run.ts
var pass = 0;
var fail = 0;
var failures = [];
function check(name, cond, detail = "") {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    failures.push(name);
    console.log(`  FAIL  ${name}${detail ? `
        \u2192 ${detail}` : ""}`);
  }
}
function section(t) {
  console.log(`
=== ${t} ===`);
}
section("computeChangedSources \u2014 pure rules");
check("1 unchanged source excluded", computeChangedSources({
  sourceFiles: [{ stem: "a", path: "src/a.md", mtime: 100 }],
  wikiPages: [{ path: "w/wiki_d_a.md", mtime: 200, sources: ["a"] }]
}).changed.length === 0);
check("2 edited source included", computeChangedSources({
  sourceFiles: [{ stem: "a", path: "src/a.md", mtime: 300 }],
  wikiPages: [{ path: "w/wiki_d_a.md", mtime: 200, sources: ["a"] }]
}).changed[0] === "src/a.md");
check("3 equal mtime excluded (strict >)", computeChangedSources({
  sourceFiles: [{ stem: "a", path: "src/a.md", mtime: 200 }],
  wikiPages: [{ path: "w/wiki_d_a.md", mtime: 200, sources: ["a"] }]
}).changed.length === 0);
check("4 new source included", computeChangedSources({
  sourceFiles: [{ stem: "b", path: "src/b.md", mtime: 50 }],
  wikiPages: [{ path: "w/wiki_d_a.md", mtime: 200, sources: ["a"] }]
}).changed[0] === "src/b.md");
check("5 null source mtime included", computeChangedSources({
  sourceFiles: [{ stem: "a", path: "src/a.md", mtime: null }],
  wikiPages: [{ path: "w/wiki_d_a.md", mtime: 200, sources: ["a"] }]
}).changed[0] === "src/a.md");
check("6 null page mtime included", computeChangedSources({
  sourceFiles: [{ stem: "a", path: "src/a.md", mtime: 100 }],
  wikiPages: [{ path: "w/wiki_d_a.md", mtime: null, sources: ["a"] }]
}).changed[0] === "src/a.md");
check("7 min aggregation, unedited shared-source excluded", computeChangedSources({
  sourceFiles: [{ stem: "a", path: "src/a.md", mtime: 100 }],
  wikiPages: [
    { path: "w/wiki_d_p1.md", mtime: 150, sources: ["a"] },
    // a's own page
    { path: "w/wiki_d_p2.md", mtime: 500, sources: ["a", "b"] }
    // shared, bumped by b later
  ]
}).changed.length === 0);
check("8 strict subset", JSON.stringify(computeChangedSources({
  sourceFiles: [
    { stem: "a", path: "src/a.md", mtime: 100 },
    { stem: "b", path: "src/b.md", mtime: 999 }
  ],
  wikiPages: [
    { path: "w/wiki_d_a.md", mtime: 200, sources: ["a"] },
    { path: "w/wiki_d_b.md", mtime: 200, sources: ["b"] }
  ]
}).changed) === JSON.stringify(["src/b.md"]));
section("capList");
check("9 capList under cap returns all", (() => {
  const r = capList(["a", "b"], 20);
  return r.shown.length === 2 && r.overflow === 0;
})());
check("10 capList over cap truncates + overflow", (() => {
  const names = Array.from({ length: 25 }, (_, i) => `n${i}`);
  const r = capList(names, 20);
  return r.shown.length === 20 && r.overflow === 5;
})());
section("node-fs integration \u2014 A2 order contract");
(async () => {
  const dir = (0, import_node_fs.mkdtempSync)((0, import_node_path.join)((0, import_node_os.tmpdir)(), "incr-reinit-"));
  try {
    const adapter = {
      read: async (p) => "",
      write: async () => {
      },
      append: async () => {
      },
      list: async () => ({ files: [], folders: [] }),
      exists: async () => true,
      mkdir: async () => {
      },
      stat: async (p) => {
        try {
          return { mtime: (0, import_node_fs.statSync)((0, import_node_path.join)(dir, p)).mtimeMs };
        } catch {
          return null;
        }
      }
    };
    const vt = new VaultTools(adapter, dir);
    const srcRel = "a.md", pageRel = "wiki_d_a.md";
    (0, import_node_fs.writeFileSync)((0, import_node_path.join)(dir, srcRel), "---\ntitle: A\n---\nbody");
    (0, import_node_fs.writeFileSync)((0, import_node_path.join)(dir, pageRel), "---\nwiki_sources:\n  - a\n---\npage");
    const srcMtime = await vt.mtime(srcRel);
    const pageMtime = await vt.mtime(pageRel);
    check(
      "11 page mtime \u2265 source mtime after A2 order",
      (pageMtime ?? 0) >= (srcMtime ?? 0),
      `src=${srcMtime} page=${pageMtime}`
    );
    const before = computeChangedSources({
      sourceFiles: [{ stem: "a", path: srcRel, mtime: srcMtime }],
      wikiPages: [{ path: pageRel, mtime: pageMtime, sources: ["a"] }]
    });
    check("12 un-edited vault \u2192 no changes", before.changed.length === 0, JSON.stringify(before));
    (0, import_node_fs.utimesSync)((0, import_node_path.join)(dir, srcRel), /* @__PURE__ */ new Date(), new Date((pageMtime ?? 0) + 1e4));
    const editedMtime = await vt.mtime(srcRel);
    const after = computeChangedSources({
      sourceFiles: [{ stem: "a", path: srcRel, mtime: editedMtime }],
      wikiPages: [{ path: pageRel, mtime: pageMtime, sources: ["a"] }]
    });
    check("13 edited source \u2192 flagged", after.changed[0] === srcRel, JSON.stringify(after));
  } finally {
    (0, import_node_fs.rmSync)(dir, { recursive: true, force: true });
  }
  console.log(`
========================================`);
  console.log(`TOTAL: ${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.log(`FAILED: ${failures.join(", ")}`);
    process.exitCode = 1;
  }
})();
