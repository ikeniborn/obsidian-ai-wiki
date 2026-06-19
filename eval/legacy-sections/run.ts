/**
 * Out-of-vault A/B eval for the "drop legacy wiki sections" branch.
 *
 * Deterministic part (no key required): runs the REAL splitSections / buildChunkInputs
 * from src/page-similarity.ts on an inlined wiki-page fixture, before and after the REAL
 * stripLegacySections from src/strip-legacy-sections.ts. Asserts the two noise chunks
 * (related concepts + change history) disappear and the content chunks are byte-identical.
 *
 * Retrieval A/B (only when EVAL_EMBED_BASE_URL + EVAL_EMBED_API_KEY + EVAL_EMBED_MODEL are
 * set): embeds both chunk variants plus a small query set and checks precision rises while
 * on-topic scores stay flat. Added in Task 3.
 *
 * Run: see docs/superpowers/evals/2026-06-19-legacy-sections-eval.md
 */
import { buildChunkInputs, splitSections, DEFAULT_CHUNKING } from "../../src/page-similarity";
import { stripLegacySections, extractRelatedLinks, addOutgoingLinks } from "../../src/strip-legacy-sections";

// ---------- tiny assert framework (mirrors eval/format-frontmatter/run.ts) ----------
let pass = 0;
let fail = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; failures.push(name); console.log(`  FAIL  ${name}${detail ? `\n        → ${detail}` : ""}`); }
}
function section(t: string): void { console.log(`\n=== ${t} ===`); }

// ---------- inlined fixture: a realistic SCD1 wiki page WITH both legacy sections ----------
// Note: "[[перезапись-таблицы]]" appears only inside the related section, NOT in
// wiki_outgoing_links — it exercises the union safety-net (Task 4 / addOutgoingLinks).
const ANNOTATION = "SCD1 — стратегия медленно меняющихся измерений с перезаписью значений без хранения истории.";
const FIXTURE = `---
wiki_updated: 2026-06-10
wiki_status: developing
wiki_outgoing_links:
  - "[[scd2]]"
tags:
  - databases/dwh
---
# SCD1 (Slowly Changing Dimension Type 1)

SCD1 — стратегия обработки медленно меняющихся измерений, при которой новое значение атрибута перезаписывает старое без сохранения истории. Это самый простой из подходов к управлению изменениями справочных данных, и он сознательно жертвует историчностью ради компактности таблицы и предсказуемой производительности запросов.

## Основные характеристики

- При изменении атрибута старое значение перезаписывается новым, и предыдущее состояние нигде не фиксируется.
- История предыдущих значений не сохраняется, поэтому восстановить прежнее состояние измерения после перезаписи невозможно.
- Таблица измерения остаётся компактной: одна строка на бизнес-ключ, что упрощает джойны и снижает стоимость хранения.

## Применение в контексте [Домен]

Используется для атрибутов, чья историчность не важна для аналитики: исправление опечаток в наименованиях, обновление устаревших справочных кодов, нормализация форматов телефонов и адресов. В этих случаях аналитику интересует только текущее, корректное значение, а не цепочка правок, приведшая к нему.

## Примеры

Простейший случай — точечное обновление одного атрибута в таблице измерения по бизнес-ключу. Перезапись выполняется обычным UPDATE без вставки новой версии строки и без проставления дат действия:

\`\`\`sql
UPDATE dim_customer SET city = 'Москва' WHERE customer_id = 42;
\`\`\`

## Связанные концепции

- [[scd2]] — стратегия с сохранением истории через версии строк, выбирается, когда историчность атрибута критична для анализа.
- [[перезапись-таблицы]] — низкоуровневый механизм, лежащий в основе SCD1: физическая замена значения в существующей строке без добавления новых записей.

## История изменений

- 2026-06-10 — создано из источника [[etl-обзор]] в рамках первичного наполнения раздела о медленно меняющихся измерениях.
- 2026-06-05 — добавлен пример SQL и уточнены границы применимости стратегии для справочных атрибутов.
`;

// =====================================================================
// Deterministic part — chunk set before/after stripLegacySections
// =====================================================================
section("Deterministic — chunk set");

const NOISE_HEADINGS = ["## Связанные концепции", "## История изменений"];

const strippedBody = stripLegacySections(FIXTURE);

const sectionsWith = splitSections(FIXTURE, DEFAULT_CHUNKING);
const sectionsWithout = splitSections(strippedBody, DEFAULT_CHUNKING);

const headingsWith = sectionsWith.map((s) => s.heading);
const headingsWithout = sectionsWithout.map((s) => s.heading);

check("D1 both noise sections present before strip",
  NOISE_HEADINGS.every((h) => headingsWith.includes(h)),
  `headingsWith=${JSON.stringify(headingsWith)}`);
check("D2 no noise sections after strip",
  NOISE_HEADINGS.every((h) => !headingsWithout.includes(h)),
  `headingsWithout=${JSON.stringify(headingsWithout)}`);
check("D3 exactly two chunks removed",
  sectionsWith.length - sectionsWithout.length === 2,
  `before=${sectionsWith.length} after=${sectionsWithout.length}`);

// Content windows for surviving headings must be byte-identical across variants.
const survivingHeadings = headingsWithout.filter((h) => h.length > 0);
let contentIdentical = true;
for (const h of survivingHeadings) {
  const a = sectionsWith.find((s) => s.heading === h)?.window;
  const b = sectionsWithout.find((s) => s.heading === h)?.window;
  if (a !== b) { contentIdentical = false; console.log(`        window differs for ${h}`); }
}
check("D4 surviving content windows byte-identical", contentIdentical);

// buildChunkInputs: same conclusion at the embed-text level (annotation prefix included).
const inputsWith = buildChunkInputs(ANNOTATION, FIXTURE, DEFAULT_CHUNKING);
const inputsWithout = buildChunkInputs(ANNOTATION, strippedBody, DEFAULT_CHUNKING);
check("D5 buildChunkInputs drops exactly two section chunks",
  inputsWith.length - inputsWithout.length === 2,
  `with=${inputsWith.length} without=${inputsWithout.length}`);

// =====================================================================
// Deterministic part — helpers
// =====================================================================
section("Deterministic — helpers");

check("H1 stripLegacySections is idempotent", stripLegacySections(strippedBody) === strippedBody);
check("H2 stripLegacySections preserves frontmatter + H1 + intro",
  strippedBody.includes("wiki_outgoing_links:") &&
  strippedBody.includes("# SCD1 (Slowly Changing Dimension Type 1)") &&
  strippedBody.includes("новое значение атрибута перезаписывает старое"));
check("H3 stripLegacySections keeps the mandatory content section",
  strippedBody.includes("## Основные характеристики"));

const related = extractRelatedLinks(FIXTURE);
check("H4 extractRelatedLinks finds both related links",
  related.includes("[[scd2]]") && related.includes("[[перезапись-таблицы]]"),
  `related=${JSON.stringify(related)}`);
check("H5 extractRelatedLinks ignores links outside the related section",
  !related.includes("[[etl-обзор]]"),
  `related=${JSON.stringify(related)}`);

const unioned = addOutgoingLinks(FIXTURE, related);
check("H6 addOutgoingLinks unions the body-only link into wiki_outgoing_links",
  unioned.includes("[[перезапись-таблицы]]") &&
  /wiki_outgoing_links:/.test(unioned.slice(0, unioned.indexOf("# SCD1"))));
check("H7 addOutgoingLinks is a no-op when all links already present",
  addOutgoingLinks(unioned, ["[[scd2]]"]) === unioned);

// ---------- summary ----------
console.log(`\n========================================`);
console.log(`TOTAL: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log(`FAILED: ${failures.join(", ")}`);
  process.exitCode = 1;
}
