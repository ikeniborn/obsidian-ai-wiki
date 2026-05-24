# AI Wiki — Knowledge Graph Index

AI Wiki is an Obsidian plugin that builds and maintains domain wikis from raw notes using an LLM backend.

- [[architecture]] — Plugin structure: entry point, controller, AgentRunner, backends, VaultTools, settings
- [[domain]] — Domain model: DomainEntry, EntityType, wiki folder layout, domain events
- [[operations]] — The seven wiki operations: init, ingest, query, lint, lint-chat, chat, format
- [[llm-pipeline]] — LLM call assembly, parseWithRetry, streaming, wrapWithJsonFallback
- [[wiki-graph]] — Wiki graph structure, BFS expansion for query, graph cache, structural checks
