# Replay Analysis

Vault: `/tmp/ai-wiki-bounded-ingest-replay.SMt4rx/run`

Session: `1784747412210`

## Findings

- The run confirms complete HTTP 200 body reads for the observed synthesis failure path.
- The initial 10-entity synthesis batch failed strict validation with `unknown entity key: entity-obsidian`.
- Split batches then failed on non-canonical create paths:
  - `!Wiki/os-unix/methods/wiki_os-unix_chromium-flag.md`
  - `!Wiki/os-unix/configurations/wiki_os-unix_environment-variables.md`
  - `!Wiki/os-unix/applications/obsidian.md`
  - `!Wiki/os-unix/methods/wiki_os-unix_permanent-launch-shortcut.md`
  - `!Wiki/os-unix/methods/wiki_os-unix_profile-method.md`
  - `!Wiki/os-unix/configurations/proxy-pac.md`
- `!Wiki/os-unix/metadata.jsonl` defines `method -> methods`, so `methods` is valid for this replay. The main path problem is canonical stem/path construction.
- The first source eventually created 10 valid pages with underscore stems and configured folders.
- A later source failed after empty structured output and response format fallback because repair preflight estimated `32769` tokens against a `32768` budget.

## Implication

Server-owned canonical create paths should prevent the observed path-spelling retry cascade. Unknown entity keys still need strict rejection or compact repair because they are real domain defects.
