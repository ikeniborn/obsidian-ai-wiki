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
