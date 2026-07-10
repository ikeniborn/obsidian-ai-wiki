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
 * Imports src/page-similarity.ts / src/strip-legacy-sections.ts, which pull in `obsidian`,
 * so this eval runs as an esbuild CJS bundle with the obsidian stub aliased in — NOT under
 * plain `tsx`. Build & run (from repo root):
 *   node_modules/.bin/esbuild eval/legacy-sections/run.ts \
 *     --bundle --platform=node --format=cjs \
 *     --alias:obsidian=./eval/legacy-sections/obsidian-stub.ts \
 *     --outfile=eval/legacy-sections/run.cjs
 *   node eval/legacy-sections/run.cjs
 *
 * Details / retrieval A/B: docs/superpowers/evals/2026-06-19-legacy-sections-eval.md
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
// Note: both "[[scd2]]" and "[[перезапись-таблицы]]" appear only inside the legacy related
// section, NOT in a canonical ## Related body section — this exercises the union
// safety-net (Task 4 / addOutgoingLinks lifting body-only links before the strip).
const ANNOTATION = "SCD1 — стратегия медленно меняющихся измерений с перезаписью значений без хранения истории.";
const FIXTURE = `---
timestamp: 2026-06-10
status: developing
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
  strippedBody.includes("timestamp:") &&
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
// Task 4: outgoing links are no longer synced into frontmatter — addOutgoingLinks now
// lifts them into a canonical `## Related` body section instead.
const relatedSectionIdx = unioned.indexOf("\n## Related\n");
check("H6 addOutgoingLinks creates a canonical ## Related section with the body-only links",
  relatedSectionIdx !== -1 &&
  unioned.slice(relatedSectionIdx).includes("[[перезапись-таблицы]]") &&
  unioned.slice(relatedSectionIdx).includes("[[scd2]]"),
  `relatedSectionIdx=${relatedSectionIdx}`);
check("H7 addOutgoingLinks is a no-op when all links already present",
  addOutgoingLinks(unioned, ["[[scd2]]"]) === unioned);

// =====================================================================
// Retrieval A/B — only when an embedding key is configured
// =====================================================================
async function runEmbeddingAB(): Promise<void> {
  section("Retrieval A/B (embeddings)");

  // Explicit, named assertion bounds (from the spec).
  const EPS_ONTOPIC = 0.02;     // max allowed cosine delta for on-topic queries
  const MIN_NOISE_DROP = 0.05;  // min required cosine drop for noise-probe queries

  const EMBED_BASE_URL = process.env.EVAL_EMBED_BASE_URL;
  const EMBED_API_KEY = process.env.EVAL_EMBED_API_KEY;
  const EMBED_MODEL = process.env.EVAL_EMBED_MODEL;
  const EMBED_DIMENSIONS = process.env.EVAL_EMBED_DIMENSIONS
    ? Number(process.env.EVAL_EMBED_DIMENSIONS) : undefined;

  const ON_TOPIC = ["SCD1 версионирование", "перезапись таблицы"];
  const NOISE_PROBES = ["когда создана страница", "история изменений", "связанные концепции"];

  async function embed(texts: string[]): Promise<number[][]> {
    const url = `${EMBED_BASE_URL!.replace(/\/$/, "")}/embeddings`;
    const body: Record<string, unknown> = { model: EMBED_MODEL, input: texts };
    if (EMBED_DIMENSIONS && EMBED_DIMENSIONS > 0) body.dimensions = EMBED_DIMENSIONS;
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${EMBED_API_KEY}` },
      body: JSON.stringify(body),
    });
    if (!resp.ok) throw new Error(`Embedding API error: ${resp.status}`);
    const json = (await resp.json()) as { data: { embedding: number[] }[] };
    return json.data.map((d) => d.embedding);
  }

  function cosine(a: number[], b: number[]): number {
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
    const denom = Math.sqrt(na) * Math.sqrt(nb);
    return denom === 0 ? 0 : dot / denom;
  }

  /** Page score = best cosine of `query` over `chunks`, plus the winning chunk's embed-text. */
  function maxChunk(query: number[], chunks: { vec: number[]; embedText: string }[]): { score: number; winner: string } {
    let best = { score: 0, winner: "" };
    for (const c of chunks) {
      const s = cosine(query, c.vec);
      if (s > best.score) best = { score: s, winner: c.embedText };
    }
    return best;
  }

  if (!EMBED_BASE_URL || !EMBED_API_KEY || !EMBED_MODEL) {
    console.log("  SKIP  embedding A/B — set EVAL_EMBED_BASE_URL, EVAL_EMBED_API_KEY, EVAL_EMBED_MODEL to enable");
  } else {
    try {
      const withTexts = inputsWith.map((c) => c.embedText);
      const withoutTexts = inputsWithout.map((c) => c.embedText);
      const queries = [...ON_TOPIC, ...NOISE_PROBES];

      const [withVecs, withoutVecs, queryVecs] = await Promise.all([
        embed(withTexts), embed(withoutTexts), embed(queries),
      ]);
      const withChunks = inputsWith.map((c, i) => ({ vec: withVecs[i], embedText: c.embedText }));
      const withoutChunks = inputsWithout.map((c, i) => ({ vec: withoutVecs[i], embedText: c.embedText }));

      queries.forEach((q, qi) => {
        const qv = queryVecs[qi];
        const a = maxChunk(qv, withChunks);
        const b = maxChunk(qv, withoutChunks);
        const isNoise = qi >= ON_TOPIC.length;
        const delta = a.score - b.score; // with − without (noise: expected positive = a drop)
        console.log(`  [${isNoise ? "noise" : "ontopic"}] "${q}"  with=${a.score.toFixed(4)} without=${b.score.toFixed(4)} Δ=${delta.toFixed(4)}`);
        // buildChunkInputs embed-text is `${annotation}\n\n${heading}\n${window}` — the
        // second-to-last line is the section heading; fall back to a prefix if the shape changes.
        console.log(`        winner(with)=${a.winner.split("\n").slice(-2, -1)[0] ?? a.winner.slice(0, 40)}`);
        if (isNoise) {
          check(`E noise "${q}" drops ≥ ${MIN_NOISE_DROP}`, delta >= MIN_NOISE_DROP, `Δ=${delta.toFixed(4)}`);
        } else {
          check(`E ontopic "${q}" |Δ| < ${EPS_ONTOPIC}`, Math.abs(delta) < EPS_ONTOPIC, `Δ=${delta.toFixed(4)}`);
        }
      });
    } catch (e) {
      check("E embedding A/B ran", false, (e as Error).message);
    }
  }
}

// ---------- summary ----------
runEmbeddingAB().then(() => {
  console.log(`\n========================================`);
  console.log(`TOTAL: ${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.log(`FAILED: ${failures.join(", ")}`);
    process.exitCode = 1;
  }
}).catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
