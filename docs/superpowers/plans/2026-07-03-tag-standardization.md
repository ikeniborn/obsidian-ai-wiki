---
review:
  plan_hash: c78e715471437376
  spec_hash: 5db737b4545d254b
  last_run: 2026-07-03
  phases:
    structure:     { status: passed }
    coverage:      { status: passed }
    dependencies:  { status: passed }
    verifiability: { status: passed }
    consistency:   { status: passed }
  findings:
    - id: F-001
      phase: coverage
      severity: INFO
      section: "Task 5: Documentation — README (en/ru) + iwiki"
      section_hash: 20f57b299edf0a0b
      fragment: "Modify: `README.md` (feature table, lines 23 and 29)"
      text: "Task 5 (README en/ru + iwiki page) maps to no spec requirement; it is mandated by the global CLAUDE.md rules (Keep README Current, Keep Docs Current)."
      fix: "Accepted: documentation upkeep is a standing project-wide mandate, not spec scope creep."
      verdict: accepted
      verdict_at: 2026-07-03
chain:
  intent: null
  spec: docs/superpowers/specs/2026-07-03-tag-standardization-design.md
result_check:
  verdict: OK
  plan_hash: c78e715471437376
  last_run: 2026-07-03
---
# Tag Standardization and Domain Tag Reuse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Standardize tagging: a dynamic per-domain tag registry is injected into the ingest and format LLM contexts, entity-type tags are synced deterministically, near-valid tags are normalized instead of dropped.

**Architecture:** A new pure module `src/utils/tag-registry.ts` scans frontmatter `tags:` of the domain's wiki pages and source notes and renders an `EXISTING DOMAIN TAGS` prompt block (entity categories from `entity_types` + thematic categories bounded by `max_tag_categories`, default 12). `runIngest` injects the block into the synthesis LLM call and deterministically adds the page's entity-type tag after the write; `runFormat` receives the resolved domain from `agent-runner` and injects the same block. `normalizeTag` in `raw-frontmatter.ts` salvages near-valid tags before `TAG_RE` validation.

**Tech Stack:** TypeScript, Obsidian plugin, esbuild bundle, `path-browserify` for path ops, `yaml` for frontmatter. No vitest/jest — deterministic tests are `tsx` run-scripts printing `OK — N passed, 0 failed` and calling `process.exit(1)` on failure.

**Spec:** `docs/superpowers/specs/2026-07-03-tag-standardization-design.md`

## Global Constraints

- Branch: `dev-tag-standardization` (already exists, based on `master`). Commit per task.
- Tag format is fixed by `TAG_RE = /^[a-z][a-z0-9-]*(?:[/_][a-z0-9-]+)*$/` — do not change the regex.
- Thematic category limit default: `12` (`DEFAULT_MAX_TAG_CATEGORIES`); per-domain override `DomainEntry.max_tag_categories`.
- Enforcement is SOFT: exceeding the limit yields a warning event; tags are never dropped for limit reasons.
- The full registry goes into the prompt — no truncation of the tag list.
- Format degrades silently: no resolvable domain → no block, behavior identical to today.
- Verification loop for every code task: `npx tsx eval/tag-registry/run.ts` && `npx tsc --noEmit` && `npm run lint` && `npm run build`.
- Code comments and docs in English.

---

### Task 1: `normalizeTag` + list-tags normalization in raw-frontmatter

**Files:**
- Modify: `src/utils/raw-frontmatter.ts` (TAG_RE at line 9, `list-tags` branch at lines 143–175)
- Create: `eval/tag-registry/run.ts` (test harness, extended by Task 2)

**Interfaces:**
- Consumes: existing `validateAndRepairFrontmatter`, `validateAndRepairSourceFrontmatter` (`src/utils/raw-frontmatter.ts`).
- Produces (all exported from `src/utils/raw-frontmatter.ts`):
  - `export const TAG_RE: RegExp` (existing const, now exported)
  - `export function normalizeTag(raw: string): string`
  - `export function parseTagsFromFm(content: string): string[]` — raw strings from the frontmatter `tags:` list, no validation
  - `list-tags` rule behavior: entries are normalized, deduped, invalid ones dropped with a warning; a normalization rewrite also warns.

- [ ] **Step 1: Write the failing test**

Create `eval/tag-registry/run.ts`:

```ts
// Keyless deterministic self-check for tag standardization utilities.
// Run: npx tsx eval/tag-registry/run.ts
import {
  normalizeTag,
  parseTagsFromFm,
  TAG_RE,
  validateAndRepairSourceFrontmatter,
} from "../../src/utils/raw-frontmatter";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`FAIL: ${name}`);
  }
}

// --- normalizeTag ---
check("strips # and lowercases, spaces to dashes",
  normalizeTag("#Category/Sub Topic") === "category/sub-topic");
check("trims and converts backslash to slash",
  normalizeTag("  Topic\\AI  ") === "topic/ai");
check("valid tag is unchanged",
  normalizeTag("devops/ci-cd") === "devops/ci-cd");
check("normalized output passes TAG_RE",
  TAG_RE.test(normalizeTag("#DevOps/CI CD")));

// --- parseTagsFromFm ---
const doc = `---\ntags:\n  - "#DevOps/CI CD"\n  - valid/tag\n---\n# Body\n`;
check("parseTagsFromFm returns raw strings",
  JSON.stringify(parseTagsFromFm(doc)) === JSON.stringify(["#DevOps/CI CD", "valid/tag"]));
check("parseTagsFromFm without frontmatter returns []",
  parseTagsFromFm("# no fm").length === 0);

// --- list-tags normalization inside validateAndRepairSourceFrontmatter ---
const src = `---\ntags:\n  - "#DevOps/CI CD"\n  - valid/tag\n  - "%%%"\n  - Ai\n  - ai\n---\nbody\n`;
const { content: repaired, warnings } = validateAndRepairSourceFrontmatter(src);
const repairedTags = parseTagsFromFm(repaired);
check("near-valid tag salvaged",
  repairedTags.includes("devops/ci-cd"));
check("valid tag kept",
  repairedTags.includes("valid/tag"));
check("hopeless tag dropped",
  !repairedTags.some((t) => t.includes("%")));
check("duplicates after normalization are deduped",
  repairedTags.filter((t) => t === "ai").length === 1);
check("normalization warning emitted",
  warnings.some((w) => w.includes("normalized")));
check("removal warning emitted",
  warnings.some((w) => w.includes("invalid entry") && w.includes("%%%")));

console.log(failed === 0 ? `OK — ${passed} passed, 0 failed` : `${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx eval/tag-registry/run.ts`
Expected: FAIL to start — TypeScript/ESM error: `raw-frontmatter` has no export `normalizeTag` / `parseTagsFromFm` / `TAG_RE`.

- [ ] **Step 3: Implement in `src/utils/raw-frontmatter.ts`**

3a. Export `TAG_RE` (line 9):

```ts
export const TAG_RE = /^[a-z][a-z0-9-]*(?:[/_][a-z0-9-]+)*$/;
```

3b. Add `normalizeTag` and `parseTagsFromFm` right after the `FM_KEY_LINE` const (line 11):

```ts
/**
 * Salvage a near-valid tag before TAG_RE validation instead of dropping it:
 * `#Category/Sub Topic` → `category/sub-topic`. Output is NOT guaranteed to
 * pass TAG_RE — callers must still validate.
 */
export function normalizeTag(raw: string): string {
  return raw
    .trim()
    .replace(/^#+/, "")
    .replace(/\\/g, "/")
    .toLowerCase()
    .replace(/\s+/g, "-");
}

/** Raw string entries of the frontmatter `tags:` list — no normalization or validation. */
export function parseTagsFromFm(content: string): string[] {
  const fmMatch = FM_RE.exec(content);
  if (!fmMatch) return [];
  let parsed: Record<string, unknown>;
  try {
    parsed = (yamlParse(fmMatch[1]) as Record<string, unknown>) ?? {};
  } catch {
    return [];
  }
  const tags = parsed["tags"];
  if (!Array.isArray(tags)) return [];
  return (tags as unknown[]).filter((t): t is string => typeof t === "string");
}
```

3c. Split `"list-tags"` out of the shared `case "list-wikilinks": case "list-urls": case "list-tags":` branch (lines 144–175). The shared branch keeps only wikilinks/urls:

```ts
      case "list-wikilinks":
      case "list-urls": {
        if (!Array.isArray(val)) {
          warnings.push(`${rule.field}: expected list, got scalar — removed`);
          delete parsed[rule.field];
          modified = true;
          break;
        }
        const predicate =
          rule.kind === "list-wikilinks"
            ? (v: string) => WIKILINK_RE.test(v)
            : (v: string) => URL_RE.test(v);
        const filtered = (val as unknown[]).filter((v) => {
          if (typeof v !== "string" || !predicate(v)) {
            warnings.push(`${rule.field}: invalid entry "${v}" — removed`);
            return false;
          }
          return true;
        });
        if (filtered.length < (val as unknown[]).length) {
          modified = true;
          if (filtered.length === 0) {
            delete parsed[rule.field];
          } else {
            parsed[rule.field] = filtered;
          }
        }
        break;
      }
      case "list-tags": {
        if (!Array.isArray(val)) {
          warnings.push(`${rule.field}: expected list, got scalar — removed`);
          delete parsed[rule.field];
          modified = true;
          break;
        }
        const kept: string[] = [];
        let changed = false;
        for (const v of val as unknown[]) {
          if (typeof v !== "string") {
            warnings.push(`${rule.field}: invalid entry "${v}" — removed`);
            changed = true;
            continue;
          }
          const norm = normalizeTag(v);
          if (!TAG_RE.test(norm)) {
            warnings.push(`${rule.field}: invalid entry "${v}" — removed`);
            changed = true;
            continue;
          }
          if (norm !== v) {
            warnings.push(`${rule.field}: normalized "${v}" → "${norm}"`);
            changed = true;
          }
          if (kept.includes(norm)) {
            changed = true;
          } else {
            kept.push(norm);
          }
        }
        if (changed) {
          modified = true;
          if (kept.length === 0) {
            delete parsed[rule.field];
          } else {
            parsed[rule.field] = kept;
          }
        }
        break;
      }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx eval/tag-registry/run.ts`
Expected: `OK — 12 passed, 0 failed`

- [ ] **Step 5: Typecheck, lint, build**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: all pass, no new warnings.

- [ ] **Step 6: Commit**

```bash
git add src/utils/raw-frontmatter.ts eval/tag-registry/run.ts
git commit -m "feat(tags): normalize near-valid tags before TAG_RE validation"
```

---

### Task 2: Tag registry module + `max_tag_categories` on DomainEntry

**Files:**
- Create: `src/utils/tag-registry.ts`
- Modify: `src/domain.ts` (DomainEntry, lines 12–23)
- Modify: `eval/tag-registry/run.ts` (extend with registry tests)

**Interfaces:**
- Consumes: `normalizeTag`, `parseTagsFromFm`, `TAG_RE` from `src/utils/raw-frontmatter.ts` (Task 1); `DomainEntry` from `src/domain.ts`.
- Produces (all exported from `src/utils/tag-registry.ts`):
  - `export const DEFAULT_MAX_TAG_CATEGORIES = 12`
  - `export interface TagVault { listFiles(dir: string): Promise<string[]>; readAll(paths: string[]): Promise<Map<string, string>>; toVaultPath(absolutePath: string): string | null }` — structurally satisfied by `VaultTools`
  - `export interface TagRegistry { categories: Map<string, Map<string, number>>; total: number }` — top-level category → full tag → occurrence count; `total` = distinct valid tags
  - `export async function collectDomainTags(vault: TagVault, wikiFolder: string, sourcePaths: string[]): Promise<TagRegistry>`
  - `export function renderTagRegistryBlock(registry: TagRegistry, entityTypeNames: string[], maxCategories?: number): string` — returns `""` when there is nothing to render
  - `export function thematicCategories(registry: TagRegistry, entityTypeNames: string[]): string[]`
  - `export function ensureEntityTypeTag(content: string, pagePath: string, domain: DomainEntry): { content: string; added: boolean; tag: string | null }`
- Produces on `src/domain.ts`: `max_tag_categories?: number` field on `DomainEntry`.

- [ ] **Step 1: Add `max_tag_categories` to `DomainEntry` in `src/domain.ts`**

After the `pageNameVersion?: number;` line inside `interface DomainEntry`:

```ts
  /** Max distinct thematic (non-entity) top-level tag categories; absent → 12. */
  max_tag_categories?: number;
```

- [ ] **Step 2: Extend `eval/tag-registry/run.ts` with failing registry tests**

Append before the final `console.log` block:

```ts
// --- tag-registry module ---
import {
  collectDomainTags,
  renderTagRegistryBlock,
  thematicCategories,
  ensureEntityTypeTag,
  DEFAULT_MAX_TAG_CATEGORIES,
  type TagVault,
} from "../../src/utils/tag-registry";
import type { DomainEntry } from "../../src/domain";

function memVault(files: Record<string, string>): TagVault {
  return {
    async listFiles(dir: string) {
      const prefix = dir.endsWith("/") ? dir : dir + "/";
      return Object.keys(files).filter((p) => p.startsWith(prefix));
    },
    async readAll(paths: string[]) {
      return new Map(paths.filter((p) => files[p] !== undefined).map((p) => [p, files[p]]));
    },
    toVaultPath(abs: string) {
      return abs.startsWith("/vault/") ? abs.slice("/vault/".length) : null;
    },
  };
}

const page = (tags: string[]) => `---\ntags:\n${tags.map((t) => `  - "${t}"`).join("\n")}\n---\nbody\n`;
const vault = memVault({
  "!Wiki/os/person/wiki_os_linus.md": page(["person", "topic-ai/rag"]),
  "!Wiki/os/_config/_index.md": page(["should-be/skipped"]),
  "notes/os/a.md": page(["topic-ai/rag", "workflow/review", "#Bad Tag"]),
  "notes/os/b.txt": page(["not-markdown"]),
});

const registry = await collectDomainTags(vault, "!Wiki/os", ["notes/os"]);
check("registry counts across wiki + sources",
  registry.categories.get("topic-ai")?.get("topic-ai/rag") === 2);
check("near-valid source tag normalized into registry",
  registry.categories.get("bad-tag") !== undefined);
check("_config files are skipped",
  registry.categories.get("should-be") === undefined);
check("non-md files are skipped",
  registry.categories.get("not-markdown") === undefined);
check("total counts distinct tags",
  registry.total === 4); // person, topic-ai/rag, workflow/review, bad-tag

// --- thematicCategories ---
check("entity categories excluded from thematic",
  JSON.stringify(thematicCategories(registry, ["Person"]).sort()) ===
  JSON.stringify(["bad-tag", "topic-ai", "workflow"]));

// --- renderTagRegistryBlock ---
const block = renderTagRegistryBlock(registry, ["Person"], DEFAULT_MAX_TAG_CATEGORIES);
check("block header present", block.startsWith("EXISTING DOMAIN TAGS"));
check("entity categories line", block.includes("Entity categories: person"));
check("entity category tags listed for reuse", block.includes("person (1)"));
check("thematic count line", block.includes("Thematic categories (3/12 used)"));
check("thematic tags listed with counts", block.includes("topic-ai/rag (2)"));
check("no reuse-only note under the limit", !block.includes("reuse only"));

const fullBlock = renderTagRegistryBlock(registry, ["Person"], 3);
check("reuse-only note at the limit", fullBlock.includes("no new thematic categories allowed, reuse only"));

const emptyBlock = renderTagRegistryBlock({ categories: new Map(), total: 0 }, [], 12);
check("empty registry renders empty string", emptyBlock === "");

// --- ensureEntityTypeTag ---
const domain: DomainEntry = {
  id: "os", name: "OS", wiki_folder: "os",
  entity_types: [{ type: "Person", description: "", extraction_cues: [], wiki_subfolder: "person" }],
};
const noTags = `---\nwiki_status: stub\n---\n# X\n`;
const r1 = ensureEntityTypeTag(noTags, "!Wiki/os/person/wiki_os_x.md", domain);
check("entity tag added when missing", r1.added && r1.tag === "person");
check("added tag lands in frontmatter", parseTagsFromFm(r1.content)[0] === "person");

const hasSubTag = page(["person/architects"]);
const r2 = ensureEntityTypeTag(hasSubTag, "!Wiki/os/person/wiki_os_y.md", domain);
check("prefix tag counts as present", !r2.added);

const r3 = ensureEntityTypeTag(noTags, "!Wiki/os/unknown/wiki_os_z.md", domain);
check("unknown subfolder is a no-op", !r3.added && r3.tag === null);
```

Note: the harness uses top-level `await`, which `tsx` supports.

- [ ] **Step 3: Run test to verify it fails**

Run: `npx tsx eval/tag-registry/run.ts`
Expected: FAIL — module `src/utils/tag-registry` does not exist.

- [ ] **Step 4: Create `src/utils/tag-registry.ts`**

```ts
import { isAbsolute } from "path-browserify";
import { parse as yamlParse, stringify as yamlStringify } from "yaml";
import type { DomainEntry } from "../domain";
import { normalizeTag, parseTagsFromFm, TAG_RE } from "./raw-frontmatter";

/** Default cap on distinct thematic (non-entity) top-level tag categories per domain. */
export const DEFAULT_MAX_TAG_CATEGORIES = 12;

const FM_RE = /^---\n([\s\S]*?)\n---\n?/;

/** Minimal structural slice of VaultTools needed for tag collection (keeps tests headless). */
export interface TagVault {
  listFiles(dir: string): Promise<string[]>;
  readAll(paths: string[]): Promise<Map<string, string>>;
  toVaultPath(absolutePath: string): string | null;
}

export interface TagRegistry {
  /** top-level category → full tag → occurrence count */
  categories: Map<string, Map<string, number>>;
  /** distinct valid tags across the domain */
  total: number;
}

/**
 * Scan frontmatter `tags:` of every .md file in the domain wiki folder and the
 * domain's source paths. Tags are normalized and TAG_RE-validated; invalid
 * entries are excluded. `_config/` files are skipped.
 */
export async function collectDomainTags(
  vault: TagVault,
  wikiFolder: string,
  sourcePaths: string[],
): Promise<TagRegistry> {
  const dirs = [wikiFolder];
  for (const sp of sourcePaths) {
    const vaultPath = isAbsolute(sp)
      ? vault.toVaultPath(sp) ?? ""
      : (sp.endsWith("/") ? sp.slice(0, -1) : sp);
    if (vaultPath) dirs.push(vaultPath);
  }
  const files: string[] = [];
  for (const dir of dirs) {
    const listed = await vault.listFiles(dir).catch(() => [] as string[]);
    for (const f of listed) {
      if (f.endsWith(".md") && !f.includes("/_config/")) files.push(f);
    }
  }
  const contents = await vault.readAll(files);
  const categories = new Map<string, Map<string, number>>();
  let total = 0;
  for (const content of contents.values()) {
    for (const raw of parseTagsFromFm(content)) {
      const tag = normalizeTag(raw);
      if (!TAG_RE.test(tag)) continue;
      const cat = tag.split("/")[0];
      let m = categories.get(cat);
      if (!m) {
        m = new Map();
        categories.set(cat, m);
      }
      if (!m.has(tag)) total++;
      m.set(tag, (m.get(tag) ?? 0) + 1);
    }
  }
  return { categories, total };
}

/** Top-level categories in the registry that are not entity-type categories. */
export function thematicCategories(registry: TagRegistry, entityTypeNames: string[]): string[] {
  const entitySet = new Set(entityTypeNames.map((t) => normalizeTag(t)));
  return [...registry.categories.keys()].filter((c) => !entitySet.has(c));
}

/**
 * Render the EXISTING DOMAIN TAGS prompt block. The FULL registry is rendered —
 * no truncation (the vocabulary itself is bounded, not the prompt). Returns ""
 * when there are no entity types and no collected tags.
 */
export function renderTagRegistryBlock(
  registry: TagRegistry,
  entityTypeNames: string[],
  maxCategories: number = DEFAULT_MAX_TAG_CATEGORIES,
): string {
  const entityCats = [
    ...new Set(entityTypeNames.map((t) => normalizeTag(t)).filter((t) => TAG_RE.test(t))),
  ];
  const entitySet = new Set(entityCats);
  const thematic = [...registry.categories.keys()].filter((c) => !entitySet.has(c)).sort();
  if (entityCats.length === 0 && thematic.length === 0) return "";

  const tagLine = (cat: string): string => {
    const tags = [...registry.categories.get(cat)!.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([t, n]) => `${t} (${n})`);
    return `- ${cat}: ${tags.join(", ")}`;
  };

  const lines: string[] = ["EXISTING DOMAIN TAGS (reuse these; do not invent near-duplicates):"];
  if (entityCats.length > 0) {
    lines.push(`Entity categories: ${entityCats.join(", ")}`);
    for (const cat of entityCats) {
      if (registry.categories.has(cat)) lines.push(tagLine(cat));
    }
  }
  const full = thematic.length >= maxCategories;
  lines.push(
    `Thematic categories (${thematic.length}/${maxCategories} used${full ? " — no new thematic categories allowed, reuse only" : ""}):`,
  );
  if (thematic.length === 0) {
    lines.push("- (none yet)");
  } else {
    for (const cat of thematic) lines.push(tagLine(cat));
  }
  return lines.join("\n");
}

/**
 * Deterministic entity-tag sync: derive the page's entity type from its wiki
 * subfolder (second-to-last path segment) and prepend the normalized type as a
 * tag when neither the tag itself nor any `tag/...` descendant is present.
 */
export function ensureEntityTypeTag(
  content: string,
  pagePath: string,
  domain: DomainEntry,
): { content: string; added: boolean; tag: string | null } {
  const segments = pagePath.split("/");
  if (segments.length < 2) return { content, added: false, tag: null };
  const subfolder = segments[segments.length - 2];
  const et = domain.entity_types?.find((e) => e.wiki_subfolder === subfolder);
  if (!et) return { content, added: false, tag: null };
  const tag = normalizeTag(et.type);
  if (!TAG_RE.test(tag)) return { content, added: false, tag: null };

  const fmMatch = FM_RE.exec(content);
  if (!fmMatch) return { content, added: false, tag };
  let parsed: Record<string, unknown>;
  try {
    parsed = (yamlParse(fmMatch[1]) as Record<string, unknown>) ?? {};
  } catch {
    return { content, added: false, tag };
  }
  const existing = Array.isArray(parsed.tags)
    ? (parsed.tags as unknown[]).filter((t): t is string => typeof t === "string")
    : [];
  if (existing.some((t) => t === tag || t.startsWith(`${tag}/`))) {
    return { content, added: false, tag };
  }
  parsed.tags = [tag, ...existing];
  const body = content.slice(fmMatch[0].length);
  return { content: `---\n${yamlStringify(parsed)}---\n${body}`, added: true, tag };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx tsx eval/tag-registry/run.ts`
Expected: `OK — 30 passed, 0 failed`

- [ ] **Step 6: Typecheck, lint, build**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/utils/tag-registry.ts src/domain.ts eval/tag-registry/run.ts
git commit -m "feat(tags): domain tag registry module and max_tag_categories config"
```

---

### Task 3: Ingest integration — registry block, entity-tag sync, limit warning

**Files:**
- Modify: `src/phases/ingest.ts` (imports; registry collection after line 209; `buildIngestMessages` signature at lines 761–776 and call at lines 232–236; write loop at lines 439–460; post-loop before the delete loop at line 487)
- Modify: `prompts/ingest.md` (line 21)

**Interfaces:**
- Consumes: `collectDomainTags`, `renderTagRegistryBlock`, `thematicCategories`, `ensureEntityTypeTag`, `DEFAULT_MAX_TAG_CATEGORIES` from `src/utils/tag-registry.ts` (Task 2); `parseTagsFromFm`, `normalizeTag` from `src/utils/raw-frontmatter.ts` (Task 1).
- Produces: `buildIngestMessages(..., tagRegistryBlock: string = "")` — new trailing parameter; the `EXISTING DOMAIN TAGS` block in the ingest user message; `info_text` events `Entity tag added: <path>` and `Tag category limit exceeded: N/M thematic categories`.

- [ ] **Step 1: Add imports to `src/phases/ingest.ts`**

Extend the existing `raw-frontmatter` import (line 19) with `parseTagsFromFm` and `normalizeTag`, and add below it:

```ts
import { collectDomainTags, renderTagRegistryBlock, thematicCategories, ensureEntityTypeTag, DEFAULT_MAX_TAG_CATEGORIES } from "../utils/tag-registry";
```

- [ ] **Step 2: Collect the registry in `runIngest`**

After `const sourceStems = await collectSourceStems(domain, vaultTools, vaultRoot);` (line 209) add:

```ts
  const tagRegistry = await collectDomainTags(vaultTools, wikiVaultPath, domain.source_paths ?? []);
  const entityTypeNames = (domain.entity_types ?? []).map((e) => e.type);
  const maxTagCategories = domain.max_tag_categories ?? DEFAULT_MAX_TAG_CATEGORIES;
  const tagRegistryBlock = renderTagRegistryBlock(tagRegistry, entityTypeNames, maxTagCategories);
  const writtenTagCats = new Set<string>();
```

- [ ] **Step 3: Thread the block into `buildIngestMessages`**

3a. Signature (line 770): after `sourceStems: Set<string> = new Set(),` add:

```ts
  tagRegistryBlock: string = "",
```

3b. In the returned user message content array, after the `` `Existing wiki pages:\n${existing}`, `` element add:

```ts
        tagRegistryBlock ? `\n${tagRegistryBlock}` : "",
```

3c. Call site (line 232):

```ts
  const messages = buildIngestMessages(
    sourceVaultPath, sourceContent, domain, wikiVaultPath,
    existingPages, schemaContent, indexContent,
    entitiesResult.value.entities, sourceStems, tagRegistryBlock,
  );
```

- [ ] **Step 4: Entity-tag sync in the page write loop**

Replace (lines 450–451):

```ts
    const sourceStem = sourceVaultPath.split("/").pop()!.replace(/\.md$/, "");
    const { content: sourcedPage, injected } = ensureWikiSources(repairedPage, sourceStem);
```

with:

```ts
    const { content: entityTagged, added: entityTagAdded, tag: entityTag } =
      ensureEntityTypeTag(repairedPage, page.path, domain);
    if (entityTagAdded) {
      yield {
        kind: "info_text",
        icon: "🏷️",
        summary: `Entity tag added: ${page.path}`,
        details: [`tags: + ${entityTag} (derived from wiki_subfolder)`],
      };
    }
    const sourceStem = sourceVaultPath.split("/").pop()!.replace(/\.md$/, "");
    const { content: sourcedPage, injected } = ensureWikiSources(entityTagged, sourceStem);
```

- [ ] **Step 5: Track written categories and warn once per run**

5a. Inside the write loop, right after `written.push(page.path);` add:

```ts
      for (const t of parseTagsFromFm(sourcedPage)) writtenTagCats.add(t.split("/")[0]);
```

5b. Immediately BEFORE the `// === Delete loop (merge cleanup) ===...` comment (line 487) add the once-per-run soft check (this pins spec finding F-001: counted once, after all page writes, as pre-run registry ∪ this run's written tags):

```ts
  // Soft category-limit check: warn once per run; tags are never dropped for limit reasons.
  const entityCatSet = new Set(entityTypeNames.map((t) => normalizeTag(t)));
  const thematicAfter = new Set(thematicCategories(tagRegistry, entityTypeNames));
  for (const cat of writtenTagCats) {
    if (!entityCatSet.has(cat)) thematicAfter.add(cat);
  }
  if (thematicAfter.size > maxTagCategories) {
    yield {
      kind: "info_text",
      icon: "⚠️",
      summary: `Tag category limit exceeded: ${thematicAfter.size}/${maxTagCategories} thematic categories`,
      details: [...thematicAfter].sort(),
    };
  }
```

- [ ] **Step 6: Rewrite the tags rule in `prompts/ingest.md`**

Replace line 21:

```
- tags: hierarchical tags (category/subcategory). Reuse tags from existing wiki pages (provided in the context). Create new ones following the same scheme if needed. Format: lowercase, separated by `/`, no spaces, no `#`
```

with:

```
- tags: hierarchical tags (category/subcategory). Format: lowercase, separated by `/`, no spaces, no `#`. Pick tags in this order:
  1. The page's entity-type tag — the normalized type of this entity (e.g. `person`). Always include it when the entity type is known.
  2. Thematic tags reused from the EXISTING DOMAIN TAGS block (provided in the context). Do not invent near-duplicates of listed tags.
  3. A new thematic tag ONLY when nothing in the block fits. Never start a new top-level category when the block says "reuse only".
```

- [ ] **Step 7: Verify**

Run: `npx tsx eval/tag-registry/run.ts && npx tsc --noEmit && npm run lint && npm run build`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add src/phases/ingest.ts prompts/ingest.md
git commit -m "feat(ingest): inject domain tag registry, sync entity tags, soft category limit"
```

---

### Task 4: Format integration — resolved domain + registry block

**Files:**
- Modify: `src/phases/ingest.ts` (`detectDomain` at lines 626–635 → add strict variant)
- Modify: `src/agent-runner.ts` (imports; format case at lines 135–151)
- Modify: `src/phases/format.ts` (imports; `runFormat` signature at lines 80–95; `userInitial` at line 185)
- Modify: `templates/_format_schema.md` (line 7, the `tags` row)

**Interfaces:**
- Consumes: `collectDomainTags`, `renderTagRegistryBlock`, `DEFAULT_MAX_TAG_CATEGORIES` (Task 2); `domainWikiFolder` from `src/wiki-path.ts`; `DomainEntry` from `src/domain.ts`.
- Produces: `export function detectDomainStrict(absFilePath: string, domains: DomainEntry[], vaultRoot: string): DomainEntry | null` in `src/phases/ingest.ts` (no first-domain fallback); `runFormat(..., formatDomain?: DomainEntry)` — new trailing parameter.

- [ ] **Step 1: Add `detectDomainStrict` in `src/phases/ingest.ts`**

Replace `detectDomain` (lines 626–635) with:

```ts
/** Match a file to a domain by source_paths prefix; null when nothing matches (no fallback). */
export function detectDomainStrict(absFilePath: string, domains: DomainEntry[], vaultRoot: string): DomainEntry | null {
  for (const d of domains) {
    const matched = d.source_paths?.some((sp) => {
      const abs = isAbsolute(sp) ? sp : join(vaultRoot, sp);
      return absFilePath.startsWith(abs);
    });
    if (matched) return d;
  }
  return null;
}

export function detectDomain(absFilePath: string, domains: DomainEntry[], vaultRoot: string): DomainEntry | null {
  return detectDomainStrict(absFilePath, domains, vaultRoot) ?? domains[0] ?? null;
}
```

- [ ] **Step 2: Resolve the domain in `src/agent-runner.ts`**

2a. Imports: change line 2 to also import the strict detector, and add `join`:

```ts
import { runIngest, detectDomainStrict } from "./phases/ingest";
import { join } from "path-browserify";
```

2b. In the `case "format":` block (lines 135–151), replace:

```ts
        const formatDomain = req.domainId ? this.domains.find((d) => d.id === req.domainId) : undefined;
        const wikiVaultPath = formatDomain ? domainWikiFolder(formatDomain.wiki_folder) : undefined;
        const noVision = req.args.includes("--no-vision");
        const formatArgs = req.args.filter((a) => a !== "--no-vision");
```

with:

```ts
        const noVision = req.args.includes("--no-vision");
        const formatArgs = req.args.filter((a) => a !== "--no-vision");
        const explicitDomain = req.domainId ? this.domains.find((d) => d.id === req.domainId) : undefined;
        const formatDomain =
          explicitDomain ??
          (formatArgs[0]
            ? detectDomainStrict(join(vaultRoot, formatArgs[0]), this.domains, vaultRoot) ?? undefined
            : undefined);
        const wikiVaultPath = formatDomain ? domainWikiFolder(formatDomain.wiki_folder) : undefined;
```

2c. Pass the domain as the new trailing argument of the `runFormat` call (line 149): append `, formatDomain` after `progress`.

- [ ] **Step 3: Accept the domain and inject the block in `src/phases/format.ts`**

3a. Imports — add:

```ts
import type { DomainEntry } from "../domain";
import { collectDomainTags, renderTagRegistryBlock, DEFAULT_MAX_TAG_CATEGORIES } from "../utils/tag-registry";
import { domainWikiFolder } from "../wiki-path";
```

3b. Signature — after `progress: FormatProgress = enFormatProgressFallback,` add:

```ts
  formatDomain?: DomainEntry,
```

3c. Before the `const userInitial = ...` line (185) add:

```ts
  let tagRegistryBlock = "";
  if (formatDomain) {
    try {
      const registry = await collectDomainTags(
        vaultTools,
        domainWikiFolder(formatDomain.wiki_folder),
        formatDomain.source_paths ?? [],
      );
      tagRegistryBlock = renderTagRegistryBlock(
        registry,
        (formatDomain.entity_types ?? []).map((e) => e.type),
        formatDomain.max_tag_categories ?? DEFAULT_MAX_TAG_CATEGORIES,
      );
    } catch {
      /* no registry — format degrades to current behavior */
    }
  }
```

3d. Replace the `userInitial` line:

```ts
  const userInitial = `Source file: ${filePath}\n---\n${original}${visionBlock}`;
```

with:

```ts
  const userInitial = `Source file: ${filePath}\n---\n${original}${visionBlock}${tagRegistryBlock ? `\n---\n${tagRegistryBlock}` : ""}`;
```

- [ ] **Step 4: Update the `tags` row in `templates/_format_schema.md`**

Replace line 7:

```
| `tags` | YAML list: `[category/subcategory, domain/topic]`. Hierarchy via `/`, lowercase, no spaces, no `#`. Reuse tags from existing pages; create new ones following the same scheme. Only when a thematic classification exists. |
```

with:

```
| `tags` | YAML list: `[category/subcategory, domain/topic]`. Hierarchy via `/`, lowercase, no spaces, no `#`. When the input contains an EXISTING DOMAIN TAGS block, reuse tags strictly from it; add a new tag only when nothing there fits, and never start a new top-level category when the block says "reuse only". Without the block, keep the note's own valid tags. Only when a thematic classification exists. |
```

- [ ] **Step 5: Verify**

Run: `npx tsx eval/tag-registry/run.ts && npx tsc --noEmit && npm run lint && npm run build`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/phases/ingest.ts src/agent-runner.ts src/phases/format.ts templates/_format_schema.md
git commit -m "feat(format): resolve domain and inject tag registry block into format context"
```

---

### Task 5: Documentation — README (en/ru) + iwiki

**Files:**
- Modify: `README.md` (feature table, lines 23 and 29)
- Modify: `docs/README.ru.md` (feature table, lines 23 and 29)
- iwiki: new page `tagging` in domain `obsidian-ai-wiki` (via `wiki_write_page`)

**Interfaces:**
- Consumes: shipped behavior from Tasks 1–4.
- Produces: user-facing docs matching the new behavior.

- [ ] **Step 1: Update `README.md` feature rows**

Ingest row — replace:

```
| **Ingest** | Reads an open note, extracts key topics (people, tools, processes, terms), creates or updates wiki pages |
```

with:

```
| **Ingest** | Reads an open note, extracts key topics (people, tools, processes, terms), creates or updates wiki pages. Tags are standardized: pages reuse the domain's existing tag vocabulary, carry their entity-type tag, and the set of thematic tag categories is bounded per domain |
```

Format row — replace:

```
| **Format** | Cleans up any open markdown note (outside the wiki): headings, tables, frontmatter, image captions. Shows a preview before applying. Invariant: never adds or removes facts — only improves clarity |
```

with:

```
| **Format** | Cleans up any open markdown note (outside the wiki): headings, tables, frontmatter, image captions. Shows a preview before applying. Invariant: never adds or removes facts — only improves clarity. When the note belongs to a configured domain, tags are reused from that domain's existing tag vocabulary |
```

- [ ] **Step 2: Update `docs/README.ru.md` feature rows (same content, Russian)**

Ingest row (line 23) — replace:

```
| **Ingest** | Читает открытую заметку, извлекает ключевые темы (люди, инструменты, процессы, термины), создаёт или обновляет страницы вики |
```

with:

```
| **Ingest** | Читает открытую заметку, извлекает ключевые темы (люди, инструменты, процессы, термины), создаёт или обновляет страницы вики. Теги стандартизированы: страницы переиспользуют существующий словарь тегов домена, несут тег своего типа сущности, а число тематических категорий тегов ограничено настройкой домена |
```

Format row (line 29) — replace:

```
| **Format** | Улучшает форматирование любой открытой заметки (вне вики): заголовки, таблицы, frontmatter, подписи к изображениям. Показывает предпросмотр перед применением. Инвариант: факты не добавляются и не удаляются — только улучшается ясность изложения |
```

with:

```
| **Format** | Улучшает форматирование любой открытой заметки (вне вики): заголовки, таблицы, frontmatter, подписи к изображениям. Показывает предпросмотр перед применением. Инвариант: факты не добавляются и не удаляются — только улучшается ясность изложения. Если заметка принадлежит настроенному домену, теги переиспользуются из существующего словаря тегов этого домена |
```

- [ ] **Step 3: Write the iwiki page**

Call `wiki_write_page(domain="obsidian-ai-wiki", slug="tagging", source="src/utils/tag-registry.ts")` with this markdown:

```markdown
# Tagging

## Overview

Tags follow one standard across the plugin: lowercase, `category/subcategory`
hierarchy via `/`, validated by `TAG_RE` in `src/utils/raw-frontmatter.ts`.
Near-valid tags (`#Category/Sub Topic`) are normalized by `normalizeTag`
(strip `#`, lowercase, spaces→`-`, `\`→`/`) before validation instead of being
dropped.

## Domain tag registry

`src/utils/tag-registry.ts` scans frontmatter `tags:` of the domain's wiki
pages and source notes (`collectDomainTags`) and renders an
`EXISTING DOMAIN TAGS` prompt block (`renderTagRegistryBlock`). The FULL
registry is rendered — the vocabulary is bounded, not the prompt.

Categories are of two kinds:
- **Entity categories** — the domain's `entity_types` type names; not counted
  against the limit. Ingest deterministically adds the page's entity-type tag
  (derived from its `wiki_subfolder`) via `ensureEntityTypeTag`.
- **Thematic categories** — bounded by `DomainEntry.max_tag_categories`
  (default 12, `DEFAULT_MAX_TAG_CATEGORIES`). Enforcement is soft: exceeding
  the limit emits a warning event once per ingest run; tags are never dropped
  for limit reasons.

## Integration points

- **Ingest** (`src/phases/ingest.ts`): registry collected after domain
  detection; block injected into `buildIngestMessages`; entity-tag sync and
  the once-per-run category-limit check happen in post-processing. Prompt
  rule: `prompts/ingest.md` (entity tag → reuse → bounded new).
- **Format** (`src/phases/format.ts`): `agent-runner.ts` resolves the domain
  (explicit `domainId`, else `detectDomainStrict` by file path — no
  first-domain fallback) and passes it to `runFormat`, which injects the same
  block into the user message. No resolvable domain → no block, behavior
  unchanged. Prompt rule: `templates/_format_schema.md`.

## Related

- [[overview]] — commands and code layout.
```

- [ ] **Step 4: Verify docs and wiki health**

Run `wiki_lint` for the `obsidian-ai-wiki` domain — no broken refs, no orphan pages (the `[[overview]]` link must resolve).

- [ ] **Step 5: Commit**

```bash
git add README.md docs/README.ru.md
git commit -m "docs: document standardized tagging and domain tag reuse"
```

---

## Final verification (after all tasks)

- `npx tsx eval/tag-registry/run.ts` → `OK — 30 passed, 0 failed`
- `npx tsc --noEmit && npm run lint && npm run build` → clean
- Manual smoke (SC-2/SC-3/SC-4 from the spec, in a dev vault):
  - ingest a note into a domain with existing tags → new pages reuse registry tags, each page carries its entity-type tag;
  - format a note inside a domain → the `EXISTING DOMAIN TAGS` block is visible in the request log, the note's valid tags survive;
  - a source tag `#Category/Sub Topic` survives formatting as `category/sub-topic`.
