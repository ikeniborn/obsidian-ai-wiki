# Data Flow — obsidian-llm-wiki

## Operation Execution Flow

```mermaid
sequenceDiagram
    actor User
    participant View as LlmWikiView
    participant Ctrl as WikiController
    participant Runner as AgentRunner
    participant Phases as phases/*
    participant LLM as LlmClient
    participant Vault as VaultTools

    User->>View: нажимает кнопку (ingest/query/lint/init)
    View->>Ctrl: ingestActive() / query() / lint() / init()

    alt isBusy()
        Ctrl-->>View: Notice("операция уже выполняется")
    else
        Ctrl->>Ctrl: AbortController создан
        Ctrl->>Runner: buildAgentRunner(vaultRoot)
        Ctrl->>View: setRunning(op, args)

        Ctrl->>Runner: run(RunRequest) → AsyncGenerator<RunEvent>

        loop for await ev of runGen
            Runner->>Phases: runIngest / runQuery / runLint …
            Phases->>LLM: chat.completions.create(…)
            LLM-->>Phases: stream chunks
            Phases-->>Runner: yield RunEvent
            Runner-->>Ctrl: RunEvent
            Ctrl->>View: appendEvent(ev)

            alt ev.kind == domain_created
                Ctrl->>Ctrl: settings.domains.push(ev.entry)
                Ctrl->>Ctrl: saveSettings()
            end
            alt ev.kind == source_path_added
                Ctrl->>Ctrl: consolidateSourcePaths(…)
                Ctrl->>Ctrl: saveSettings()
            end
        end

        Ctrl->>Ctrl: history.push(entry), saveSettings()
        Ctrl->>View: finish(entry)
    end
```

## Claude CLI Backend: Stream Parsing

```mermaid
sequenceDiagram
    participant Ctrl as WikiController
    participant CLI as ClaudeCliClient
    participant Proc as iclaude.sh (child process)
    participant Parser as parseStreamLine()

    Ctrl->>CLI: chat.completions.create(params)
    CLI->>Proc: spawn(iclaudePath, args, {stdio: ["ignore","pipe","pipe"]})

    loop readline по stdout
        Proc-->>CLI: JSON-строка (stream-json)
        CLI->>Parser: parseStreamLine(raw)
        Parser-->>CLI: RunEvent | null
        CLI-->>Ctrl: AsyncIterable<ChatCompletionChunk>
    end

    Proc-->>CLI: exit code
    CLI->>Proc: SIGTERM (при abort)
    Note over CLI,Proc: grace 3000ms → SIGKILL
```

## Format Operation: Preview → Refine → Apply (v0.1.62+)

```mermaid
sequenceDiagram
    actor User
    participant View as LlmWikiView
    participant Ctrl as WikiController
    participant Runner as AgentRunner
    participant Phase as runFormat
    participant Utils as format-utils
    participant LLM as LlmClient
    participant Vault as VaultTools

    User->>View: нажимает Format на не-wiki .md
    View->>Ctrl: format()

    alt файл внутри wiki-домена
        Ctrl->>View: ConfirmModal "re-ingest from wiki_sources?"
        View-->>User: предложение запустить ingest
    else файл вне wiki
        Ctrl->>Ctrl: _pendingFormat = {originalPath, tempPath:"", chat:[]}
        Ctrl->>Runner: dispatch("format", [path], chatMessages=[])
        Runner->>Phase: runFormat(args, vaultTools, llm, hasVision, chatHistory, signal)
        Phase->>Vault: read(originalPath)
        Phase->>LLM: chat.completions.create(messages, stream=true)
        LLM-->>Phase: stream chunks → yield assistant_text
        Phase->>Utils: extractJsonObject(fullText) → {report, formatted}
        Phase->>Utils: missingTokens(original, formatted)
        Phase->>Vault: mkdir(!Temp), write(!Temp/<basename>.formatted.md)
        Phase-->>Ctrl: yield format_preview {tempPath, report, missingTokens}
        Ctrl->>Ctrl: _pendingFormat.tempPath = tempPath; chat.push({role:"assistant", content:report})
        Ctrl->>View: appendEvent(format_preview) → renderFormatPreview()
        View-->>User: preview-блок с Apply/Cancel/Refine chat
    end

    alt Refine (User вводит уточнение)
        User->>View: текст в format-chat
        View->>Ctrl: formatRefine(message)
        Ctrl->>Ctrl: _pendingFormat.chat.push({role:"user", content:message})
        Ctrl->>Runner: dispatch("format", [originalPath], chatMessages=_pendingFormat.chat)
        Note over Phase: повторный цикл LLM → новый format_preview
    else Apply
        User->>View: click Apply
        View->>Ctrl: formatApply()
        Ctrl->>Vault: read(tempPath) → write(originalPath) → remove(tempPath)
        Ctrl->>View: emit format_applied → renderFormatPreview cleanup
    else Cancel
        User->>View: click Cancel
        View->>Ctrl: formatCancel()
        Ctrl->>Vault: remove(tempPath)
        Ctrl->>View: emit format_cancelled → renderFormatPreview cleanup
    end
```

Note: `Apply` дисейблится в UI при `missingTokens.length > 0` — защита от потери значимой информации (числа, URL, имена, code identifiers).

## Backend Strategy

```mermaid
graph LR
    settings["settings.backend"]
    claude["claude-agent\n→ ClaudeCliClient\n→ iclaude.sh spawn"]
    native["native-agent\n→ OpenAI client\n→ HTTP API (Ollama / OpenAI)"]

    settings -- "claude-agent" --> claude
    settings -- "native-agent" --> native

    claude --> stream_json["stream-json stdout\nparseStreamLine()"]
    native --> openai_stream["OpenAI streaming API\nChatCompletionChunk"]
```
