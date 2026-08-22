---
review:
  spec_hash: 68a19be7aa1decf8
  last_run: 2026-08-22
  phases:
    structure: { status: passed }
    coverage: { status: passed }
    clarity: { status: passed }
    consistency: { status: passed }
  findings: []
chain:
  intent: docs/superpowers/intents/2026-08-21-agent-trace-release-guidelines-intent.md
---
# OpenAI-Only Backend Design

## Summary

AI Wiki will expose and execute one OpenAI-compatible runtime. The Claude Code backend, CLI process adapter, backend selector, Claude-specific settings, consent flow, current user documentation, and release-bundle markers will be removed. Legacy vault data remains readable without an automatic write during plugin load.

## Acceptance (from intent)

- Settings and user interface contain no Claude Code option or reference.
- A user with current OpenAI settings can complete an OpenAI request after the change.
- A vault with existing settings, including a former Claude Code selection, opens without a startup failure.
- Done when: Claude Code is absent from the product; a vault with legacy configuration starts; OpenAI works; and tests and build pass.

## Scope

The change covers persisted settings loading, effective settings, runtime routing, model-call policy, controller preflight, settings UI, translations, current user documentation, Claude-specific production and developer-tool source/tests, release validation, and iwiki architecture documentation.

Historical chain artifacts remain as audit records. They are not current product documentation and are not shipped in the plugin bundle. LM Studio support, a replacement backend, a new backend abstraction, publication, and Community directory submission are outside this change.

## Architecture

The runtime has no backend discriminator. `LlmWikiPluginSettings` contains shared settings and the current `nativeAgent` OpenAI-compatible configuration, while effective settings overlay local secrets such as the OpenAI API key and proxy password. Callers receive one settings shape and cannot select a Claude path.

`AgentRunner` constructs and uses the existing OpenAI-compatible transport for every operation. Controller preflight validates only OpenAI-compatible connection requirements. Model selection, budgets, context discovery, retries, diagnostics, and format behavior always use the OpenAI settings and no longer branch on a backend value.

The persisted settings loader is a whitelist boundary. It copies supported top-level fields, nested operation controls, and current OpenAI settings over defaults. It does not spread unknown top-level keys into the live object.

## Legacy Data Flow

On plugin load, stored `backend`, `claudeAgent`, Claude model/path/tool fields, and shell-consent fields are ignored. A stored `nativeAgent` object is merged into current defaults using the same nested operation merge contract used for valid current settings.

Loading legacy data does not call `saveData` solely because Claude fields exist. The in-memory configuration uses OpenAI immediately. A later ordinary settings save serializes the current settings object, so obsolete Claude fields disappear at that user-triggered write boundary.

Local configuration loading follows the same rule. Runtime code no longer reads `iclaudePath`, local backend selection, or shell consent. Current local secrets and model-context records remain available. A normal later local-config save emits only the supported local shape.

## Components

### Settings model and normalization

`src/types.ts` removes the backend union, Claude operation types, and `claudeAgent` settings. `src/main.ts` loads only supported fields and preserves current nested OpenAI operation settings. `src/effective-settings.ts` overlays local secrets without choosing a backend. `src/local-config.ts` exposes only supported local fields.

`src/model-call-policy.ts`, `src/auto-budget-notice.ts`, and callers resolve policy from OpenAI settings only. Existing OpenAI budget, context-window, structured-retry, proxy, and per-operation behavior remains unchanged.

### Runtime and controller

`src/agent-runner.ts` removes Claude client construction, Claude-only retry/watchdog behavior, backend-specific log labels, and backend-specific vision/format decisions. `src/controller.ts` removes Claude executable checks, shell-consent prompts, and Claude model selection. Runtime preflight continues to reject missing or invalid OpenAI connection settings with the existing explicit error surface.

`src/claude-cli-client.ts` and its Claude-specific tests are deleted. No production source imports `node:child_process` for an LLM backend after the change.

The out-of-vault Claude binary probe is deleted. The DSPy optimizer keeps its existing Ollama/OpenAI-compatible modes but removes `ClaudeCodeLM`, its subprocess call, environment controls, tests, and current backend documentation. Executable audit/eval fixtures accept only the remaining OpenAI-compatible settings and transport values.

### Settings UI and language resources

`src/settings.ts` renders OpenAI connection and model controls directly. It contains no backend dropdown or Claude section. `src/i18n.ts` removes labels and descriptions that exist only for Claude Code, the CLI path, shell consent, or backend comparison.

### Documentation and release validation

`README.md`, `docs/README.ru.md`, and other current user guides describe the OpenAI-compatible connection as the only runtime. They do not claim LM Studio support. Historical material under `docs/superpowers/` may retain old names for traceability.

`scripts/validate-release.mjs` rejects a built `main.js` containing Claude backend markers or `node:child_process`. Its existing manifest, disclosure, asset, and source-map checks remain intact.

## Requirements

### R1 — Single runtime contract

Production types, effective settings, controller flow, `AgentRunner`, and active developer utilities must expose only OpenAI-compatible execution. No executable Claude Code route or replacement backend abstraction may remain.

Acceptance: TypeScript compiles without a backend union; focused runtime tests observe one OpenAI transport; production source contains no import of the deleted Claude CLI client; the out-of-vault Claude probe is absent; DSPy backend tests expose only Ollama/OpenAI-compatible modes.

### R2 — Safe legacy loading

A vault whose persisted data selects `claude-agent` must load without throwing, must use OpenAI in memory, and must retain valid stored `nativeAgent` values. Plugin load must not persist data solely to remove Claude fields.

Acceptance: a loader regression test supplies legacy Claude and current OpenAI fields, asserts the effective OpenAI values, and asserts zero migration writes during load.

### R3 — User-triggered schema cleanup

An ordinary later settings save must serialize only the current settings schema. A normal later local-config save must serialize only supported local fields. Neither save may delete current OpenAI secrets, proxy values, or model-context records.

Acceptance: persistence tests verify obsolete Claude fields are absent and current supported values remain byte-for-byte equivalent after the save boundary.

### R4 — No Claude UI or current documentation

Settings UI, current translations, README files, current guides, and active developer-tool documentation must contain no Claude backend option, CLI path control, consent prompt, or claim of dual-backend support.

Acceptance: settings source assertions and a scoped repository scan pass; historical chain artifacts are the only allowed documentation exception.

### R5 — Release-bundle guard

Release validation must fail when the built plugin bundle contains a Claude backend marker or `node:child_process`, and must pass for the OpenAI-only bundle while retaining all existing release checks.

Acceptance: focused release-validator fixtures prove both rejection cases and the valid case.

### R6 — OpenAI behavior preservation

Existing OpenAI model controls, per-operation settings, prompt budgets, context discovery, structured-output retries, proxy behavior, diagnostics, and operation flows must retain their current observable behavior.

Acceptance: affected focused tests, the complete test suite, lint, typecheck, build, prebuild release validation, and postbuild release validation pass without a new failure.

### R7 — Scope and delivery boundaries

The implementation must preserve the existing uncommitted release-validation changes on `dev-agent-trace-release-guidelines`. It must not add LM Studio behavior, publish the plugin, submit Community directory data, or delete user data during load.

Acceptance: result reconciliation maps every changed path to R1–R7, reports no implementation path for LM Studio or publication, and shows the prior release checks still passing.

## Error Handling

Unknown or malformed legacy Claude fields are ignored at the whitelist boundary and cannot block startup. Malformed supported OpenAI fields continue through current normalization and validation. Missing or invalid OpenAI connection data produces the existing user-visible preflight/runtime error rather than falling back to another backend.

Any implementation that requires an automatic destructive migration, loses supported OpenAI values, or cannot load the legacy fixture violates the intent stop rules and must halt for user review.

## Test Strategy

Focused tests cover settings shape, whitelist loading, absence of automatic persistence, ordinary-save cleanup, effective settings, controller preflight, runner transport selection, model-call policy, UI source, translations, current documentation, DSPy backend selection, and release-bundle rejection.

Claude-only tests are deleted when their production subject is deleted. Tests that cover shared behavior are converted to OpenAI-only fixtures instead of removed. Broad verification runs the full suite and every existing static/build/release gate.

## Documentation Strategy

Repository documentation and the bound iwiki domain must state that OpenAI-compatible transport is the sole runtime, explain the non-writing legacy-load behavior, and distinguish historical audit artifacts from current product documentation. Release documentation must state that the bundle guard blocks Claude backend markers and Node subprocess transport.

## Risks and Mitigations

- Legacy values could leak into live settings through a broad object spread. The loader uses explicit supported-field construction and a regression fixture with unknown keys.
- Removing backend branches could accidentally remove shared behavior. Shared tests are converted before Claude-only code is deleted, and OpenAI-focused regressions cover budgets, retries, context, vision, format, and diagnostics.
- A hidden executable adapter could survive outside the plugin runtime. Scoped scans include active `src/`, `eval/`, and developer-tool paths while excluding historical audit artifacts and repository agent instructions.
- Ordinary local-config save could drop supported opaque records. Persistence tests cover API key, proxy password, migration flags, last domain, and model-context records.
- A textual cleanup could remove historical evidence or unrelated developer instructions. Scans distinguish current product/runtime surfaces from historical chain artifacts and repository agent instructions.
- Release work already present in the branch could be overwritten. Result reconciliation treats those paths as preserved upstream work and reruns their focused and full gates.

## Human Checkpoints

Changing OpenAI user experience, adding LM Studio, introducing any other backend, deleting user data automatically, committing implementation, pushing, publishing, or submitting Community directory information requires separate approval. This design and its plan stop before implementation.
