# AI Wiki — Obsidian Plugin

[Русская версия →](docs/README.ru.md)

Automatically builds and maintains a knowledge-base wiki from your notes using an AI assistant.

**Why AI Wiki:**
- **Offline by default** — works with Ollama or any local AI server; your notes never leave your machine
- **Grows with your notes** — every Ingest adds new topics and updates existing ones automatically
- **Transparent** — watch every AI step in real time in the sidebar panel
- **Two AI backends** — local (Ollama / OpenAI-compatible) or Claude AI; switch any time in settings

> Supported backends: **Ollama / OpenAI-compatible** (fully local) · **Claude Agent** (Anthropic cloud)

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

## Security

### Shell execution

The Claude Agent backend starts an external process to run the Claude CLI:

- **What is executed:** the absolute path you configure in Settings → "Path to Claude Code" (e.g. `/home/user/iclaude.sh`). The path is validated to be absolute and free of traversal sequences before each spawn.
- **Why it's required:** the Claude Agent backend calls `claude` / `iclaude.sh` as a subprocess. There is no alternative to `child_process.spawn` for this architecture.
- **Your permissions:** the subprocess inherits your OS user's permissions — the same as running Claude CLI manually in a terminal.
- **First-run consent:** on first launch with Claude Agent selected, a confirmation dialog appears before anything runs. You can revoke consent by removing `shellConsentGiven` from the plugin's `local.json`.

### Vault access

The plugin reads only the folders you set as sources for each domain. It does not scan your entire vault.

---

## Quick start: Ollama (fully local)

No accounts or cloud services required — AI runs on your computer.

### 1. Install Ollama

Download from [ollama.com](https://ollama.com) and pull a model:

```bash
ollama pull llama3.2
```

### 2. Install the plugin

Copy the plugin folder into your vault:

```bash
# symlink for development
ln -s /path/to/obsidian-ai-wiki ~/.config/obsidian/Plugins/obsidian-ai-wiki
```

Or copy the folder to `<vault>/.obsidian/plugins/obsidian-ai-wiki/` manually.

### 3. Enable the plugin

Obsidian → Settings → Community plugins → find "AI Wiki" → enable.

### 4. Configure

Settings → AI Wiki:

| Setting | Value |
|---|---|
| Backend | Native Agent (OpenAI-compatible) |
| Base URL | `http://localhost:11434/v1` |
| API Key | `ollama` |
| Model | `llama3.2` |
| Temperature | `0.2` |
| Input budget tokens | `16384` |
| Output budget tokens | `4096` |
| Semantic compression | `Balanced` |

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

## Quick start: Claude Agent

For users with [Claude Code CLI](https://claude.ai/code) installed.

### 1. Requirements

- Installed `iclaude.sh` / `iclaude` / `claude` (Claude Code CLI)

### 2. Install and enable the plugin

Same as steps 2–3 of the Ollama section above.

### 3. Configure

Settings → AI Wiki:

| Setting | Value |
|---|---|
| Backend | Claude Agent |
| Path to Claude Code | `/home/user/Documents/Project/iclaude/iclaude.sh` |
| Model | `sonnet` |
| Timeouts (seconds) | `300/300/900/3600/600` |

### 4. First Ingest

Same as step 6 of the Ollama section above.

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

For Native Agent, a replacement transport attempt starts a fresh human lifecycle at
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

### General (both backends)

| Setting | Description | Default |
|---|---|---|
| User prompt | Added to the system prompt of every operation | empty |
| Timeouts (seconds) | `ingest/query/lint/init/format`, slash-separated | `300/300/900/3600/600` |
| LLM idle timeout | Maximum silence between meaningful native model events; `0` disables the executor idle deadline | `300` s |
| Retry count | Backend-specific: native additional attempts per request; Claude guarded idle retries per operation | `3` |
| History limit | Max operations in sidebar history | `20` |
| Agent log (JSONL) | Log agent events to plugin-local `agent.jsonl` (desktop only) | off |

### Domains

List of created domains with **Edit** / **Delete** buttons. Domain map is stored in `!Wiki/_config/_domain.json`.

### Backend selector

| Setting | Description | Default |
|---|---|---|
| Backend | `claude-agent` or `native-agent` (desktop). Mobile is forced to native-agent | `native-agent` |

### Claude Agent

| Setting | Description | Default |
|---|---|---|
| Path to Claude Code | Full absolute path to `iclaude.sh` / `iclaude` / `claude` | — |
| Model | Preset (`opus`/`sonnet`/`haiku`) or explicit ID (`claude-sonnet-4-6`). Shown when per-operation is off | claude default |
| Input budget tokens | Maximum estimated size of the packed prompt. This is configured explicitly; the plugin does not discover the model's context window | `16384` |
| Semantic compression | Prompt-density profile (`Maximum`/`Balanced`/`Minimum`) with operation-specific preservation rules | `Balanced` |
| Allowed tools | Comma-separated list passed to `--tools`. Empty = no restriction | `Read,Edit,Write,Glob,Grep` |
| Per-operation models | When on, configure model, input budget, compression, and effort per operation (ingest/query/lint/init/format). Format has an input budget but no semantic-compression control | off |
| Per-operation: Model | Model for the specific operation | — |

Claude output limits are owned by the external Claude CLI configuration. AI Wiki bounds
and packs Claude input, but does not send or expose a plugin-owned Claude output budget.
Claude keeps its existing guarded operation-level idle retry behavior; it does not use
Native Agent's request executor, HTTP status matrix, or connection-timeout transport.

### Native Agent

| Setting | Description | Default |
|---|---|---|
| Base URL | OpenAI-compatible endpoint. Ollama: `http://localhost:11434/v1` | `http://localhost:11434/v1` |
| API key | `ollama` for Ollama; `sk-...` for OpenAI | `ollama` |
| Connection timeout | Desktop DNS/TCP/TLS establishment only; it does not cap response headers, body, or generation | `15` s |
| Input budget tokens | Maximum estimated size of the packed prompt. This is configured explicitly; the plugin does not discover the model's context window | `16384` |
| Output budget tokens | Response cap sent through the existing `maxTokens`/API `max_tokens` setting | `4096` |
| Semantic compression | Prompt-density profile (`Maximum`/`Balanced`/`Minimum`) with operation-specific preservation rules | `Balanced` |
| Model | Model name (`llama3.2`, `mistral`, `gpt-4o`, …). Shown when per-operation is off | `llama3.2` |
| Thinking budget tokens | Separate native model reasoning allowance; `0` or empty disables it. It does not increase the input budget | off |
| Temperature | `0.0`–`1.0`. Low values (`0.1`–`0.3`) give more precise, factual answers | `0.2` |
| Per-operation models | When on, configure model, input/output budgets, compression, thinking budget, and temperature per operation. Format keeps numeric budgets but has no semantic-compression control | off |
| Output repair retries | Retries for invalid JSON or invalid framed output after Zod validation (0–3). Higher = more reliable on weaker models | `1` |

### Native transient request recovery

Native Agent retries only the current identical OpenAI-compatible request, up to the
configured number of additional attempts. It never replays Init, Re-init, Ingest, a source
read, `WipeDomain`, completed evidence, or page/index application. Eligible failures are
connection errors/timeouts and HTTP `408`, `409`, `429`, and `5xx`. Provider
`x-should-retry: true` can opt in another transient response; `x-should-retry: false`
always opts out. HTTP `400`, `401`, `403`, `404`, and `422`, context-limit and schema
failures, cancellation, permanent TLS/certificate errors, and application/index/embedding
failures are not transport-retried.

Retry stops after nonblank reasoning or content, or when the additional-attempt bound is
exhausted. Connection timeout (`15` seconds), model idle timeout (`300` seconds), and
retry count (`3`) are independent top-level settings; existing persisted values are
preserved. A healthy response may take longer than 15 seconds because that value applies
only to desktop connection establishment. On Mobile, Native Agent keeps the host-provided
transport, so an exact DNS/TCP/TLS-only timeout cannot be guaranteed; request retry and
model-idle handling remain separate from that limitation.

### Vision

| Setting | Description | Default |
|---|---|---|
| Enable image analysis | Analyze supported images and PDF pages during Format | off |
| Semantic compression | Vision-specific override; preserves OCR, objects, relationships, layout, page identity, and uncertainty | Use global |
| Vision model | Multimodal model used for image analysis | — |
| Vision Check | Native Agent only: sends one real, tiny 1×1 inline PNG request with a short prompt and a 16-token output cap. Reports success/failure without changing settings or vault files. Claude Agent exposes no Check | — |

### Bounded processing and storage

These controls cover different parts of a call: **Input budget tokens** bound the prepared
request, **Output budget tokens** cap the generated response, and **Thinking budget
tokens** separately allow native-model reasoning when the provider supports it. Native
Agent owns all three controls; Claude input is governed by AI Wiki while Claude output
remains CLI-owned.

The input budget governs the complete prepared request, including system/schema
instructions—not just note text. When content does not fit, AI Wiki packs complete context
units and uses operation-specific batching or splitting instead of silently truncating
required content. Provider context errors can trigger a smaller repack. The configured
budget remains explicit; AI Wiki does not automatically discover a model's context
window.

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

Destructive Re-init acceptance must use a private copied vault, never the working vault.
The protected replay root must be a recent `/tmp/ai-wiki-bounded-ingest-replay.*`
directory with an owner-only `.replay-provenance` marker that records the resolved source
and replay root. Install the build into its `run` copy, visibly confirm that vault path in
Obsidian, and only then perform the human Re-init checkpoint. The read-only replay auditor
rejects duplicate wipe/source/page/index effects, invalid retry lifecycles, timeout drift,
retry after content, and recovery that does not continue to the next step.

### Proxy (native-agent only)

| Setting | Description | Default |
|---|---|---|
| Use proxy | Route native-agent traffic through HTTP/HTTPS proxy. Not supported on mobile | off |
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

`local.json` (inside the plugin folder) stores machine-specific settings: the path to Claude CLI, API key, and selected backend. **Exclude `local.json` from sync** when using Obsidian Sync / git / Syncthing — otherwise settings will be overwritten on other machines.

The domain map (`!Wiki/_config/_domain.json`) lives inside the vault and syncs normally with your notes.

---

## Performance reference

Real-world measurements from a homelab inference server running **`deepseek-v4-flash:cloud`** via Native Agent (OpenAI-compatible endpoint). Numbers show what to expect at roughly 100–130 output tokens/second — a mid-range local or self-hosted GPU.

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
