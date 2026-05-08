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
    phases["phases/\ningest · query · lint\nfix · init · chat\nevaluator · format"]
    format_utils["phases/format-utils.ts\nextractJsonObject\nsignificantTokens\nmissingTokens"]
    wiki_path["wiki-path.ts\ndomainWikiFolder()"]
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
    controller --> wiki_path

    runner --> phases
    runner --> types
    runner --> vault_tools
    runner --> domain_map

    cli_client --> stream
    cli_client --> types

    phases --> vault_tools
    phases --> types
    phases --> domain_map
    phases --> format_utils

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
    style format_utils fill:#f0f0f0
    style wiki_path fill:#f0f0f0
```

## Layer Legend

| Color | Layer | Modules |
|-------|-------|---------|
| Light yellow | Application (orchestration) | main.ts, controller.ts |
| Light green | Infrastructure (I/O, LLM) | agent-runner.ts, claude-cli-client.ts, phases/ |
| Light blue | Presentation (UI) | view.ts, settings.ts, modals.ts |
| Gray | Shared / Domain | types.ts, domain-map.ts, vault-tools.ts, stream.ts, source-paths.ts, i18n.ts, wiki-path.ts, phases/format-utils.ts |

## Mobile-Safe Boundary (v0.1.59+)

Импорты `node:fs`, `node:path`, `node:child_process`, `./claude-cli-client` лежат за асинхронным `await import(...)` внутри desktop-only веток. Static-test `tests/no-fs-imports.test.ts` ловит регрессии.

```mermaid
graph LR
    main_ts[main.ts] -- "Platform.isMobile?" --> mobile{mobile}
    mobile -- "yes" --> mobile_path[skip ingest/lint/init<br/>force native-agent]
    mobile -- "no" --> desktop_path[register all commands<br/>any backend]
    controller[controller.ts] -- "backend === claude-agent" --> claude_dyn[await import node:fs/path<br/>await import claude-cli-client]
    controller -- "backend === native-agent" --> openai[OpenAI SDK<br/>HTTPS only]
    agent_runner[agent-runner.ts] -- "devMode + !mobile" --> dev_log[await import node:fs/path<br/>writeDevLog]

    style mobile_path fill:#fff4e1
    style desktop_path fill:#e1ffe1
    style claude_dyn fill:#e1ffe1
    style openai fill:#e1f5ff
    style dev_log fill:#e1ffe1
```

## Format Operation Flow (v0.1.62+)

```mermaid
graph LR
    btn[view.ts<br/>Format button] --> ctrl_format[controller.format]
    ctrl_format -- "file in wiki?" --> wiki_check{domainWikiFolder match?}
    wiki_check -- yes --> confirm_modal[ConfirmModal<br/>→ suggestIngestForWikiFile]
    wiki_check -- no --> dispatch_format[dispatch 'format']
    dispatch_format --> run_format[runFormat<br/>phases/format.ts]
    run_format --> llm_call[LlmClient.chat.completions.create<br/>+ image_url parts when vision]
    llm_call --> json_extract[extractJsonObject<br/>format-utils.ts]
    json_extract --> validator[missingTokens<br/>significantTokens]
    validator --> temp_write[VaultTools.write<br/>!Temp/&lt;basename&gt;.formatted.md]
    temp_write --> emit_preview[yield format_preview<br/>→ view.renderFormatPreview]
    emit_preview --> apply[Apply: read temp<br/>→ write original<br/>→ remove temp]
    emit_preview --> cancel[Cancel: remove temp]
    emit_preview --> refine[Refine chat:<br/>push user msg → re-dispatch]
    refine --> run_format

    style ctrl_format fill:#fff4e1
    style run_format fill:#e1ffe1
    style validator fill:#f0f0f0
    style emit_preview fill:#e1f5ff
```
