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

const overlapped = await collectDomainTags(vault, "!Wiki/os", ["notes/os", "notes"]);
check("overlapping source paths do not double-count",
  overlapped.categories.get("topic-ai")?.get("topic-ai/rag") === 2);

console.log(failed === 0 ? `OK — ${passed} passed, 0 failed` : `${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
