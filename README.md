# AI Wiki — Obsidian Plugin

[Русская версия →](docs/README.ru.md)

Automatically builds and maintains a knowledge-base wiki from your notes using an AI assistant.

**Why AI Wiki:**
- **Offline by default** — works with Ollama or any local AI server; your notes never leave your machine
- **Grows with your notes** — every Ingest adds new topics and updates existing ones automatically
- **Transparent** — watch every AI step in real time in the sidebar panel
- **One OpenAI-compatible runtime** — use Ollama locally or connect to a remote compatible service

> Supported transport: **OpenAI-compatible**, with local Ollama and remote services supported.

---

## What it does

AI Wiki reads your notes and maintains a structured knowledge base (wiki) alongside them. Think of it as an assistant that reads what you write and keeps a living reference document up to date.

| Feature | What it does |
|---|---|
| **Ingest** | Reads an open note, extracts key topics (people, tools, processes, terms), creates pages or updates existing pages with guarded section patches. Oversized Markdown is processed as bounded chunks with complete evidence coverage. Tags are standardized: pages reuse the domain's existing tag vocabulary, carry their entity-type tag, and the set of thematic tag categories is bounded per domain |
| **Query** | Answers a question using your wiki as context; results shown in the sidebar with cross-links |
| **Lint** | Reviews wiki pages for gaps, outdated content, and broken links; shows a report in the sidebar |
| **Fix** | After Lint — send an instruction in the sidebar chat to apply corrections |
| **Init** | Sets up a new knowledge area (domain) with the folder structure and index files |
| **Re-init** | Removes and recreates the complete domain tree, including metadata and empty folders, then rebuilds it from sources |
| **Format** | Cleans up any open markdown note (outside the wiki): headings, tables, frontmatter, image captions. Shows a preview before applying. Invariant: never adds or removes facts — only improves clarity. When the note belongs to a configured domain, tags are reused from that domain's existing tag vocabulary |
| **Chat** | Interactive follow-up in the sidebar after Query or Lint |
| **Export OKF** | Serialize a domain into a Google [Open Knowledge Format](https://cloud.google.com/blog/products/data-analytics/how-the-open-knowledge-format-can-improve-data-sharing/) bundle — a folder of markdown with OKF frontmatter, a generated `index.md`/`log.md`, and standard `[text](link.md)` links — for sharing with external AI agents and tools. Desktop only |

Fix, Format, and Chat are launched from sidebar buttons, not the Command Palette. Export OKF is available both as a sidebar button and a Command Palette command.

> **Mobile:** only Query works on mobile. Ingest, Lint, Init, Format, and Export OKF are desktop-only.

> **OKF frontmatter:** wiki pages use Google's Open Knowledge Format — a mandatory `type` (the entity-type subfolder) plus `description`/`resource`/`timestamp`/`tags`/`status`. The knowledge graph lives in `## Related` / `## External links` body sections (Obsidian `[[wikilinks]]` on disk, rewritten to markdown links only in the OKF export).

---

## Community directory disclosures

### Network use

AI Wiki sends selected note content and prompts only to the OpenAI-compatible service configured by the user. The endpoint may be local, such as Ollama, or remote. Network access is used only for AI operations and optional model probes the user starts.

### Accounts and payment

AI Wiki itself is free and requires no account. Local Ollama use requires neither an account nor payment. Optional remote OpenAI-compatible services may require their own account or payment.

### External file access

AI Wiki does not execute a user-configured AI CLI or another external AI process.

### Vault access

The plugin reads only the folders you set as sources for each domain. It does not scan your entire vault.

### License

AI Wiki is licensed under the [Apache License 2.0](LICENSE).

---

## Installation

### Community Plugins

In Obsidian, open **Settings -> Community plugins -> Browse**, search for **AI Wiki**, select the plugin, and install it. Enable **AI Wiki** after installation.

### Manual installation

Download `main.js`, `manifest.json`, and `styles.css` from the same version on the [GitHub Releases page](https://github.com/ikeniborn/obsidian-ai-wiki/releases). Put the three files directly in `<vault>/.obsidian/plugins/ai-wiki/`, then reload Obsidian and enable **AI Wiki**.

Do not mix files from different releases. A repository checkout is source code, not an install bundle.

### Local development

Run `npm install` and `npm run build`, then copy or link the contents of `dist/` into `<vault>/.obsidian/plugins/ai-wiki/`. The plugin directory must contain the flat `main.js`, `manifest.json`, and `styles.css` asset set; link `dist/`, not the repository root.

### Development and release contract

Version `0.3.6` supports Obsidian `1.13.0` and later, including mobile (`isDesktopOnly: false`). The settings UI uses Obsidian's supported **Settings Definitions** API: indexed groups and controls are returned as definitions, and custom supported controls render through each definition's `render` callback. It does not use the legacy `display()` lifecycle.

The official source-lint command is `npm run lint`. It applies the complete recommended `eslint-plugin-obsidianmd` configuration to `src/**/*.ts` and accepts **zero errors and zero warnings** (`--max-warnings 0`).

Run the mobile evaluation by rebuilding its bundle and then executing it:

```bash
npm run eval:mobile-fixes:build
node eval/mobile-fixes/run.cjs
```

Release validation has two phases. Before the production build, it scans only tracked text files in `src/`, `eval/`, and `scripts/`; `scripts/dspy/CLAUDE.md` and `scripts/validate-release.mjs` are explicit exclusions. A matching diagnostic is reported exactly as `[<path>] forbidden <category> marker: <match>` for these categories: Claude backend, Claude CLI probe, subprocess, Claude configuration, and Claude UI. After the build, the validator scans `dist/main.js` directly (even when it is untracked), rejects an inline source map, and requires non-empty `dist/main.js`, `dist/manifest.json`, and `dist/styles.css` with a byte-identical source/distribution manifest.

Run the remaining release gates in this order: `npm run release:validate:pre`, `npm run lint`, `npm run typecheck`, `npm test`, the mobile evaluation above, `npm run build`, and `npm run release:validate:post`. The repository tracks the exact generated release files, and the workflow requires the build to leave those tracked files with no diff.

Release history is immutable: `versions.json["0.3.5"]` stays `"1.7.2"`. Current `0.3.6` package, lockfile, source/root/distribution manifest, and compatibility metadata are synchronized; `0.3.6` maps to `1.13.0` and every current manifest declares the same minimum app version.

The release workflow triggers on a push to `master` that changes `src/manifest.json`; normal delivery reaches it by merging a pull request, but the YAML does not enforce merge provenance. Its one constant concurrency group queues waiting publishers (`queue: max`) without cancelling the active run. After all gates, asset digests, and provenance attestation pass, it performs only a non-force lightweight tag claim for the verified `GITHUB_SHA` commit and one create-only `gh release create`; draft, partial, conflicting, or ambiguous release state stops publication. A completed matching release is terminal success without mutation.

Community plugin-directory submission, account/review actions, and directory metadata changes remain excluded and are not authorized by this release process.

---

## Quick start: Ollama (fully local)

No accounts or cloud services required — AI runs on your computer.

### 1. Install Ollama

Download from [ollama.com](https://ollama.com) and pull a model:

```bash
ollama pull llama3.2
```

### 2. Install the plugin

Install through Community Plugins, from one GitHub Release, or from a local `dist/` build as described in [Installation](#installation).

### 3. Enable the plugin

Obsidian → Settings → Community plugins → find "AI Wiki" → enable.

### 4. Configure

Settings → AI Wiki:

| Setting | Value |
|---|---|
| Base URL | `http://localhost:11434/v1` |
| API Key | `ollama` |
| Model | `llama3.2` |
| Temperature | `0.2` |
| Semantic compression | `Balanced` |

Input and output budget tokens are automatic by default — AI Wiki derives them from the
model's context window, so there is nothing to configure here. Leave them empty unless
you need to override the automatic value; see [Bounded processing and storage](#bounded-processing-and-storage).

### 5. Create a knowledge area (domain)

A domain is a pair: "source folder → wiki folder". The AI reads files from the source folder and writes wiki pages to the wiki folder.

Open the AI Wiki sidebar panel (ribbon icon or Command Palette → "Open panel"), then:

1. Click the **Init** button in the "Create" section
2. Enter a domain name (e.g. `work`)
3. Add source folder paths — the folders containing notes you want to turn into wiki
4. Click **Run** — the plugin creates the wiki folder and starts building pages

### 6. First Ingest

1. Open any note in Obsidian
2. In the sidebar, select your domain from the dropdown
3. Click the **Ingest** button
4. Watch progress in the sidebar — new wiki pages appear in the domain folder

---

## Sidebar panel

The sidebar is the main interface for AI Wiki. Open it via the ribbon (🧠 icon) or Command Palette → "Open panel".

### Sections

**Create** — click **Init** to set up a new knowledge domain (name, wiki folder, source paths).

**Fill / Maintain** — manage and populate an existing domain:
- Domain selector — choose which domain to work with
- **↻** refresh the domain list
- **📁+** manage source folders (add or remove)
- **♻** full re-init: remove and recreate the complete domain tree, then rebuild from sources
- 📜 open the domain log file
- 🗒 open the domain index file
- **Ingest** — process the currently open note
- **Lint** — review wiki quality and find gaps
- **Format** — clean up the currently open note's formatting

**Query** — type a question and click **Ask**. The answer appears in the sidebar with wiki cross-links. Use the **Chat** section below the result to refine or follow up.

### Model progress and Re-init

Each model request uses one human-readable sidebar lifecycle: **Preparing request → Request
sent to model → Waiting for model response → Model is producing a response → Validating
response → Applying result → Completed** (or a terminal retry, failure, or cancellation).
Reasoning remains available in its expandable block. Call sites, transport details,
attempts, budgets, and provider data stay in `agent.jsonl`, not sidebar labels. The waiting
timer shows UI elapsed time; it is not a provider heartbeat and does not extend the idle
deadline. Agent-log reasoning is retained in ordered bounded records up to 4 MiB per
operation; excess text is replaced by a metadata-only truncation marker.

For the OpenAI-compatible runtime, a replacement transport attempt starts a fresh human lifecycle at
**Preparing request**. The sidebar does not show retry counters or HTTP details.
`agent.jsonl` records metadata-only `transport_retry_scheduled`,
`transport_retry_recovered`, and `transport_retry_exhausted` events with the logical
request ID, lifecycle ID, status/classification, delay, attempt bound, and timeout values;
request bodies, response content, authorization headers, and API keys are never retry
diagnostics.

Background structured work—Init bootstrap, evidence map/reduce, Ingest synthesis, and
bounded Lint batches—uses atomic non-stream responses. Interactive Chat, the Query answer,
and Format use SSE so reasoning or answer text can appear as it arrives.

Full Re-init validates bootstrap output and source snapshots before mutation, then removes
the entire `!Wiki/<domain>` tree exactly once: pages, metadata, indexes, logs, temporary
content, nested type folders, and obsolete empty directories. It recreates fresh metadata
and index state before ingest. A deletion or concurrent-write conflict aborts source ingest;
the transaction restores the prior snapshot when safe and never overwrites a concurrently
recreated domain tree.

---

## Commands (Command Palette)

| Command | Action |
|---|---|
| `AI Wiki: Open panel` | Show the sidebar panel |
| `AI Wiki: Ingest active file` | Ingest the currently open note *(desktop only)* |
| `AI Wiki: Query` | Ask a question via a dialog box |
| `AI Wiki: Lint domain` | Check wiki quality *(desktop only)* |
| `AI Wiki: Init domain` | Re-run init for an existing domain *(desktop only)* |
| `AI Wiki: Export OKF bundle` | Export the selected domain as an OKF bundle *(desktop only)* |
| `AI Wiki: Cancel operation` | Stop the current operation |

---

## Settings reference

### General

| Setting | Description | Default |
|---|---|---|
| User prompt | Added to the system prompt of every operation | empty |
| Timeouts (seconds) | `ingest/query/lint/init/format`, slash-separated | `300/300/900/3600/600` |
| LLM idle timeout | Maximum silence between meaningful native model events; `0` disables the executor idle deadline | `300` s |
| Retry count | Additional attempts for the current OpenAI-compatible request | `3` |
| History limit | Max operations in sidebar history | `20` |
| Agent log (JSONL) | Log agent events to plugin-local `agent.jsonl` (desktop only) | off |

### Domains

List of created domains with **Edit** / **Delete** buttons. Domain map is stored in `!Wiki/_config/_domain.json`.

### OpenAI-compatible runtime

| Setting | Description | Default |
|---|---|---|
| Base URL | OpenAI-compatible endpoint. Ollama: `http://localhost:11434/v1` | `http://localhost:11434/v1` |
| API key | `ollama` for Ollama; `sk-...` for OpenAI | `ollama` |
| Connection timeout | Desktop DNS/TCP/TLS establishment only; it does not cap response headers, body, or generation | `15` s |
| Model context window | Tokens the model holds in one request. One field per model field — the chat model, each per-operation model, and the vision model — so differently sized models are budgeted separately. Empty (shown as "Automatic") means the window is read from the backend. Set a number only when your backend does not report one; every budget for that model is then derived from it and nothing is probed. Minimum `1024` tokens; smaller entries are refused | *(empty = Automatic)* |
| Input budget tokens | Maximum size of the packed prompt. Empty (shown as "Automatic") derives it from the model's context window, discovered once per model, cached, and self-corrected against the provider's reported usage. Set a number to override it | *(empty = Automatic)* |
| Output budget tokens | Response cap sent through `maxTokens`/API `max_tokens`. Empty (shown as "Automatic") is derived per operation from the model's context window the same way. Set a number to override it | *(empty = Automatic)* |
| Semantic compression | Prompt-density profile (`Maximum`/`Balanced`/`Minimum`) with operation-specific preservation rules | `Balanced` |
| Model | Model name (`llama3.2`, `mistral`, `gpt-4o`, …). Shown when per-operation is off | `llama3.2` |
| Thinking budget tokens | Separate native model reasoning allowance; `0` or empty disables it. It does not increase the input budget | off |
| Temperature | `0.0`–`1.0`. Low values (`0.1`–`0.3`) give more precise, factual answers | `0.2` |
| Per-operation models | When on, configure model, input/output budgets, compression, thinking budget, and temperature per operation. Format keeps numeric budgets but has no semantic-compression control | off |
| Output repair retries | Retries for invalid JSON or invalid framed output after Zod validation (0–3). Higher = more reliable on weaker models | `1` |

### Transient request recovery

AI Wiki retries only the current identical OpenAI-compatible request, up to the
configured number of additional attempts. It never replays Init, Re-init, Ingest, a source
read, `WipeDomain`, completed evidence, or page/index application. Eligible failures are
connection errors/timeouts and HTTP `408`, `409`, `429`, and `5xx`. Provider
`x-should-retry: true` can opt in another transient response; `x-should-retry: false`
always opts out. HTTP `400`, `401`, `403`, `404`, and `422`, context-limit and schema
failures, cancellation, permanent TLS/certificate errors, and application/index/embedding
failures are not transport-retried.

Persisted retry diagnostics accept only connection, connection-timeout, allowlisted
temporary-transport, retryable-HTTP, and explicit provider-override classifications.
Transport classifications carry no HTTP status; HTTP classifications must carry a
consistent valid status, and recovered/exhausted diagnostics must match the scheduled
failure they close.

Retry stops after nonblank reasoning or content, or when the additional-attempt bound is
exhausted. Connection timeout (`15` seconds), model idle timeout (`300` seconds), and
retry count (`3`) are independent top-level settings; existing persisted values are
preserved. A healthy response may take longer than 15 seconds because that value applies
only to desktop connection establishment. On Mobile, AI Wiki keeps the host-provided
transport, so an exact DNS/TCP/TLS-only timeout cannot be guaranteed; request retry and
model-idle handling remain separate from that limitation.

### Vision

| Setting | Description | Default |
|---|---|---|
| Enable image analysis | Analyze supported images and PDF pages during Format | off |
| Semantic compression | Vision-specific override; preserves OCR, objects, relationships, layout, page identity, and uncertainty | Use global |
| Vision model | Multimodal model used for image analysis | — |
| Model context window | The **vision** model's window, used to size its own requests — including how many PDF pages go into one call. Empty (shown as "Automatic") means the window is read from the backend. Set it whenever your vision model is smaller than your chat model and the backend does not advertise its window: that is what makes a small-window vision model work, not a measure to reach for after seeing "Vision skipped". Minimum `1024` tokens | *(empty = Automatic)* |
| Vision Check | Sends one real, tiny 1×1 inline PNG request with a short prompt and a 16-token output cap. Reports success/failure without changing settings or vault files | — |

### Bounded processing and storage

These controls cover different parts of a call: **Input budget tokens** bound the prepared
request, **Output budget tokens** cap the generated response, and **Thinking budget
tokens** separately allow model reasoning when the provider supports it. AI Wiki owns all
three controls.

The input budget governs the complete prepared request, including system/schema
instructions—not just note text. When content does not fit, AI Wiki packs complete context
units and uses operation-specific batching or splitting instead of silently truncating
required content. Provider context errors can trigger a smaller repack.

An empty input or output budget is automatic: AI Wiki discovers the
model's context window once per model, caches it, and self-corrects the estimate against
the provider's reported token usage. A number you type in Input budget tokens or Output
budget tokens still acts as an explicit override — automatic budgeting never overrides a
value you set.

When the provider does not report a context window for the model, AI Wiki falls back to a
conservative **8192-token** window and budgets from that. The fallback is cached for
**24 hours**, so the next run after that re-probes the provider and picks up a real window
as soon as one is reported; a discovered window is cached without an expiry. In capacity
terms the fallback is roughly neutral against the byte-based 16384 budget it replaces —
about 15 kB of Latin text either way — so it is a different unit, not a smaller allowance.

#### When your backend never reports a window

Some OpenAI-compatible backends — aggregating gateways and proxies in particular — answer
`GET /v1/models` and list your model, but no entry carries a context length, and the
Ollama-style `/api/show` endpoint does not exist. There is then nothing to discover, so
every run budgets from the conservative 8192-token fallback even though the real model
window may be sixteen times larger. What you see: schema or instruction blocks dropped
from prompts to make them fit, requests reported as truncated ("needs N tokens" against a
4096-token limit, that limit itself derived from the phantom 8192 window), and
`agent.jsonl` showing `contextWindow: 8192` with `inputSource: "default"`. The agent log
is **off by default** — turn on **Agent log (JSONL)** in Settings before looking for those
entries. The field itself shows "Automatic" while the window is unknown: the fallback is
not a measurement of your model, so it is never advertised there as one.

Fix it by filling in **Model context window** with the model's real window in tokens (for
example `131072`; the minimum accepted is `1024`). AI Wiki then skips the probe entirely
for that backend and model and derives every budget from your number, exactly as if the
backend had reported it — input budget, output budget, the per-request output ceiling,
chunk budgets, and the Init bootstrap split. The agent log reports
`inputSource: "configured"` so it is clear the number came from you. Clearing the field
returns that model to automatic discovery.

A window belongs to the model it sits next to, not to the backend: the chat model, each
per-operation model, and the vision model each have their own **Model context window**
field, and clearing one leaves the others alone. Two roles that name the same model share
one window, because the plugin caches one context record per model.

A value you type here is treated as an instruction, not a guess: if the provider later
rejects a prompt and reports a smaller window of its own, AI Wiki does **not** silently
shrink your value. The disagreement is recorded in `agent.jsonl` as a
`context_window_conflict` entry with both numbers, so you can correct the setting
yourself. (A discovered or fallback window, which nobody chose, is still learned down in
that situation.)

What happens to the operation depends on which one it is. Ingest, Query and Lint — and the
chat follow-ups — repack the rejected request smaller and complete anyway. **Init cannot:**
it plans its bootstrap splits from the window *before* sending anything, so a window set
larger than the model's real one makes Init fail with a bootstrap error instead of
shrinking into it. The conflict is still recorded, so `agent.jsonl` says why; lower the
setting to the model's real window (or clear it to return to automatic) and re-run.

Enabling **Per-operation models** does not turn automatic budgeting off. Each operation
gets its own input and output budget fields, and each is automatic while it is empty. A
number you type there overrides the automatic value for that operation only; clearing it
returns that operation to automatic.

If you upgraded from a version where these fields required a number, AI Wiki asks once
whether to switch your saved value to automatic or keep it; dismissing that prompt keeps
your saved value. You can change your mind at any time by clearing or setting the field
in Settings — including the per-operation fields, which stay cleared across restarts.

The prompt estimator counts tokens rather than serialized bytes, and prices characters by
class: shell commands, config files, paths and JSON cost far more tokens per character
than prose, so notes full of them are no longer estimated as if they were prose. Both
changes moved chunk boundaries during ingest. Existing domains are **not** re-indexed
automatically after upgrading — use the sidebar's **♻ full re-init** (`--force`) on a
domain to rebuild it with the new chunking.

Ingest splits oversized Markdown at stable section, paragraph, line-window, and fenced-code
boundaries. Bounded map calls produce source-anchored evidence; reduction calls preserve
coverage before synthesis. New pages are complete documents. Existing pages receive
page/section-hash-guarded `add`, `append`, or `replace` patches, so untouched sections are
preserved and stale content is not overwritten.

`index.jsonl` is structured storage: `page` records hold retrieval metadata, while `chunk`
records hold embedding metadata and vectors. Serialized vectors and raw index records never
enter model prompts; prompt builders project only the selected evidence, Markdown sections,
and allowlisted metadata they need. Unchanged chunk embeddings are reused when their
embedding-text hash, model, and dimensions still match.

Small sources keep the short path. Oversized sources, pages, histories, notes, or PDFs can
require extra bounded model calls, increasing latency and provider cost in exchange for
complete processing within the configured input budget. Vision Check is also a real
provider request and may incur a small charge.

Image and PDF analysis is budgeted from the **vision** model's own context window, not
from the window of the chat model that runs Format. The vision model gets
its own context record — discovered from the backend or taken from its own **Model context
window** field — and the number of PDF pages packed into one vision request follows from
it. A vision model with a small window therefore splits a PDF into more, smaller calls
instead of sending one oversized request that the provider rejects. Only the window
changes: an **Input budget tokens** or **Output budget tokens** value you set on the
Format operation still caps the vision call.

This applies only when the vision model's window is actually **known**. If the backend
advertises no window for it and you have not set one, vision keeps being sized from the
Format operation's own budget, exactly as before — the conservative 8192-token fallback is
not a measurement of your vision model, and budgeting from it would leave less room than a
single image costs, refusing every attachment before it was sent. So on a backend that
advertises nothing, **Vision → Model context window** is the field that makes a
small-window vision model work: set it to the model's real window and PDF batches, the
output cap and the client-side size check all follow from it.

Vision calls do not feed the context store. A provider rejection of a vision request is
recovered inside the run and then forgotten, so a vision-only model never learns a window
from one and its token calibration stays at 1; a rejection is remembered only when the
same model also serves a chat operation, which shares one context record with it. Setting
the field is what makes the window stick.

When an attachment is skipped because it does not fit, the `⚠️ Vision skipped` warning
explains why: it names the vision model and the setting to change, and — when a window is
known — the window the request was measured against and whether it was configured,
discovered or learned. With no window known it names no number, because there is none to
report: it says the backend advertises no window for this model and the request was sized
from the Format operation's own budget. Those refusals happen before the request is sent,
so nothing in the provider's answer would explain them. The warning text is English
regardless of the interface language.

Destructive Re-init acceptance must use a private copied vault, never the working vault.
The protected replay root must be a recent `/tmp/ai-wiki-bounded-ingest-replay.*`
directory with an owner-only `.replay-provenance` marker that records the resolved source
and replay root. Install the build into its `run` copy, visibly confirm that vault path in
Obsidian, and only then perform the human Re-init checkpoint. The read-only replay auditor
rejects duplicate wipe/source/page/index effects, invalid retry lifecycles, timeout drift,
retry after content, and recovery that does not continue to the next step. A recovered
transport response may enter a correlated structured-repair lifecycle before successful
validation/application/completion. Page mutations count only after the matching successful
`tool_result`; metadata-only index checkpoints correlate both index reconciliation stages
to the active source and selected domain.

### Proxy

| Setting | Description | Default |
|---|---|---|
| Use proxy | Route OpenAI-compatible traffic through HTTP/HTTPS proxy. Not supported on mobile | off |
| Proxy URL | `http://proxy.example.com:8080` or `https://…` | — |
| Username | Optional, for basic-auth proxies | — |
| Password | Optional, stored locally in `local.json` | — |
| No-proxy hosts | CSV; supports exact host and `*.suffix`. Example: `localhost,127.0.0.1,*.internal` | — |

### Graph

| Setting | Description | Default |
|---|---|---|
| BFS depth | Query: hops from seed pages when collecting context. `0` = seeds only | `1` |
| Hub threshold | Lint: pages with more outgoing links than this are flagged as hubs | `20` |

### Developer (desktop only)

| Setting | Description | Default |
|---|---|---|
| Dev mode | Enable dev logger and evaluator after each operation | off |
| Evaluator model | Model used by the evaluator (same backend) | — |

---

## Sync

`local.json` (inside the plugin folder) stores the OpenAI API key, proxy password, model-context records, and other machine-local state. **Exclude `local.json` from sync** when using Obsidian Sync / git / Syncthing — otherwise settings will be overwritten on other machines.

The domain map (`!Wiki/_config/_domain.json`) lives inside the vault and syncs normally with your notes.

---

## Performance reference

Real-world measurements from a homelab inference server running **`deepseek-v4-flash:cloud`** through an OpenAI-compatible endpoint. Numbers show what to expect at roughly 100–130 output tokens/second — a mid-range local or self-hosted GPU.

| Operation | Typical duration | LLM calls | Input tokens (avg/call) | Output tokens (avg/call) | Speed (tok/s) |
|---|---|---|---|---|---|
| **Query** | 4–14 s | 1 | ~6 800 | ~470 | ~100 |
| **Ingest** (1 note) | ~25 s | 2 | ~4 300 | ~1 200 | ~109 |
| **Init** (6–24 source files) | 6–27 min | 20–35 per session | ~5 700 | ~2 600 | ~122 |
| **Lint** (large domain) | ~60 min | 69 | ~14 300 | ~6 500 | ~128 |

> **Init** and **Lint** scale with the number of source files and wiki pages. A domain with 6 files takes ~6 min; 24 files — ~27 min. Lint scanned a large domain (69 LLM calls) in about 60 min.

### What affects speed

- **Model** — smaller/quantized models are faster; larger models produce better wiki quality
- **Inference server** — a local GPU is fastest; cloud APIs add network latency
- **Domain size** — Init and Lint time grows linearly with the number of files
- **Oversized inputs** — bounded map/reduce, batching, and segmentation add calls to preserve complete coverage

---

## Documentation

- [docs/dev.md](docs/dev.md) — build, install, smoke-test checklist for developers
- [docs/README.ru.md](docs/README.ru.md) — Russian version of this README
