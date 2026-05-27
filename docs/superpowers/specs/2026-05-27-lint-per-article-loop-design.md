# Design: Lint per-article loop with similarity context

**Date:** 2026-05-27
**Status:** approved
**Intent:** [2026-05-27-lint-per-article-loop-intent.md](../intents/2026-05-27-lint-per-article-loop-intent.md)

## Problem

`runLint` sends all wiki pages of a domain in a single LLM call. On domains with 200+ pages this overflows the model's context window and produces an error. The fix: iterate one article at a time, sending only that article plus a limited context set selected by similarity + graph traversal.

## Architecture

The change is entirely internal to `src/phases/lint.ts`. External contract (`runLint` signature, `LintOutputSchema` extended with `deletes`, `VaultTools` API) stays stable. `PageSimilarityService` and `AgentRunner` APIs are unchanged.

```
runLint(domain)
  │
  ├─ [unchanged] load all pages, structural checks (checkStructure,
  │              checkGraphStructure, checkWikiLinks) on all pages upfront
  ├─ [NEW] load index annotations + build pageId→path map
  ├─ [NEW] if embedding mode: loadCache (moved from end → before loop)
  │
  └─ for each article in (_index.md keys ∪ listFiles):
       │
       ├─ selectRelevant(articleContent, annotations, allPaths) → top-K paths
       ├─ bfsExpand([articleId, ...topKIds], graph, depth=1) → pageId set
       ├─ resolve pageIds → paths via pidToPath map
       ├─ build contextPages = article + resolved paths (from pages map)
       │
       ├─ yield info_text "Checking i/N: ArticleName"
       ├─ LLM call: article + contextPages → LintOutput { fixes[], deletes[] }
       │
       ├─ Write fixes immediately:
       │    vaultTools.write(fix.path, fix.content)
       │    pages.set / annotations.set / upsertIndexAnnotation
       │
       ├─ Delete duplicates immediately:
       │    vaultTools.remove(path)  [if supported]
       │    pages.delete / annotations.delete
       │    Rewrite [[deletedName]] → [[redirectName]] in all wiki pages (in-memory + disk)
       │    Accumulate deletedRefs for source-file rewrite at end
       │
       └─ Rebuild state:
            graphCache.get(domain.id, pages)   // rebuilds on content-hash change
            similarity.refreshCache(...)        // updates vectors for changed pages only
  │
  ├─ Source-file backlink rewrite (one vault-wide scan):
  │    for each deletedRef: replace [[old]] → [[new]] in wiki_articles frontmatter
  ├─ [unchanged] fixWikiLinks on all accumulated fixes
  ├─ [unchanged] actualizeDomainConfig
  └─ [unchanged] appendWikiLog
```

## Schema changes

### `LintOutputSchema` — add `deletes`

```typescript
// src/phases/zod-schemas.ts
export const LintOutputSchema = z.object({
  reasoning: z.string(),
  report: z.string(),
  fixes: z.array(WikiPageSchema),
  deletes: z.array(z.object({
    path: z.string(),
    redirectTo: z.string().optional(), // path of article that absorbed the duplicate
  })).optional(),
});
```

`fixes` carries the merged content in the target article. `deletes` names which articles are removed and where their links should redirect.

## Per-article context selection

```typescript
// Article list: union of _index.md keys and listFiles (completeness guarantee)
const indexAnnotations = parseIndexAnnotations(indexRaw);  // Map<pageId, annotation>
const pidToPath = new Map(files.map(p => [pageId(p), p]));
const articlePaths = [
  ...new Set([
    ...[...indexAnnotations.keys()].map(pid => pidToPath.get(pid)).filter(Boolean),
    ...files,
  ])
];

// Per article:
const topKPaths = similarity
  ? await similarity.selectRelevant(articleContent, indexAnnotations, otherPaths)
  : [];
const seeds = [pageId(targetPath), ...topKPaths.map(pageId)];
const expanded = bfsExpand(seeds, graph, 1);  // depth=1
const contextPaths = [...expanded].map(pid => pidToPath.get(pid)).filter(Boolean);
```

`relevantPagesTopK` (existing config param) controls K. No new config parameters.

## LLM message format (per article)

System prompt: unchanged (`lint.md` template — domain name, entity types, schema).

User message:
```
Домен: {domain.id} ({domain.name})
Анализируемая статья: {targetPath}
Автоматические проблемы:
{structuralIssues filtered to lines containing targetPath, or "Нет."}

--- {targetPath} ---
{articleContent}

--- Контекст (связанные статьи) ---
--- {contextPath1} ---
{contextContent1}
...
```

### Prompt addition for duplicate deletion

Append to `lint.md`:
```
При обнаружении дублирующихся статей:
- объедини контент в основную статью (через fixes)
- укажи пути дублей в поле deletes[].path
- укажи путь основной статьи в deletes[].redirectTo для обновления ссылок
```

## State updates after each article

```typescript
// 1. Apply fixes to disk + in-memory
for (const fix of fixes) {
  await vaultTools.write(fix.path, fix.content);
  pages.set(fix.path, fix.content);
  if (fix.annotation) {
    annotations.set(pageId(fix.path), fix.annotation);
    await upsertIndexAnnotation(vaultTools, wikiVaultPath, pageId(fix.path), fix.annotation, fix.path);
  }
}

// 2. Process deletes
for (const { path: delPath, redirectTo } of (lintResult.deletes ?? [])) {
  if (typeof vaultTools.remove === 'function') {
    await vaultTools.remove(delPath);
  }
  pages.delete(delPath);
  annotations.delete(pageId(delPath));
  const deletedName = pageId(delPath);
  const redirectName = redirectTo ? pageId(redirectTo) : null;

  // Rewrite wiki links in-memory + disk (wiki pages only, cheap)
  for (const [wikiPath, wikiContent] of pages) {
    if (wikiContent.includes(`[[${deletedName}]]`)) {
      const newContent = redirectName
        ? wikiContent.replaceAll(`[[${deletedName}]]`, `[[${redirectName}]]`)
        : wikiContent.replaceAll(`[[${deletedName}]]`, '');
      await vaultTools.write(wikiPath, newContent);
      pages.set(wikiPath, newContent);
    }
  }

  deletedRefs.push({ deletedName, redirectName });
}

// 3. Rebuild graph + vectors
({ graph } = graphCache.get(domain.id, pages));
await similarity?.refreshCache(wikiVaultPath, vaultTools, annotations);
```

## Source-file backlink rewrite (end of loop)

One vault-wide scan after all articles are processed:

```typescript
if (deletedRefs.length > 0) {
  const allVaultPaths = await vaultTools.listFiles('').catch(() => [] as string[]);
  for (const sourcePath of allVaultPaths.filter(p => p.endsWith('.md'))) {
    const content = await vaultTools.read(sourcePath).catch(() => null);
    if (!content) continue;
    let updated = content;
    for (const { deletedName, redirectName } of deletedRefs) {
      if (updated.includes(`[[${deletedName}]]`)) {
        updated = redirectName
          ? updated.replaceAll(`[[${deletedName}]]`, `[[${redirectName}]]`)
          : updated.replaceAll(`[[${deletedName}]]`, '');
      }
    }
    if (updated !== content) await vaultTools.write(sourcePath, updated);
  }
}
```

## Error handling

| Situation | Behaviour |
|-----------|-----------|
| LLM call fails for one article | Log to `skippedArticles`, continue loop |
| Article content > token limit | Caught by `parseWithRetry`, logged as "Article too large — skipped: {path}" |
| `vaultTools.remove` not supported | Log warning, skip physical delete, still remove from in-memory `pages` |
| `signal.aborted` | Checked at top of each loop iteration, returns immediately |

Skipped articles appended to final report:
```markdown
### Пропущены (ошибка LLM)
- ArticleA.md
- ArticleB.md
```

## Progress events

```typescript
yield { kind: "info_text", icon: "🔍", summary: `Checking ${i}/${total}: ${articleName}` };
// after LLM call:
yield { kind: "tool_result", ok: true, preview: `${fixes.length} fixes, ${deletes.length} deleted` };
```

## What does NOT change

- `runLint` function signature
- `PageSimilarityService` API
- `AgentRunner` external contract
- `actualizeDomainConfig` call (runs once after loop)
- `appendWikiLog` call (runs once after loop)
- Backlink sync for `wiki_articles` (runs once after loop, unchanged logic)
- `checkStructure`, `checkGraphStructure`, `checkWikiLinks` (run upfront on all pages)
