---
lat:
  require-code-mention: false
---
# Query Sentinel Tests

Integration tests for post-stream wiki link validation in `runQuery`. Covers the full pipeline: detect broken links, retry with LLM rewrite, annotate fallback, and abort handling.

## All links valid

When the LLM answer contains only wikilinks whose stems exist in the vault, the result is emitted unchanged and no `FixingLinks` tool_use event is produced.

## Broken links with retries

When the initial answer has a broken wikilink and `validationRetries > 0`, `runQuery` emits a `FixingLinks` tool_use event and replaces the answer with the rewritten version when the rewrite has no broken links.

## Broken links retries zero

When `validationRetries = 0`, broken links are annotated with `*(нет в wiki)*` inline and no `FixingLinks` tool_use event is emitted — the annotate-only path is taken.

## Broken links retry still broken

When both the initial answer and the rewrite response still contain broken links, the result falls back to annotating the broken links with `*(нет в wiki)*`.

## Retry throws annotate fallback

When the LLM rewrite call throws an error, `runQuery` falls back to annotating the original broken links rather than propagating the error.

## Signal aborted before retry

When the abort signal fires during the rewrite call, `runQuery` exits without emitting a `result` event or any `assistant_replace` — the AbortError is not wrapped as a broken-link annotation.

## Empty answer no validate

When the LLM streams an empty answer, the `ValidateLinks` tool_use step is skipped entirely and no validation events are emitted.
