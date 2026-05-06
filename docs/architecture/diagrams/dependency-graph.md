# Dependency Graph — obsidian-llm-wiki

## Component Dependencies

```mermaid
graph TD
    main["main.ts\nLlmWikiPlugin\n(entry point)"]
    controller["controller.ts\nWikiController\n(orchestrator)"]
    view["view.ts\nLlmWikiView\n(ItemView)"]
    settings["settings.ts\nLlmWikiSettingTab"]
    modals["modals.ts\nQueryModal / DomainModal\n/ FileErrorModal / ConfirmModal"]
    runner["agent-runner.ts\nAgentRunner"]
    phases["phases/\ningest · query · lint\nfix · init · chat · evaluator"]
    cli_client["claude-cli-client.ts\nClaudeCliClient"]
    stream["stream.ts\nparseStreamLine()"]
    vault_tools["vault-tools.ts\nVaultTools"]
    domain_map["domain-map.ts\nDomainEntry · EntityType"]
    source_paths["source-paths.ts\nconsolidateSourcePaths()"]
    types["types.ts\nRunEvent · WikiOperation\nLlmWikiPluginSettings"]
    i18n["i18n.ts\nрусский / английский"]

    main --> controller
    main --> view
    main --> settings
    main --> modals
    main --> types

    controller --> runner
    controller --> view
    controller --> cli_client
    controller --> vault_tools
    controller --> domain_map
    controller --> source_paths
    controller --> modals
    controller --> i18n

    runner --> phases
    runner --> types
    runner --> vault_tools
    runner --> domain_map

    cli_client --> stream
    cli_client --> types

    phases --> vault_tools
    phases --> types
    phases --> domain_map

    view --> types
    view --> i18n
    view --> modals
    view --> domain_map

    settings --> types
    settings --> i18n
    settings --> modals

    style main fill:#fff4e1
    style controller fill:#fff4e1
    style runner fill:#e1ffe1
    style cli_client fill:#e1ffe1
    style phases fill:#e1ffe1
    style view fill:#e1f5ff
    style settings fill:#e1f5ff
    style modals fill:#e1f5ff
    style stream fill:#f0f0f0
    style types fill:#f0f0f0
    style domain_map fill:#f0f0f0
    style vault_tools fill:#f0f0f0
    style source_paths fill:#f0f0f0
    style i18n fill:#f0f0f0
```

## Layer Legend

| Color | Layer | Modules |
|-------|-------|---------|
| Light yellow | Application (orchestration) | main.ts, controller.ts |
| Light green | Infrastructure (I/O, LLM) | agent-runner.ts, claude-cli-client.ts, phases/ |
| Light blue | Presentation (UI) | view.ts, settings.ts, modals.ts |
| Gray | Shared / Domain | types.ts, domain-map.ts, vault-tools.ts, stream.ts, source-paths.ts, i18n.ts |
