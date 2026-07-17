import type OpenAI from "openai";
import { contentHash } from "../content-hash";
import { estimatePreparedMessages } from "../prompt-budget";
import {
  applyPagePatch,
  inspectPatchablePage,
  normalizeSectionHeading,
  type PatchPage,
  type ReplaceSectionAuthority,
} from "../section-patches";

const DEFAULT_LINT_ITEM_BUDGET = 12_000;
const PAGE_HEADING = "## Full page";

export interface LintWorkItem {
  id: string;
  path: string;
  heading: string;
  markdown: string;
  sectionHash: string;
  expectedPageHash: string;
}

export interface LintFinding {
  path: string;
  heading: string;
  rule: string;
  severity: "info" | "warning" | "error";
  text: string;
  repairInstruction: string;
}

export interface LintBatchOutput {
  coveredWorkIds: string[];
  findings: LintFinding[];
  patches: PatchPage[];
  deletes: Array<{ path: string; redirect_to?: string }>;
}

export interface LintRelatedSection {
  path: string;
  heading: string;
  markdown: string;
  sectionHash?: string;
  expectedPageHash?: string;
}

export interface BuildLintBatchMessagesArgs {
  domainName: string;
  schema: string;
  workItems: readonly LintWorkItem[];
  relatedSections: readonly LintRelatedSection[];
}

interface H2Section {
  heading: string;
  markdown: string;
  ordinal: number;
  hash: string;
}

function estimateText(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

function idPart(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function splitLines(markdown: string): string[] {
  return markdown.replace(/\r\n|\r/g, "\n").split("\n");
}

function h1Heading(markdown: string): string {
  return markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? "page";
}

function h2Sections(markdown: string): H2Section[] {
  const inspected = inspectPatchablePage(markdown);
  if (inspected.sections.length === 0) {
    return [{
      heading: PAGE_HEADING,
      markdown,
      ordinal: 0,
      hash: contentHash(markdown),
    }];
  }
  return inspected.sections.map((section) => ({
    heading: section.heading,
    markdown: section.span,
    ordinal: section.ordinal,
    hash: section.hash,
  }));
}

function windowSection(path: string, section: H2Section, itemBudget: number): LintWorkItem[] {
  const lines = splitLines(section.markdown);
  const heading = lines[0] ?? section.heading;
  const body = lines.slice(1);
  const items: LintWorkItem[] = [];
  let start = 0;
  while (start < body.length || (body.length === 0 && items.length === 0)) {
    const chunk: string[] = [];
    let end = start;
    while (end < body.length) {
      const candidate = [heading, ...chunk, body[end]].join("\n");
      if (chunk.length > 0 && estimateText(candidate) > itemBudget) break;
      chunk.push(body[end]);
      end++;
      if (estimateText(candidate) >= itemBudget) break;
    }
    if (chunk.length === 0 && end < body.length) {
      chunk.push(body[end]);
      end++;
    }
    const lineStart = start + 1;
    const lineEnd = Math.max(lineStart, end);
    const markdown = [heading, ...chunk].join("\n").trimEnd();
    items.push({
      id: `${path}\u0000${idPart(section.heading)}\u0000lines:${lineStart}-${lineEnd}`,
      path,
      heading: section.heading,
      markdown,
      sectionHash: section.hash,
      expectedPageHash: "",
    });
    start = end;
    if (body.length === 0) break;
  }
  return items;
}

export function buildLintWorkItems(
  pages: ReadonlyMap<string, string>,
  itemBudget: number = DEFAULT_LINT_ITEM_BUDGET,
): LintWorkItem[] {
  if (!Number.isFinite(itemBudget) || itemBudget <= 0) {
    throw new RangeError("itemBudget must be positive");
  }
  const effectiveBudget = Math.max(120, Math.floor(itemBudget * 0.25));
  const items: LintWorkItem[] = [];
  for (const [path, markdown] of [...pages.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const pageHeading = `# ${h1Heading(markdown)}`;
    const expectedPageHash = contentHash(markdown);
    if (estimateText(markdown) <= effectiveBudget) {
      items.push({
        id: `${path}\u0000page`,
        path,
        heading: pageHeading,
        markdown,
        sectionHash: contentHash(markdown),
        expectedPageHash,
      });
      continue;
    }
    for (const section of h2Sections(markdown)) {
      if (estimateText(section.markdown) <= effectiveBudget) {
        items.push({
          id: `${path}\u0000${idPart(section.heading)}\u0000${section.ordinal}`,
          path,
          heading: section.heading,
          markdown: section.markdown,
          sectionHash: section.hash,
          expectedPageHash,
        });
      } else {
        items.push(...windowSection(path, section, effectiveBudget).map((item) => ({
          ...item,
          expectedPageHash,
        })));
      }
    }
  }
  return items;
}

function lexicalOverlap(left: string, right: string): number {
  const rightWords = new Set(right.toLowerCase().split(/[^\p{L}\p{N}_-]+/u).filter((word) => word.length >= 3));
  let score = 0;
  for (const word of left.toLowerCase().split(/[^\p{L}\p{N}_-]+/u)) {
    if (word.length >= 3 && rightWords.has(word)) score++;
  }
  return score;
}

export function buildLintRelatedSections(
  allItems: readonly LintWorkItem[],
  submittedItems: readonly LintWorkItem[],
  _pages: ReadonlyMap<string, string>,
  budget: number,
): LintRelatedSection[] {
  if (budget <= 0) return [];
  const submittedIds = new Set(submittedItems.map((item) => item.id));
  const submittedText = submittedItems.map((item) => `${item.heading}\n${item.markdown}`).join("\n\n");
  const candidates = allItems
    .filter((item) => !submittedIds.has(item.id))
    .map((item) => ({
      item,
      score: lexicalOverlap(submittedText, `${item.heading}\n${item.markdown}`),
    }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.item.path.localeCompare(b.item.path) || a.item.id.localeCompare(b.item.id));

  const selected: LintRelatedSection[] = [];
  for (const { item } of candidates) {
    const candidate = [
      ...selected,
      {
        path: item.path,
        heading: item.heading,
        markdown: item.markdown,
        sectionHash: item.sectionHash,
        expectedPageHash: item.expectedPageHash,
      },
    ];
    if (estimateText(JSON.stringify(candidate)) > budget) continue;
    selected.push(candidate[candidate.length - 1]);
  }
  return selected;
}

export function validateLintCoverage(
  pages: ReadonlyMap<string, string>,
  items: readonly LintWorkItem[],
): void {
  const byPath = new Map<string, LintWorkItem[]>();
  const ids = new Set<string>();
  for (const item of items) {
    if (ids.has(item.id)) throw new Error(`duplicate lint work id: ${item.id}`);
    ids.add(item.id);
    if (!pages.has(item.path)) throw new Error(`lint work item references unknown page: ${item.path}`);
    const list = byPath.get(item.path) ?? [];
    list.push(item);
    byPath.set(item.path, list);
  }

  for (const [path, markdown] of pages) {
    const pathItems = byPath.get(path) ?? [];
    if (pathItems.length === 0) throw new Error(`missing lint work for ${path}`);
    if (pathItems.some((item) => item.id.endsWith("\u0000page"))) continue;
    const coveredHeadings = new Set(pathItems.map((item) => normalizeSectionHeading(item.heading)));
    for (const section of h2Sections(markdown)) {
      if (!coveredHeadings.has(normalizeSectionHeading(section.heading))) {
        throw new Error(`missing lint work for ${path} ${section.heading}`);
      }
    }
  }
}

function normalizedFindingPart(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export function lintFindingKey(finding: LintFinding): string {
  return [finding.path, finding.heading, finding.rule, finding.severity, finding.text]
    .map(normalizedFindingPart)
    .join("\u0000");
}

export function mergeLintFindings(groups: readonly (readonly LintFinding[])[]): LintFinding[] {
  const merged = new Map<string, LintFinding>();
  for (const group of groups) {
    for (const finding of group) {
      const key = lintFindingKey(finding);
      if (!merged.has(key)) merged.set(key, finding);
    }
  }
  return [...merged.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, finding]) => finding);
}

function sectionAuthoritiesFor(items: readonly LintWorkItem[], pages: ReadonlyMap<string, string>): ReplaceSectionAuthority[] {
  const byPath = new Map<string, LintWorkItem[]>();
  for (const item of items) {
    const list = byPath.get(item.path) ?? [];
    list.push(item);
    byPath.set(item.path, list);
  }
  const authorities: ReplaceSectionAuthority[] = [];
  for (const [path, pathItems] of byPath) {
    const current = pages.get(path);
    if (current === undefined) continue;
    const inspected = inspectPatchablePage(current);
    const fullPageSubmitted = pathItems.some((item) => item.id.endsWith("\u0000page"));
    for (const section of inspected.sections) {
      if (
        fullPageSubmitted
        || pathItems.some((item) =>
          normalizeSectionHeading(item.heading) === normalizeSectionHeading(section.heading)
          && item.markdown.trim() === section.span.trim()
          && item.sectionHash === section.hash
        )
      ) {
        authorities.push({
          path,
          heading: section.heading,
          sectionOrdinal: section.ordinal,
          sectionHash: section.hash,
          exactSection: section.span,
        });
      }
    }
  }
  return authorities;
}

export function lintReplaceAuthorities(
  items: readonly LintWorkItem[],
  pages: ReadonlyMap<string, string>,
): ReplaceSectionAuthority[] {
  return sectionAuthoritiesFor(items, pages);
}

export function validateLintBatchOutput(
  submittedItems: readonly LintWorkItem[],
  pages: ReadonlyMap<string, string>,
  output: LintBatchOutput,
): void {
  const expected = new Set(submittedItems.map((item) => item.id));
  const seen = new Set<string>();
  for (const id of output.coveredWorkIds) {
    if (seen.has(id)) throw new Error(`duplicate coveredWorkIds entry: ${id}`);
    seen.add(id);
    if (!expected.has(id)) throw new Error(`coveredWorkIds contains non-submitted id: ${id}`);
  }
  const missing = [...expected].filter((id) => !seen.has(id));
  if (missing.length > 0) throw new Error(`missing coveredWorkIds: ${missing.join(", ")}`);

  const submittedPaths = new Set(submittedItems.map((item) => item.path));
  for (const finding of output.findings) {
    if (!submittedPaths.has(finding.path)) throw new Error(`finding target not submitted: ${finding.path}`);
  }
  for (const patch of output.patches) {
    if (!submittedPaths.has(patch.path)) throw new Error(`patch target not submitted: ${patch.path}`);
    const current = pages.get(patch.path);
    if (current === undefined) throw new Error(`patch target missing from pages: ${patch.path}`);
    const authorities = sectionAuthoritiesFor(submittedItems, pages);
    const applied = applyPagePatch(current, patch, authorities);
    if (!applied.ok) {
      const replaceContextMissing = patch.sections.some((section) =>
        section.operation === "replace"
        && submittedItems.some((item) =>
          item.path === patch.path
          && normalizeSectionHeading(item.heading) === normalizeSectionHeading(section.heading)
          && item.sectionHash === section.expectedSectionHash
        )
        && !authorities.some((authority) =>
          authority.path === patch.path
          && normalizeSectionHeading(authority.heading) === normalizeSectionHeading(section.heading)
          && authority.sectionHash === section.expectedSectionHash
        )
      );
      const replaceHashIssue = !replaceContextMissing && patch.sections.some((section) =>
        section.operation === "replace"
        && !submittedItems.some((item) =>
          item.path === patch.path
          && normalizeSectionHeading(item.heading) === normalizeSectionHeading(section.heading)
          && item.sectionHash === section.expectedSectionHash
        )
      );
      throw new Error(replaceContextMissing ? "replace_context_missing" : replaceHashIssue ? "section_hash_mismatch" : applied.reason);
    }
  }
  const deletePaths = new Set<string>();
  for (const del of output.deletes) {
    if (!submittedPaths.has(del.path)) throw new Error(`delete target not submitted: ${del.path}`);
    if (deletePaths.has(del.path)) throw new Error(`duplicate delete target: ${del.path}`);
    deletePaths.add(del.path);
    if (del.redirect_to !== undefined && !submittedPaths.has(del.redirect_to)) {
      throw new Error(`delete redirect target not submitted: ${del.redirect_to}`);
    }
    if (del.redirect_to === del.path) throw new Error(`delete redirect cannot target itself: ${del.path}`);
  }
}

export function buildLintBatchMessages(args: BuildLintBatchMessagesArgs): OpenAI.Chat.ChatCompletionMessageParam[] {
  const workJson = JSON.stringify(args.workItems, null, 2);
  const relatedJson = JSON.stringify(args.relatedSections, null, 2);
  const system = [
    `You are a reviewer and editor of the wiki knowledge base for the domain "${args.domainName}".`,
    "Return strict JSON matching the lint batch schema.",
    "Every submitted work item id must appear exactly once in coveredWorkIds.",
    "Patch and delete targets must be among submitted work item paths only.",
    args.schema ? `Conventions:\n${args.schema}` : "",
  ].filter(Boolean).join("\n\n");
  const user = [
    "Submitted lint work items:",
    workJson,
    "",
    "Optional related sections:",
    relatedJson,
  ].join("\n");
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

export function assertLintBatchFits(messages: OpenAI.Chat.ChatCompletionMessageParam[], budget: number): void {
  const estimated = estimatePreparedMessages(messages);
  if (estimated > budget) throw new Error(`lint batch prompt overflow: ${estimated} > ${budget}`);
}
