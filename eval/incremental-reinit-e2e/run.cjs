"use strict";

// eval/incremental-reinit-e2e/run.ts
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
function parsePageSources(content) {
  const fmMatch = /^---\n([\s\S]*?)\n---/.exec(content);
  if (!fmMatch) return [];
  const listMatch = /wiki_sources:\s*\n((?:[ \t]+-[ \t]+[^\n]+\n?)+)/m.exec(fmMatch[1]);
  if (!listMatch) return [];
  return listMatch[1].split("\n").map((l) => l.replace(/^[ \t]+-[ \t]+/, "").trim()).filter(Boolean).map((t) => t.replace(/^["']|["']$/g, "").replace(/^\[\[|\]\]$/g, "").trim()).map((t) => t.split("/").pop().replace(/\.md$/, "")).filter(Boolean);
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

// eval/incremental-reinit-e2e/run.ts
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
function fsAdapter(root) {
  return {
    read: async (p) => (0, import_node_fs.readFileSync)((0, import_node_path.join)(root, p), "utf8"),
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
        return { mtime: (0, import_node_fs.statSync)((0, import_node_path.join)(root, p)).mtimeMs };
      } catch {
        return null;
      }
    }
  };
}
function writeFile(root, rel, content, mtimeMs) {
  const abs = (0, import_node_path.join)(root, rel);
  (0, import_node_fs.mkdirSync)((0, import_node_path.dirname)(abs), { recursive: true });
  (0, import_node_fs.writeFileSync)(abs, content);
  if (mtimeMs !== void 0) {
    const d = new Date(mtimeMs);
    (0, import_node_fs.utimesSync)(abs, d, d);
  }
}
var sourceArticle = (title) => `---
title: ${title}
---

# ${title}

Body of ${title}.
`;
var wikiPage = (stems) => `---
wiki_sources:
${stems.map((s) => `  - "[[${s}]]"`).join("\n")}
---

Wiki page for ${stems.join(", ")}.
`;
async function detect(root, sources, wikis) {
  const vt = new VaultTools(fsAdapter(root), root);
  const sourceFiles = [];
  for (const path of sources) {
    sourceFiles.push({ stem: (0, import_node_path.basename)(path).replace(/\.md$/, ""), path, mtime: await vt.mtime(path) });
  }
  const wikiPages = [];
  for (const path of wikis) {
    const content = await vt.read(path).catch(() => "");
    wikiPages.push({ path, mtime: await vt.mtime(path), sources: parsePageSources(content) });
  }
  return computeChangedSources({ sourceFiles, wikiPages }).changed;
}
async function main() {
  const dir = (0, import_node_fs.mkdtempSync)((0, import_node_path.join)((0, import_node_os.tmpdir)(), "incr-e2e-"));
  try {
    const T0 = 17e11;
    const srcOf = (s) => `notes/${s}.md`;
    const pageOf = (s) => `wiki/wiki_d_${s}.md`;
    const stems = ["alpha", "beta", "gamma"];
    for (let i = 0; i < stems.length; i++) {
      const s = stems[i];
      const srcMtime = T0 + i * 100;
      writeFile(dir, srcOf(s), sourceArticle(s), srcMtime);
      writeFile(dir, pageOf(s), wikiPage([s]), srcMtime + 1e3);
    }
    const allSources = stems.map(srcOf);
    const allWikis = stems.map(pageOf);
    section("S1 \u2014 fresh vault right after ingest \u2192 nothing flagged (A2 invariant)");
    {
      const changed = await detect(dir, allSources, allWikis);
      check("S1 no changed sources right after ingest", changed.length === 0, JSON.stringify(changed));
    }
    section("S2 \u2014 real consecutive A2 writes: page mtime >= source mtime");
    {
      const vt = new VaultTools(fsAdapter(dir), dir);
      writeFile(dir, srcOf("delta"), sourceArticle("delta"));
      writeFile(dir, pageOf("delta"), wikiPage(["delta"]));
      const sm = await vt.mtime(srcOf("delta"));
      const pm = await vt.mtime(pageOf("delta"));
      check("S2 page mtime >= source mtime after A2 write order", (pm ?? 0) >= (sm ?? 0), `src=${sm} page=${pm}`);
      const changed = await detect(dir, [srcOf("delta")], [pageOf("delta")]);
      check("S2 freshly-ingested delta not flagged", changed.length === 0, JSON.stringify(changed));
    }
    section("S3 \u2014 edit exactly one source \u2192 only it is flagged");
    {
      const alphaPageMtime = (0, import_node_fs.statSync)((0, import_node_path.join)(dir, pageOf("alpha"))).mtimeMs;
      const edited = new Date(alphaPageMtime + 1e4);
      (0, import_node_fs.utimesSync)((0, import_node_path.join)(dir, srcOf("alpha")), edited, edited);
      const changed = await detect(dir, allSources, allWikis);
      check("S3 edited alpha flagged", changed.includes(srcOf("alpha")), JSON.stringify(changed));
      check("S3 unedited beta NOT flagged", !changed.includes(srcOf("beta")), JSON.stringify(changed));
      check("S3 unedited gamma NOT flagged", !changed.includes(srcOf("gamma")), JSON.stringify(changed));
      check("S3 exactly one source flagged", changed.length === 1, JSON.stringify(changed));
    }
    section("S4 \u2014 brand-new source with no wiki page \u2192 flagged (trust bias)");
    {
      const alphaPageMtime = (0, import_node_fs.statSync)((0, import_node_path.join)(dir, pageOf("alpha"))).mtimeMs;
      const reset = new Date(alphaPageMtime - 500);
      (0, import_node_fs.utimesSync)((0, import_node_path.join)(dir, srcOf("alpha")), reset, reset);
      writeFile(dir, srcOf("omega"), sourceArticle("omega"), T0 + 5e3);
      const sources = [...allSources, srcOf("omega")];
      const changed = await detect(dir, sources, allWikis);
      check("S4 new omega (no page) flagged", changed.includes(srcOf("omega")), JSON.stringify(changed));
      check("S4 only the new source flagged", changed.length === 1, JSON.stringify(changed));
    }
    section("S5 \u2014 parsePageSources extracts the structural mapping from a real page");
    {
      const content = (0, import_node_fs.readFileSync)((0, import_node_path.join)(dir, pageOf("alpha")), "utf8");
      const parsed = parsePageSources(content);
      check("S5 parsePageSources(alpha page) === ['alpha']", JSON.stringify(parsed) === JSON.stringify(["alpha"]));
    }
    section("S6 \u2014 shared page + min aggregation: unedited shared source stays excluded");
    {
      const eMtime = T0 + 6e3;
      writeFile(dir, srcOf("epsilon"), sourceArticle("epsilon"), eMtime);
      writeFile(dir, "wiki/wiki_d_epsilon.md", wikiPage(["epsilon"]), eMtime + 1e3);
      writeFile(dir, "wiki/wiki_d_shared.md", wikiPage(["epsilon", "zeta"]), eMtime + 5e4);
      const changed = await detect(
        dir,
        [srcOf("epsilon")],
        ["wiki/wiki_d_epsilon.md", "wiki/wiki_d_shared.md"]
      );
      check("S6 unedited epsilon excluded under min aggregation", changed.length === 0, JSON.stringify(changed));
    }
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
}
void main();
