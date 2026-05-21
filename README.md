# AI Wiki — Obsidian Plugin

[Русская версия →](docs/README.ru.md)

Automatically builds and maintains a knowledge-base wiki from your notes using an LLM backend.

**Why AI Wiki:**
- **Offline by default** — Ollama or any OpenAI-compatible server; data never leaves your machine
- **Compounding** — each Ingest enriches the base; links and pages accumulate automatically
- **Transparency** — agent step progress visible live in the sidebar panel
- **Dual backends** — Native Agent (Ollama / OpenAI) and Claude Agent; switchable in settings

> Supported backends: **Ollama / OpenAI-compatible** (no cloud) · **Claude Agent** (Anthropic)

## What it does

- **Ingest** — parses a note, extracts entities (people, technologies, processes, terms), creates and updates wiki pages
- **Query** — answers a question against the knowledge base; optionally saves the answer as a new page with `[[WikiLinks]]`
- **Lint** — checks wiki-domain quality, finds incomplete and outdated pages
- **Fix** — sidebar action after Lint: takes an instruction, passes it to the model, updates pages
- **Init** — initializes a new domain from scratch (folder structure, `_schema.md`, `_index.md`)
- **Format** — analyzes an open markdown page (outside wiki domains), proposes formatting edits (frontmatter, headings, tables, mermaid, image captions). Preview is saved to `!Temp/`. Clarification via chat, **Apply**/**Cancel** buttons. Hard invariant: must not add/remove facts or distort meaning — only rephrase for clarity
- **Chat** — interactive chat in the sidebar panel; available after Lint and Query to refine results

Fix, Format and Chat are launched from sidebar buttons, not the Command Palette.

Progress of every operation is visible live in the Obsidian sidebar panel.

> **Mobile:** only Query works on mobile devices. Ingest, Lint, and Init are desktop-only. The Claude Agent backend on mobile automatically falls back to Native Agent.

---

## Security

### Shell Execution

AI Wiki spawns an external process to run the Claude CLI backend:

- **What is executed:** the absolute path you configure in Settings → Backend → "Path to Claude Code" (e.g. `/home/user/iclaude.sh`). The path is validated to be absolute and contain no traversal sequences before each spawn.
- **Why it's required:** the Claude Agent backend works by calling `claude` / `iclaude.sh` as a subprocess. There is no alternative to `child_process.spawn` for this architecture.
- **Your permissions:** the subprocess inherits your OS user's permissions — the same as running the Claude CLI manually in a terminal.
- **How to review / change the path:** Settings → Backend Settings → "Path to Claude Code".
- **First-run consent:** on first launch with `claude-agent` backend selected, a modal asks for explicit confirmation before any operation runs. You can revoke consent by removing `shellConsentGiven` from the plugin's `data.json`.

### Vault Access

The plugin reads only the folders you configure as "Source paths" for each domain. It does not enumerate your entire vault.

---

## Quick start: Native Agent (Ollama)

Requires no external accounts — the LLM runs locally.

### 1. Install Ollama

Download from [ollama.com](https://ollama.com) and run:

```bash
ollama pull llama3.2
```

### 2. Install the plugin

Copy the plugin folder into your vault:

```bash
# option — symlink for development
ln -s /path/to/obsidian-llm-wiki ~/.config/obsidian/Plugins/obsidian-llm-wiki
```

Or copy the folder manually to `<vault>/.obsidian/plugins/obsidian-llm-wiki/`.

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
| Max tokens | `4096` |

### 5. Create a domain

A domain is a pair of "sources folder → wiki folder". Command:

`Command Palette` → `AI Wiki: Init домена` → enter domain name (e.g. `work`) → uncheck Dry Run → run.

The plugin creates the folder structure and service files (`_schema.md`, `_index.md`).

### 6. First Ingest

1. Open any note in Obsidian
2. `Command Palette` → `AI Wiki: Ingestion активного файла`
3. Watch progress in the sidebar panel
4. When complete — new wiki pages appear in the domain folder

---

## Quick start: Claude Agent

For users with [Claude Code CLI](https://claude.ai/code) installed.

### 1. Requirements

- Installed `iclaude.sh` / `iclaude` / `claude` (Claude Code CLI)

### 2. Install the plugin

Same as steps 2–3 of the Native Agent section above.

### 3. Configure

Settings → AI Wiki:

| Setting | Value |
|---|---|
| Backend | Claude Agent |
| Path to Claude Code | `/home/user/Documents/Project/iclaude/iclaude.sh` |
| Model | `sonnet` |
| Timeouts (seconds) | `300/300/900/3600/600` |

### 4. First Ingest

Same as step 6 of the Native Agent section above.

---

## Commands

All commands are available via `Command Palette` (Ctrl+P / Cmd+P). Fix, Format, and Chat are sidebar buttons.

| Command | Action | Result |
|---|---|---|
| `AI Wiki: Открыть панель` | Show the sidebar panel | Live operation log, history |
| `AI Wiki: Ingestion активного файла` | Extract entities from current note | New/updated wiki pages *(desktop only)* |
| `AI Wiki: Запрос` | Ask a question against the knowledge base | Answer in panel with `[[WikiLinks]]` |
| `AI Wiki: Запрос и сохранить как страницу` | Question + save the answer | New wiki page, opens automatically |
| `AI Wiki: Lint домена` | Check wiki quality | Issue report in panel *(desktop only)* |
| `AI Wiki: Init домена` | Initialize a new domain | Wiki folder structure and service files *(desktop only)* |
| `AI Wiki: Отмена операции` | Stop the current operation | SIGTERM → SIGKILL after 3s |

---

## Settings reference

### General (both backends)

| Setting | Description | Default |
|---|---|---|
| User prompt | Appended to the system prompt of every operation | empty |
| Max tokens | Max tokens in response. Recommended ≥ 4096. Shown when per-operation is off and backend is native-agent | `4096` |
| Timeouts (seconds) | `ingest/query/lint/init/format`, slash-separated | `300/300/900/3600/600` |
| History limit | Max operations in sidebar history | `20` |
| Agent log (JSONL) | Log agent events to `<vault>/!Logs/agent.jsonl` (desktop only) | off |

### Domains

List of created domains with **Edit** / **Delete** buttons. Domain map stored in `!Wiki/_domain.json`.

### Backend selector

| Setting | Description | Default |
|---|---|---|
| Backend | `claude-agent` or `native-agent` (desktop). Mobile is forced to native-agent | `claude-agent` |

### Claude Agent

| Setting | Description | Default |
|---|---|---|
| Path to Claude Code | Full absolute path to `iclaude.sh` / `iclaude` / `claude` | — |
| Model | Preset (`opus`/`sonnet`/`haiku`) or explicit ID (`claude-opus-4-7`). Shown when per-operation is off | claude default |
| Allowed tools | Comma-separated list passed to `--tools`. Empty = no restriction | `Read,Edit,Write,Glob,Grep` |
| Per-operation models | Toggle. When on, configure model per operation (ingest/query/lint/init/format) | off |
| Per-operation: Model | Model name for the specific operation | — |

### Native Agent

| Setting | Description | Default |
|---|---|---|
| Base URL | OpenAI-compatible endpoint. Ollama: `http://localhost:11434/v1` | `http://localhost:11434/v1` |
| API key | `ollama` for Ollama; `sk-...` for OpenAI | `ollama` |
| Model | Model name (`llama3.2`, `mistral`, `gpt-4o`, …). Shown when per-operation is off | `llama3.2` |
| Context window (num_ctx) | Context size (Ollama only). Empty = model default | — |
| Temperature | `0.0`–`1.0`. Low (`0.1`–`0.3`) = precise facts | `0.2` |
| Per-operation models | Toggle (desktop only). When on, configure `model`/`maxTokens`/`temperature` per operation | off |
| Per-operation: Max tokens | Per-op max tokens. Defaults: ingest/query `4096`, lint/init `8192`, format `32768` | — |
| Per-operation: Temperature | Per-op temperature (0–2) | `0.2` |
| Structured output retries | Retries on schema validation failure (0–3). Higher = better success on weak models at cost of latency/tokens | `1` |

### Proxy (native-agent only)

| Setting | Description | Default |
|---|---|---|
| Use proxy | Route native-agent traffic through HTTP/HTTPS proxy. Not supported on mobile | off |
| Proxy URL | `http://proxy.example.com:8080` or `https://…` | — |
| Username | Optional, for basic-auth proxies | — |
| Password | Optional, stored locally in `local.json` | — |
| No-proxy hosts | CSV; supports exact host and `*.suffix`. Example: `localhost,127.0.0.1,*.internal` | — |

Proxy applies to native-agent only. Claude Agent uses its own configuration.

### Graph

| Setting | Description | Default |
|---|---|---|
| BFS depth (graphDepth) | Query: hops from seed pages. `0` = seeds only, max sensible `3` | `1` |
| Hub threshold (hubThreshold) | Lint: pages with more outgoing links than this are flagged as hubs | `20` |

### Dev mode (desktop only)

| Setting | Description | Default |
|---|---|---|
| Dev mode | Enable dev logger and evaluator after each operation | off |
| Evaluator model | Model name for the evaluator (same backend) | — |

---

## Sync

The `<plugin-dir>/local.json` file stores the machine-specific path to `iclaude.sh`. If you sync the `.obsidian/plugins/obsidian-llm-wiki/` folder with Obsidian Sync / git / Syncthing, exclude `local.json` from the sync — otherwise the path will be overwritten on other machines.

The domain map is stored in `!Wiki/_domain.json` (inside the vault) and syncs normally with your notes.

---

## Documentation

- [docs/dev.md](docs/dev.md) — build, install, smoke-test checklist for developers
- [docs/README.ru.md](docs/README.ru.md) — Russian version of this README
