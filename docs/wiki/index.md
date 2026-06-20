# AI Wiki — Project Overview

AI Wiki is an Obsidian plugin that builds and maintains a structured knowledge-base wiki from raw notes using an LLM backend. It reads notes, extracts topics, and keeps cross-linked wiki pages up to date. This wiki documents its architecture, operations, and design decisions.

## What it does

Seven user operations turn notes into a living domain wiki. Each maps to a phase function and produces specific vault artifacts. See [[operations]] for the full set.

| Operation | Effect |
|---|---|
| **Init** | Bootstraps a new domain (folder layout, entity types, index) |
| **Ingest** | Reads a note, extracts entities, creates/updates wiki pages |
| **Query** | Answers a question using the wiki as retrieval context |
| **Lint** | Reviews pages for gaps, stale content, broken links |
| **Lint-Chat / Fix** | Applies corrections from a lint report via sidebar chat |
| **Format** | Cleans up any markdown note without changing facts |
| **Chat** | Free-form follow-up after Query or Lint |

Mobile runs Query and Format (Format with image-only vision); Ingest, Lint, and Init are desktop-only.

## Architecture map

Core flow: Plugin → Controller → AgentRunner → phase functions → vault writes. Two LLM backends (native OpenAI-compatible, or Claude CLI) are selected in settings.

- [[architecture]] — plugin entry, controller, runner, phases, backends, vault tools, settings.
- [[operations]] — the seven operations and their per-phase behavior.
- [[llm-pipeline]] — how LLM calls are assembled, validated, and streamed.
- [[domain-model]] — domains, entity types, wiki folder layout, schemas.
- [[retrieval]] — page similarity, embeddings, wiki graph, BFS expansion.
- [[backends-and-config]] — native vs Claude backends, split settings stores.

## Source layout

TypeScript plugin. Entry `src/main.ts`; orchestration `src/controller.ts`; execution `src/agent-runner.ts`; operations in `src/phases/`; prompts in `prompts/*.md`; bundled schemas in `templates/`.
