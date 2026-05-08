"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/stream.ts
function isRecord(obj) {
  return typeof obj === "object" && obj !== null;
}
function parseStreamLine(raw) {
  const trimmed = raw.trim();
  if (!trimmed)
    return null;
  if (!trimmed.startsWith("{"))
    return null;
  let obj;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    return { kind: "error", message: `stream parse error: ${truncate2(trimmed, 120)}` };
  }
  if (!isRecord(obj))
    return null;
  switch (obj.type) {
    case "system": {
      const subtype = typeof obj.subtype === "string" ? obj.subtype : "system";
      const model = typeof obj.model === "string" ? obj.model : "";
      const sessionId = typeof obj.session_id === "string" ? obj.session_id : void 0;
      const msg = `${subtype}${model ? ` (${model})` : ""}`;
      return { kind: "system", message: msg, sessionId };
    }
    case "assistant":
      return mapAssistant(obj);
    case "user":
      return mapUserToolResult(obj);
    case "result":
      return mapResult(obj);
    default:
      return null;
  }
}
function mapAssistant(obj) {
  const msg = obj.message;
  if (!isRecord(msg))
    return null;
  const content = msg.content;
  if (!Array.isArray(content) || content.length === 0)
    return null;
  const block = content[0];
  if (block?.type === "tool_use") {
    if (block.name === "AskUserQuestion") {
      const input = isRecord(block.input) ? block.input : {};
      return {
        kind: "ask_user",
        question: typeof input.prompt === "string" ? input.prompt : "",
        options: Array.isArray(input.options) ? input.options.map((o) => typeof o === "string" ? o : String(o)) : [],
        toolUseId: typeof block.id === "string" ? block.id : ""
      };
    }
    return { kind: "tool_use", name: typeof block.name === "string" ? block.name : "?", input: block.input };
  }
  if (block?.type === "text") {
    return { kind: "assistant_text", delta: typeof block.text === "string" ? block.text : "" };
  }
  return null;
}
function mapUserToolResult(obj) {
  const msg = obj.message;
  if (!isRecord(msg))
    return null;
  const content = msg.content;
  if (!Array.isArray(content))
    return null;
  const block = content[0];
  if (!isRecord(block) || block.type !== "tool_result")
    return null;
  const isErr = Boolean(block.is_error);
  const preview = typeof block.content === "string" ? truncate2(block.content, PREVIEW_MAX) : void 0;
  return { kind: "tool_result", ok: !isErr, preview };
}
function mapResult(obj) {
  if (obj.is_error || obj.subtype === "error") {
    const errMsg = typeof obj.result === "string" ? obj.result : typeof obj.error === "string" ? obj.error : "claude error";
    return { kind: "error", message: errMsg };
  }
  return {
    kind: "result",
    durationMs: Number(obj.duration_ms ?? 0),
    usdCost: typeof obj.total_cost_usd === "number" ? obj.total_cost_usd : void 0,
    text: typeof obj.result === "string" ? obj.result : ""
  };
}
function truncate2(s, n) {
  return s.length <= n ? s : s.slice(0, n) + "\u2026";
}
var PREVIEW_MAX;
var init_stream = __esm({
  "src/stream.ts"() {
    "use strict";
    PREVIEW_MAX = 200;
  }
});

// src/claude-cli-client.ts
var claude_cli_client_exports = {};
__export(claude_cli_client_exports, {
  ClaudeCliClient: () => ClaudeCliClient
});
var import_node_child_process, import_node_fs, import_node_path5, import_node_readline, SIGTERM_GRACE_MS, ClaudeCliClient;
var init_claude_cli_client = __esm({
  "src/claude-cli-client.ts"() {
    "use strict";
    import_node_child_process = require("node:child_process");
    import_node_fs = require("node:fs");
    import_node_path5 = require("node:path");
    import_node_readline = require("node:readline");
    init_stream();
    SIGTERM_GRACE_MS = 3e3;
    ClaudeCliClient = class {
      constructor(cfg) {
        this.cfg = cfg;
      }
      /** Session ID of the last completed turn, populated from the system init event. */
      lastSessionId;
      chat = {
        completions: {
          create: (params, opts) => this._create(params, opts)
        }
      };
      _create(params, opts) {
        const messages = params.messages;
        const systemContent = messages.filter((m) => m.role === "system").map((m) => typeof m.content === "string" ? m.content : "").join("\n\n");
        const lastUser = [...messages].reverse().find((m) => m.role === "user");
        const userText = typeof lastUser?.content === "string" ? lastUser.content : "";
        const model = params.model || this.cfg.model;
        const { requestTimeoutSec } = this.cfg;
        const LARGE_THRESHOLD = 262144;
        const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const tmpFiles = [];
        const isResume = Boolean(this.cfg.resumeSessionId);
        const args = [];
        args.push("--");
        if (model)
          args.push("--model", model);
        if (isResume) {
          args.push("--resume", this.cfg.resumeSessionId);
        }
        try {
          const isLargeUser = Buffer.byteLength(userText, "utf8") > LARGE_THRESHOLD;
          if (isLargeUser) {
            const tmpUsrFile = (0, import_node_path5.join)(this.cfg.tmpDir, `llm-wiki-usr-${id}.txt`);
            const wrapped = `<user_input>
${userText}
</user_input>`;
            (0, import_node_fs.writeFileSync)(tmpUsrFile, wrapped, "utf-8");
            tmpFiles.push(tmpUsrFile);
            args.push("-p", "\u041E\u0431\u0440\u0430\u0431\u043E\u0442\u0430\u0439 \u0441\u043E\u0434\u0435\u0440\u0436\u0438\u043C\u043E\u0435 \u0438\u0437 <user_input> \u0441\u043E\u0433\u043B\u0430\u0441\u043D\u043E \u0441\u0438\u0441\u0442\u0435\u043C\u043D\u043E\u043C\u0443 \u043F\u0440\u043E\u043C\u043F\u0442\u0443.");
            args.push("--append-system-prompt-file", tmpUsrFile);
          } else {
            args.push("-p", userText);
          }
          args.push("--output-format", "stream-json", "--verbose");
          args.push("--disable-slash-commands");
          args.push("--dangerously-skip-permissions");
          if (this.cfg.allowedTools)
            args.push("--tools", this.cfg.allowedTools);
          if (!isResume && systemContent) {
            const isLargeSys = Buffer.byteLength(systemContent, "utf8") > LARGE_THRESHOLD;
            if (isLargeSys) {
              const tmpSysFile = (0, import_node_path5.join)(this.cfg.tmpDir, `llm-wiki-sys-${id}.txt`);
              (0, import_node_fs.writeFileSync)(tmpSysFile, systemContent, "utf-8");
              tmpFiles.push(tmpSysFile);
              args.push("--system-prompt-file", tmpSysFile);
            } else {
              args.push("--system-prompt", systemContent);
            }
          }
        } catch (err) {
          for (const f of tmpFiles) {
            try {
              (0, import_node_fs.unlinkSync)(f);
            } catch {
            }
          }
          throw err;
        }
        if (params.stream) {
          return Promise.resolve(this._makeIterable(args, opts?.signal, requestTimeoutSec, tmpFiles));
        }
        return this._collect(args, opts?.signal, requestTimeoutSec, tmpFiles);
      }
      _makeIterable(args, signal, timeoutSec, tmpFiles) {
        return { [Symbol.asyncIterator]: () => this._generate(args, signal, timeoutSec, tmpFiles) };
      }
      async *_generate(args, signal, timeoutSec, tmpFiles) {
        const child = (0, import_node_child_process.spawn)(this.cfg.iclaudePath, args, { stdio: ["ignore", "pipe", "pipe"], cwd: this.cfg.cwd || void 0 });
        if (!child.stdout || !child.stderr)
          throw new Error("spawn: missing stdio");
        const stderrChunks = [];
        child.stderr.on("data", (chunk) => stderrChunks.push(chunk));
        const onAbort = () => {
          child.kill("SIGTERM");
          setTimeout(() => {
            if (child.exitCode === null)
              child.kill("SIGKILL");
          }, SIGTERM_GRACE_MS);
        };
        if (signal?.aborted) {
          onAbort();
          return;
        }
        signal?.addEventListener("abort", onAbort, { once: true });
        const timeoutHandle = setTimeout(() => {
          timedOut = true;
          child.kill("SIGTERM");
          setTimeout(() => {
            if (child.exitCode === null)
              child.kill("SIGKILL");
          }, SIGTERM_GRACE_MS);
        }, timeoutSec * 1e3);
        let timedOut = false;
        const queue = [];
        let resolveNext = null;
        const wake = () => {
          if (resolveNext) {
            resolveNext();
            resolveNext = null;
          }
        };
        let id = 0;
        const rl = (0, import_node_readline.createInterface)({ input: child.stdout });
        rl.on("line", (line) => {
          const ev = parseStreamLine(line);
          if (ev?.kind === "system" && ev.sessionId) {
            this.lastSessionId = ev.sessionId;
          }
          if (ev?.kind === "assistant_text") {
            const delta = ev.isReasoning ? { reasoning: ev.delta } : { content: ev.delta };
            queue.push({
              id: `cc-${++id}`,
              object: "chat.completion.chunk",
              model: this.cfg.model || "claude",
              created: 0,
              choices: [{ index: 0, delta, finish_reason: null }]
            });
            wake();
          }
        });
        let exited = false;
        let exitCode = null;
        let spawnError = null;
        child.on("close", (code) => {
          exitCode = code;
          exited = true;
          wake();
        });
        child.on("error", (err) => {
          spawnError = err;
          exited = true;
          wake();
        });
        try {
          while (true) {
            if (queue.length > 0) {
              yield queue.shift();
              continue;
            }
            if (exited)
              break;
            await new Promise((r) => resolveNext = r);
          }
          const stderr = () => Buffer.concat(stderrChunks).toString("utf8").trim();
          if (spawnError)
            throw new Error(`claude spawn failed: ${spawnError.message}${stderr() ? `
${stderr()}` : ""}`);
          if (signal?.aborted)
            return;
          const ec = exitCode;
          if (ec !== null && ec !== 0)
            throw new Error(`claude exited with code ${String(ec)}${stderr() ? `
${stderr()}` : ""}`);
          if (timedOut)
            throw new Error(`claude process timed out after ${timeoutSec}s`);
          yield {
            id: `cc-${++id}`,
            object: "chat.completion.chunk",
            model: this.cfg.model || "claude",
            created: 0,
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }]
          };
        } finally {
          clearTimeout(timeoutHandle);
          signal?.removeEventListener("abort", onAbort);
          rl.close();
          for (const f of tmpFiles) {
            try {
              (0, import_node_fs.unlinkSync)(f);
            } catch {
            }
          }
          if (child.exitCode === null) {
            child.kill("SIGTERM");
            setTimeout(() => {
              if (child.exitCode === null)
                child.kill("SIGKILL");
            }, SIGTERM_GRACE_MS);
          }
        }
      }
      async _collect(args, signal, timeoutSec, tmpFiles) {
        let text = "";
        for await (const chunk of this._generate(args, signal, timeoutSec, tmpFiles)) {
          text += chunk.choices[0]?.delta?.content ?? "";
        }
        return {
          id: "cc-0",
          object: "chat.completion",
          model: this.cfg.model || "claude",
          created: 0,
          choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop", logprobs: null }],
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
        };
      }
    };
  }
});

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => LlmWikiPlugin,
  migrateDomainWikiFolder: () => migrateDomainWikiFolder,
  migrateLegacyData: () => migrateLegacyData,
  migrateToLocalV1: () => migrateToLocalV1
});
module.exports = __toCommonJS(main_exports);
var import_obsidian7 = require("obsidian");

// src/types.ts
var DEFAULT_SETTINGS = {
  backend: "claude-agent",
  systemPrompt: "",
  maxTokens: 4096,
  agentLogEnabled: false,
  historyLimit: 20,
  timeouts: { ingest: 300, query: 300, lint: 900, fix: 900, init: 3600, format: 600 },
  history: [],
  claudeAgent: {
    model: "sonnet",
    allowedTools: "",
    perOperation: false,
    operations: {
      ingest: { model: "haiku", maxTokens: 4096 },
      query: { model: "sonnet", maxTokens: 4096 },
      lint: { model: "sonnet", maxTokens: 8192 },
      init: { model: "sonnet", maxTokens: 8192 },
      format: { model: "sonnet", maxTokens: 16384 }
    }
  },
  nativeAgent: {
    baseUrl: "http://localhost:11434/v1",
    apiKey: "ollama",
    model: "llama3.2",
    temperature: 0.2,
    topP: null,
    numCtx: null,
    perOperation: false,
    operations: {
      ingest: { model: "llama3.2", maxTokens: 4096, temperature: 0.2 },
      query: { model: "llama3.2", maxTokens: 4096, temperature: 0.2 },
      lint: { model: "llama3.2", maxTokens: 8192, temperature: 0.2 },
      init: { model: "llama3.2", maxTokens: 8192, temperature: 0.2 },
      format: { model: "llama3.2", maxTokens: 16384, temperature: 0.2 }
    }
  },
  devMode: {
    enabled: false,
    evaluatorModel: "sonnet"
  }
};

// src/settings.ts
var import_obsidian3 = require("obsidian");

// src/modals.ts
var import_obsidian2 = require("obsidian");

// src/i18n.ts
var import_obsidian = require("obsidian");
var en = {
  settings: {
    h3_general: "General settings",
    h3_backend: "Backend settings",
    systemPrompt_name: "User prompt",
    systemPrompt_desc: "Appended to the system prompt of every operation. Empty by default.",
    maxTokens_name: "Max tokens",
    maxTokens_desc: "Maximum tokens in the response. Recommended \u2265 4096.",
    domains_heading: "Domains",
    editDomain: "Edit",
    deleteDomain: "Delete",
    confirmDeleteDomain: (id) => `Delete domain "${id}"?`,
    domainDeleted: (id) => `Domain \xAB${id}\xBB deleted`,
    busyBanner: "Operation in progress \u2014 domain editing is disabled.",
    domains_empty: "No domains. Use 'Add domain' in the sidebar panel to create one.",
    timeouts_name: "Timeouts (seconds)",
    timeouts_desc: "ingest / query / lint / init",
    historyLimit_name: "History limit",
    historyLimit_desc: "Maximum operations in the sidebar history.",
    agentLog_name: "Agent log (JSONL)",
    agentLog_desc: "Log agent events to <vault>/!Logs/agent.jsonl. Folder is created automatically.",
    backend_name: "Backend",
    backend_desc: "Select the backend for operations.",
    claudeCodeAgent: "Claude Code agent",
    nativeAgent: "Native agent (OpenAI-compatible)",
    iclaudePath_name: "Path to Claude Code",
    iclaudePath_desc: "Required. Full absolute path to iclaude.sh / iclaude / claude.",
    model_name: "Model",
    model_desc_claude: "Model name: sonnet, opus, claude-sonnet-4-6, etc.",
    baseUrl_name: "Base URL",
    baseUrl_desc: "OpenAI-compatible endpoint. Ollama: http://localhost:11434/v1",
    apiKey_name: "API key",
    apiKey_desc: 'For Ollama enter "ollama". For OpenAI \u2014 key sk-...',
    model_desc_native: "Model name: llama3.2, mistral, gpt-4o, etc.",
    temperature_name: "Temperature",
    temperature_desc: "0.0\u20131.0.",
    topP_name: "Top-p",
    topP_desc: "0.0\u20131.0, or empty \u2014 disable.",
    numCtx_name: "Context window",
    numCtx_desc: "Context size (num_ctx). Empty \u2014 model default.",
    allowedTools_name: "Allowed tools",
    allowedTools_desc: "Comma-separated list passed to --tools. Empty \u2014 no restriction.",
    perOperation_name: "Per-operation models",
    perOperation_desc: "Configure separate model and parameters for each operation.",
    op_ingest: "Ingest",
    op_query: "Query",
    op_lint: "Lint",
    op_init: "Init",
    op_format: "Format",
    opModel_name: "Model",
    opModel_desc: "Model name for this operation.",
    opMaxTokens_name: "Max tokens",
    opMaxTokens_desc: "Max tokens for this operation.",
    opTemperature_name: "Temperature",
    opTemperature_desc: "Temperature for this operation (0\u20132).",
    h3_devmode: "Developer",
    devMode_enabled_name: "Dev mode",
    devMode_enabled_desc: "Enable dev logger and evaluator after each operation.",
    devMode_evaluatorModel_name: "Evaluator model",
    devMode_evaluatorModel_desc: "Model name for the evaluator (same backend)."
  },
  view: {
    refreshTitle: "Refresh domains",
    addDomain: "Add domain",
    sectionCreate: "Create",
    sectionDomain: "Fill / Maintain",
    sectionQuery: "Query",
    ingest: "Ingest",
    lint: "Lint",
    format: "Format",
    formatOnlyMarkdown: "Format only works on markdown files",
    formatInWikiTitle: "File is inside a wiki domain",
    formatInWikiBody: (id) => `This file belongs to wiki domain \xAB${id}\xBB. Re-run ingest from sources instead?`,
    formatInWikiNoSources: "No wiki_sources in frontmatter \u2014 cannot re-ingest",
    formatNoPending: "No format preview available",
    formatApplied: (path2) => `Formatted: ${path2}`,
    formatCancelled: "Format cancelled",
    formatPreviewHeader: "Format preview",
    formatApply: "Apply",
    formatCancelBtn: "Discard",
    formatRefinePlaceholder: "Refine the formatting (Enter to send)\u2026",
    formatMissingTokens: (n) => `\u26A0 ${n} significant token(s) missing in formatted text`,
    fixPlaceholder: "Describe the task for the model (Enter to send, Shift+Enter for newline)\u2026",
    fixSend: "Send",
    chatLabel: "Chat",
    chatSend: "Send",
    init: "Init new domain",
    ask: "Ask",
    askAndSave: "Ask and save",
    cancel: "Cancel",
    result: "Result",
    history: "History",
    allDomains: "(all)",
    noHistory: "No history yet.",
    answerRequired: "LLM Wiki \u2014 answer required",
    noActiveFile: "No active file",
    selectDomainForInit: "Select a specific domain for init",
    cwdNotSet: "Working directory is not set",
    enterQuestion: "Enter a question",
    operationInProgress: "Operation already in progress",
    stepsCount: (n, s) => `${n} steps \xB7 ${s}s`,
    starting: "Starting",
    initialising: "Initialising"
  },
  ctrl: {
    cancelling: "Cancelling\u2026",
    noActiveFile: "No active file",
    domainAdded: (id) => `Domain \xAB${id}\xBB added`,
    domainAddFailed: (err) => `Failed to add domain: ${err}`,
    setClaudeCodePath: "Set Claude Code path in settings",
    operationRunning: "Operation already running, cancel it first",
    errorPrefix: (msg) => `Error: ${msg}`,
    mobileNotAvailable: "Operation not available on mobile",
    configureCloudLlm: "Configure cloud LLM (baseUrl + apiKey) in settings"
  },
  cmd: {
    openPanel: "Open panel",
    ingestActive: "Ingest active file",
    query: "Query",
    querySave: "Query and save as page",
    lint: "Lint domain",
    init: "Init domain",
    cancel: "Cancel operation"
  },
  modal: {
    cancel: "Cancel",
    run: "Run",
    query: "Query",
    queryAndSave: "Query + save",
    queryPlaceholder: "Enter your question\u2026",
    domain_name: "Domain",
    noDomains_desc: "No domains found. Create a domain via \xABAdd domain\xBB.",
    domainIdPlaceholder: "domain id",
    allWiki: "(all wiki)",
    dryRun_name: "--dry-run",
    addDomain: "Add domain",
    id_name: "ID",
    id_desc: "Letters, digits, hyphen, underscore. Used as folder name.",
    idPlaceholder: "e.g.: projects",
    displayName_name: "Display name",
    wikiFolder_name: "Wiki subfolder",
    wikiFolder_desc: (_root) => "Subfolder within !Wiki/. Auto-filled from domain ID.",
    wikiFolder_placeholder: (_root) => "e.g.: os",
    wikiFolder_editDesc: "!Wiki/[subfolder]",
    addDomainNote: "The entry will be saved in plugin settings with empty entity_types. Edit the domain in Settings \u2192 Domains to add entity_types/extraction_cues.",
    addDomainSourcePathsLabel: "Source paths",
    addDomainSourcePathsPlaceholder: "Notes/AI/",
    addDomainSourcePathsAdd: "+ Add path",
    initConfirmTitle: "Start domain initialization?",
    initConfirmBody: (files, folders) => `Found ${files} .md files in ${folders} folder(s). Run init to analyze sources and create wiki pages?`,
    fileErrorTitle: "Error processing file",
    fileErrorSkip: "Skip",
    fileErrorRetry: "Retry",
    fileErrorStop: "Stop",
    add: "Add",
    editDomainTitle: (id) => `Edit domain: ${id}`,
    entityTypesLabel: "Entity types",
    entityTypesError: "Invalid JSON array \u2014 must be an array of objects",
    sourcePathsLabel: "Source paths",
    entityTypesEditJson: "Edit JSON",
    entityTypesBackToCards: "\u2190 Cards",
    entityTypesEmpty: "No entity types defined. Click 'Edit JSON' to add.",
    sourcePathsAdd: "Add",
    sourcePathsPlaceholder: "/path/to/folder or file",
    languageNotesLabel: "Language notes",
    save: "Save",
    busyCloseTitle: "Operation in progress",
    busyCloseBody: "Abort the operation or leave it running in the background?",
    busyCloseAbort: "Abort operation",
    busyCloseLeave: "Leave in background"
  }
};
var ru = {
  settings: {
    h3_general: "\u041E\u0431\u0449\u0438\u0435 \u043D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438",
    h3_backend: "\u041D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438 \u0431\u044D\u043A\u0435\u043D\u0434\u0430",
    systemPrompt_name: "User prompt",
    systemPrompt_desc: "\u0414\u043E\u0431\u0430\u0432\u043B\u044F\u0435\u0442\u0441\u044F \u0432 \u043A\u043E\u043D\u0435\u0446 \u0441\u0438\u0441\u0442\u0435\u043C\u043D\u043E\u0433\u043E \u043F\u0440\u043E\u043C\u0442\u0430 \u043A\u0430\u0436\u0434\u043E\u0439 \u043E\u043F\u0435\u0440\u0430\u0446\u0438\u0438. \u041F\u043E \u0443\u043C\u043E\u043B\u0447\u0430\u043D\u0438\u044E \u043F\u0443\u0441\u0442.",
    maxTokens_name: "Max tokens",
    maxTokens_desc: "\u041C\u0430\u043A\u0441\u0438\u043C\u0443\u043C \u0442\u043E\u043A\u0435\u043D\u043E\u0432 \u0432 \u043E\u0442\u0432\u0435\u0442\u0435. \u0420\u0435\u043A\u043E\u043C\u0435\u043D\u0434\u0443\u0435\u0442\u0441\u044F \u2265 4096.",
    domains_heading: "\u0414\u043E\u043C\u0435\u043D\u044B",
    editDomain: "\u0420\u0435\u0434\u0430\u043A\u0442\u0438\u0440\u043E\u0432\u0430\u0442\u044C",
    deleteDomain: "\u0423\u0434\u0430\u043B\u0438\u0442\u044C",
    confirmDeleteDomain: (id) => `\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u0434\u043E\u043C\u0435\u043D \xAB${id}\xBB?`,
    domainDeleted: (id) => `\u0414\u043E\u043C\u0435\u043D \xAB${id}\xBB \u0443\u0434\u0430\u043B\u0451\u043D`,
    busyBanner: "\u041E\u043F\u0435\u0440\u0430\u0446\u0438\u044F \u0432\u044B\u043F\u043E\u043B\u043D\u044F\u0435\u0442\u0441\u044F \u2014 \u0440\u0435\u0434\u0430\u043A\u0442\u0438\u0440\u043E\u0432\u0430\u043D\u0438\u0435 \u0434\u043E\u043C\u0435\u043D\u043E\u0432 \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u043D\u043E.",
    domains_empty: "\u0414\u043E\u043C\u0435\u043D\u044B \u043D\u0435 \u0434\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u044B. \u0418\u0441\u043F\u043E\u043B\u044C\u0437\u0443\u0439\u0442\u0435 '\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u0434\u043E\u043C\u0435\u043D' \u0432 \u0431\u043E\u043A\u043E\u0432\u043E\u0439 \u043F\u0430\u043D\u0435\u043B\u0438.",
    timeouts_name: "\u0422\u0430\u0439\u043C\u0430\u0443\u0442\u044B (\u0441\u0435\u043A\u0443\u043D\u0434\u044B)",
    timeouts_desc: "ingest / query / lint / init",
    historyLimit_name: "\u041B\u0438\u043C\u0438\u0442 \u0438\u0441\u0442\u043E\u0440\u0438\u0438",
    historyLimit_desc: "\u041C\u0430\u043A\u0441\u0438\u043C\u0443\u043C \u043E\u043F\u0435\u0440\u0430\u0446\u0438\u0439 \u0432 \u0438\u0441\u0442\u043E\u0440\u0438\u0438 \u0431\u043E\u043A\u043E\u0432\u043E\u0439 \u043F\u0430\u043D\u0435\u043B\u0438.",
    agentLog_name: "\u041B\u043E\u0433 \u0430\u0433\u0435\u043D\u0442\u0430 (JSONL)",
    agentLog_desc: "\u0417\u0430\u043F\u0438\u0441\u044B\u0432\u0430\u0435\u0442 \u0441\u043E\u0431\u044B\u0442\u0438\u044F \u0430\u0433\u0435\u043D\u0442\u0430 \u0432 <vault>/!Logs/agent.jsonl. \u041F\u0430\u043F\u043A\u0430 \u0441\u043E\u0437\u0434\u0430\u0451\u0442\u0441\u044F \u0430\u0432\u0442\u043E\u043C\u0430\u0442\u0438\u0447\u0435\u0441\u043A\u0438.",
    backend_name: "Backend",
    backend_desc: "\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0431\u044D\u043A\u0435\u043D\u0434 \u0434\u043B\u044F \u0432\u044B\u043F\u043E\u043B\u043D\u0435\u043D\u0438\u044F \u043E\u043F\u0435\u0440\u0430\u0446\u0438\u0439.",
    claudeCodeAgent: "Claude Code agent",
    nativeAgent: "Native agent (OpenAI-compatible)",
    iclaudePath_name: "\u041F\u0443\u0442\u044C \u043A Claude Code",
    iclaudePath_desc: "\u041E\u0431\u044F\u0437\u0430\u0442\u0435\u043B\u044C\u043D\u043E. \u041F\u043E\u043B\u043D\u044B\u0439 \u0430\u0431\u0441\u043E\u043B\u044E\u0442\u043D\u044B\u0439 \u043F\u0443\u0442\u044C \u043A iclaude.sh / iclaude / claude.",
    model_name: "\u041C\u043E\u0434\u0435\u043B\u044C",
    model_desc_claude: "\u0418\u043C\u044F \u043C\u043E\u0434\u0435\u043B\u0438: sonnet, opus, claude-sonnet-4-6 \u0438 \u0442.\u043F.",
    baseUrl_name: "Base URL",
    baseUrl_desc: "OpenAI-compatible endpoint. Ollama: http://localhost:11434/v1",
    apiKey_name: "API key",
    apiKey_desc: '\u0414\u043B\u044F Ollama \u0432\u0432\u0435\u0434\u0438\u0442\u0435 "ollama". \u0414\u043B\u044F OpenAI \u2014 \u043A\u043B\u044E\u0447 sk-...',
    model_desc_native: "\u0418\u043C\u044F \u043C\u043E\u0434\u0435\u043B\u0438: llama3.2, mistral, gpt-4o \u0438 \u0442.\u043F.",
    temperature_name: "Temperature",
    temperature_desc: "0.0\u20131.0.",
    topP_name: "Top-p",
    topP_desc: "0.0\u20131.0, \u0438\u043B\u0438 \u043F\u0443\u0441\u0442\u043E \u2014 \u043E\u0442\u043A\u043B\u044E\u0447\u0438\u0442\u044C.",
    numCtx_name: "\u041A\u043E\u043D\u0442\u0435\u043A\u0441\u0442\u043D\u043E\u0435 \u043E\u043A\u043D\u043E",
    numCtx_desc: "\u0420\u0430\u0437\u043C\u0435\u0440 \u043A\u043E\u043D\u0442\u0435\u043A\u0441\u0442\u0430 (num_ctx). \u041F\u0443\u0441\u0442\u043E \u2014 \u0434\u0435\u0444\u043E\u043B\u0442 \u043C\u043E\u0434\u0435\u043B\u0438.",
    allowedTools_name: "\u0420\u0430\u0437\u0440\u0435\u0448\u0451\u043D\u043D\u044B\u0435 \u0438\u043D\u0441\u0442\u0440\u0443\u043C\u0435\u043D\u0442\u044B",
    allowedTools_desc: "\u0421\u043F\u0438\u0441\u043E\u043A \u0447\u0435\u0440\u0435\u0437 \u0437\u0430\u043F\u044F\u0442\u0443\u044E \u0434\u043B\u044F --tools. \u041F\u0443\u0441\u0442\u043E \u2014 \u0431\u0435\u0437 \u043E\u0433\u0440\u0430\u043D\u0438\u0447\u0435\u043D\u0438\u0439.",
    perOperation_name: "\u041C\u043E\u0434\u0435\u043B\u0438 \u043F\u043E \u043E\u043F\u0435\u0440\u0430\u0446\u0438\u044F\u043C",
    perOperation_desc: "\u041D\u0430\u0441\u0442\u0440\u043E\u0438\u0442\u044C \u043E\u0442\u0434\u0435\u043B\u044C\u043D\u0443\u044E \u043C\u043E\u0434\u0435\u043B\u044C \u0438 \u043F\u0430\u0440\u0430\u043C\u0435\u0442\u0440\u044B \u0434\u043B\u044F \u043A\u0430\u0436\u0434\u043E\u0439 \u043E\u043F\u0435\u0440\u0430\u0446\u0438\u0438.",
    op_ingest: "Ingest",
    op_query: "Query",
    op_lint: "Lint",
    op_init: "Init",
    op_format: "Format",
    opModel_name: "\u041C\u043E\u0434\u0435\u043B\u044C",
    opModel_desc: "\u0418\u043C\u044F \u043C\u043E\u0434\u0435\u043B\u0438 \u0434\u043B\u044F \u044D\u0442\u043E\u0439 \u043E\u043F\u0435\u0440\u0430\u0446\u0438\u0438.",
    opMaxTokens_name: "Max tokens",
    opMaxTokens_desc: "\u041C\u0430\u043A\u0441\u0438\u043C\u0443\u043C \u0442\u043E\u043A\u0435\u043D\u043E\u0432 \u0434\u043B\u044F \u044D\u0442\u043E\u0439 \u043E\u043F\u0435\u0440\u0430\u0446\u0438\u0438.",
    opTemperature_name: "Temperature",
    opTemperature_desc: "Temperature \u0434\u043B\u044F \u044D\u0442\u043E\u0439 \u043E\u043F\u0435\u0440\u0430\u0446\u0438\u0438 (0\u20132).",
    h3_devmode: "\u0420\u0430\u0437\u0440\u0430\u0431\u043E\u0442\u043A\u0430",
    devMode_enabled_name: "Dev \u0440\u0435\u0436\u0438\u043C",
    devMode_enabled_desc: "\u0412\u043A\u043B\u044E\u0447\u0438\u0442\u044C dev-\u043B\u043E\u0433\u0433\u0435\u0440 \u0438 \u043E\u0446\u0435\u043D\u0449\u0438\u043A \u043F\u043E\u0441\u043B\u0435 \u043A\u0430\u0436\u0434\u043E\u0439 \u043E\u043F\u0435\u0440\u0430\u0446\u0438\u0438.",
    devMode_evaluatorModel_name: "\u041C\u043E\u0434\u0435\u043B\u044C \u043E\u0446\u0435\u043D\u0449\u0438\u043A\u0430",
    devMode_evaluatorModel_desc: "\u0418\u043C\u044F \u043C\u043E\u0434\u0435\u043B\u0438 \u0434\u043B\u044F \u043E\u0446\u0435\u043D\u0449\u0438\u043A\u0430 (\u0442\u043E\u0442 \u0436\u0435 \u0431\u044D\u043A\u0435\u043D\u0434)."
  },
  view: {
    refreshTitle: "\u041E\u0431\u043D\u043E\u0432\u0438\u0442\u044C \u0434\u043E\u043C\u0435\u043D\u044B",
    addDomain: "\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u0434\u043E\u043C\u0435\u043D",
    sectionCreate: "\u0421\u043E\u0437\u0434\u0430\u043D\u0438\u0435",
    sectionDomain: "\u041D\u0430\u043F\u043E\u043B\u043D\u0435\u043D\u0438\u0435 / \u0410\u043A\u0442\u0443\u0430\u043B\u0438\u0437\u0430\u0446\u0438\u044F",
    sectionQuery: "\u0417\u0430\u043F\u0440\u043E\u0441",
    ingest: "Ingest",
    lint: "Lint",
    format: "\u0424\u043E\u0440\u043C\u0430\u0442\u0438\u0440\u043E\u0432\u0430\u0442\u044C",
    formatOnlyMarkdown: "\u0424\u043E\u0440\u043C\u0430\u0442\u0438\u0440\u043E\u0432\u0430\u043D\u0438\u0435 \u0440\u0430\u0431\u043E\u0442\u0430\u0435\u0442 \u0442\u043E\u043B\u044C\u043A\u043E \u0441 markdown-\u0444\u0430\u0439\u043B\u0430\u043C\u0438",
    formatInWikiTitle: "\u0424\u0430\u0439\u043B \u043D\u0430\u0445\u043E\u0434\u0438\u0442\u0441\u044F \u0432\u043D\u0443\u0442\u0440\u0438 wiki-\u0434\u043E\u043C\u0435\u043D\u0430",
    formatInWikiBody: (id) => `\u0424\u0430\u0439\u043B \u043F\u0440\u0438\u043D\u0430\u0434\u043B\u0435\u0436\u0438\u0442 wiki-\u0434\u043E\u043C\u0435\u043D\u0443 \xAB${id}\xBB. \u0417\u0430\u043F\u0443\u0441\u0442\u0438\u0442\u044C ingest \u0437\u0430\u043D\u043E\u0432\u043E \u0438\u0437 \u0438\u0441\u0442\u043E\u0447\u043D\u0438\u043A\u043E\u0432 \u0432\u043C\u0435\u0441\u0442\u043E \u0444\u043E\u0440\u043C\u0430\u0442\u0438\u0440\u043E\u0432\u0430\u043D\u0438\u044F?`,
    formatInWikiNoSources: "\u0412 frontmatter \u043E\u0442\u0441\u0443\u0442\u0441\u0442\u0432\u0443\u0435\u0442 wiki_sources \u2014 \u043F\u043E\u0432\u0442\u043E\u0440\u043D\u044B\u0439 ingest \u043D\u0435\u0432\u043E\u0437\u043C\u043E\u0436\u0435\u043D",
    formatNoPending: "\u041D\u0435\u0442 \u043E\u0436\u0438\u0434\u0430\u044E\u0449\u0435\u0433\u043E \u043F\u0440\u0435\u0434\u043F\u0440\u043E\u0441\u043C\u043E\u0442\u0440\u0430 \u0444\u043E\u0440\u043C\u0430\u0442\u0438\u0440\u043E\u0432\u0430\u043D\u0438\u044F",
    formatApplied: (path2) => `\u041E\u0442\u0444\u043E\u0440\u043C\u0430\u0442\u0438\u0440\u043E\u0432\u0430\u043D\u043E: ${path2}`,
    formatCancelled: "\u0424\u043E\u0440\u043C\u0430\u0442\u0438\u0440\u043E\u0432\u0430\u043D\u0438\u0435 \u043E\u0442\u043C\u0435\u043D\u0435\u043D\u043E",
    formatPreviewHeader: "\u041F\u0440\u0435\u0434\u043F\u0440\u043E\u0441\u043C\u043E\u0442\u0440 \u0444\u043E\u0440\u043C\u0430\u0442\u0438\u0440\u043E\u0432\u0430\u043D\u0438\u044F",
    formatApply: "\u041F\u0440\u0438\u043C\u0435\u043D\u0438\u0442\u044C",
    formatCancelBtn: "\u041E\u0442\u043C\u0435\u043D\u0438\u0442\u044C",
    formatRefinePlaceholder: "\u0423\u0442\u043E\u0447\u043D\u0438\u0442\u0435 \u0444\u043E\u0440\u043C\u0430\u0442\u0438\u0440\u043E\u0432\u0430\u043D\u0438\u0435 (Enter \u2014 \u043E\u0442\u043F\u0440\u0430\u0432\u0438\u0442\u044C)\u2026",
    formatMissingTokens: (n) => `\u26A0 \u041F\u043E\u0442\u0435\u0440\u044F\u043D\u043E \u0437\u043D\u0430\u0447\u0438\u043C\u044B\u0445 \u0442\u043E\u043A\u0435\u043D\u043E\u0432: ${n}`,
    fixPlaceholder: "\u041E\u043F\u0438\u0448\u0438\u0442\u0435 \u0437\u0430\u0434\u0430\u0447\u0443 \u0434\u043B\u044F \u043C\u043E\u0434\u0435\u043B\u0438 (Enter \u2014 \u043E\u0442\u043F\u0440\u0430\u0432\u0438\u0442\u044C, Shift+Enter \u2014 \u043F\u0435\u0440\u0435\u043D\u043E\u0441)\u2026",
    fixSend: "\u041E\u0442\u043F\u0440\u0430\u0432\u0438\u0442\u044C",
    chatLabel: "\u0427\u0430\u0442",
    chatSend: "\u041E\u0442\u043F\u0440\u0430\u0432\u0438\u0442\u044C",
    init: "Init \u2014 \u043D\u043E\u0432\u044B\u0439 \u0434\u043E\u043C\u0435\u043D",
    ask: "\u0421\u043F\u0440\u043E\u0441\u0438\u0442\u044C",
    askAndSave: "\u0421\u043F\u0440\u043E\u0441\u0438\u0442\u044C \u0438 \u0441\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C",
    cancel: "\u041E\u0442\u043C\u0435\u043D\u0430",
    result: "\u0420\u0435\u0437\u0443\u043B\u044C\u0442\u0430\u0442",
    history: "\u0418\u0441\u0442\u043E\u0440\u0438\u044F",
    allDomains: "(\u0432\u0441\u0435)",
    noHistory: "\u0418\u0441\u0442\u043E\u0440\u0438\u044F \u043F\u0443\u0441\u0442\u0430.",
    answerRequired: "LLM Wiki \u2014 \u0442\u0440\u0435\u0431\u0443\u0435\u0442\u0441\u044F \u043E\u0442\u0432\u0435\u0442",
    noActiveFile: "\u041D\u0435\u0442 \u0430\u043A\u0442\u0438\u0432\u043D\u043E\u0433\u043E \u0444\u0430\u0439\u043B\u0430",
    selectDomainForInit: "\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u043A\u043E\u043D\u043A\u0440\u0435\u0442\u043D\u044B\u0439 \u0434\u043E\u043C\u0435\u043D \u0434\u043B\u044F init",
    cwdNotSet: "\u0420\u0430\u0431\u043E\u0447\u0430\u044F \u0434\u0438\u0440\u0435\u043A\u0442\u043E\u0440\u0438\u044F \u043D\u0435 \u0437\u0430\u0434\u0430\u043D\u0430",
    enterQuestion: "\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u0432\u043E\u043F\u0440\u043E\u0441",
    operationInProgress: "\u041E\u043F\u0435\u0440\u0430\u0446\u0438\u044F \u0443\u0436\u0435 \u0432\u044B\u043F\u043E\u043B\u043D\u044F\u0435\u0442\u0441\u044F",
    stepsCount: (n, s) => `${n} \u0448\u0430\u0433\u043E\u0432 \xB7 ${s}\u0441`,
    starting: "\u0417\u0430\u043F\u0443\u0441\u043A",
    initialising: "\u0418\u043D\u0438\u0446\u0438\u0430\u043B\u0438\u0437\u0430\u0446\u0438\u044F"
  },
  ctrl: {
    cancelling: "\u041E\u0442\u043C\u0435\u043D\u0430\u2026",
    noActiveFile: "\u041D\u0435\u0442 \u0430\u043A\u0442\u0438\u0432\u043D\u043E\u0433\u043E \u0444\u0430\u0439\u043B\u0430",
    domainAdded: (id) => `\u0414\u043E\u043C\u0435\u043D \xAB${id}\xBB \u0434\u043E\u0431\u0430\u0432\u043B\u0435\u043D`,
    domainAddFailed: (err) => `\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0434\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u0434\u043E\u043C\u0435\u043D: ${err}`,
    setClaudeCodePath: "\u0423\u043A\u0430\u0436\u0438\u0442\u0435 \u043F\u0443\u0442\u044C \u043A Claude Code \u0432 \u043D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0430\u0445",
    operationRunning: "\u0423\u0436\u0435 \u0432\u044B\u043F\u043E\u043B\u043D\u044F\u0435\u0442\u0441\u044F \u043E\u043F\u0435\u0440\u0430\u0446\u0438\u044F, \u043E\u0442\u043C\u0435\u043D\u0438\u0442\u0435 \u0435\u0451 \u0441\u043D\u0430\u0447\u0430\u043B\u0430",
    errorPrefix: (msg) => `\u041E\u0448\u0438\u0431\u043A\u0430: ${msg}`,
    mobileNotAvailable: "\u041E\u043F\u0435\u0440\u0430\u0446\u0438\u044F \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u043D\u0430 \u043D\u0430 \u043C\u043E\u0431\u0438\u043B\u044C\u043D\u043E\u043C \u0443\u0441\u0442\u0440\u043E\u0439\u0441\u0442\u0432\u0435",
    configureCloudLlm: "\u041D\u0430\u0441\u0442\u0440\u043E\u0439\u0442\u0435 cloud LLM (baseUrl + apiKey) \u0432 \u043D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0430\u0445"
  },
  cmd: {
    openPanel: "\u041E\u0442\u043A\u0440\u044B\u0442\u044C \u043F\u0430\u043D\u0435\u043B\u044C",
    ingestActive: "Ingestion \u0430\u043A\u0442\u0438\u0432\u043D\u043E\u0433\u043E \u0444\u0430\u0439\u043B\u0430",
    query: "\u0417\u0430\u043F\u0440\u043E\u0441",
    querySave: "\u0417\u0430\u043F\u0440\u043E\u0441 \u0438 \u0441\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C \u043A\u0430\u043A \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0443",
    lint: "Lint \u0434\u043E\u043C\u0435\u043D\u0430",
    init: "Init \u0434\u043E\u043C\u0435\u043D\u0430",
    cancel: "\u041E\u0442\u043C\u0435\u043D\u0430 \u043E\u043F\u0435\u0440\u0430\u0446\u0438\u0438"
  },
  modal: {
    cancel: "\u041E\u0442\u043C\u0435\u043D\u0430",
    run: "\u0417\u0430\u043F\u0443\u0441\u0442\u0438\u0442\u044C",
    query: "\u0417\u0430\u043F\u0440\u043E\u0441",
    queryAndSave: "\u0417\u0430\u043F\u0440\u043E\u0441 + \u0441\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C",
    queryPlaceholder: "\u0421\u0444\u043E\u0440\u043C\u0443\u043B\u0438\u0440\u0443\u0439\u0442\u0435 \u0432\u043E\u043F\u0440\u043E\u0441\u2026",
    domain_name: "\u0414\u043E\u043C\u0435\u043D",
    noDomains_desc: "\u0414\u043E\u043C\u0435\u043D\u044B \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u044B. \u0421\u043E\u0437\u0434\u0430\u0439\u0442\u0435 \u0434\u043E\u043C\u0435\u043D \u0447\u0435\u0440\u0435\u0437 \xAB\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u0434\u043E\u043C\u0435\u043D\xBB.",
    domainIdPlaceholder: "id \u0434\u043E\u043C\u0435\u043D\u0430",
    allWiki: "(\u0432\u0441\u044F \u0432\u0438\u043A\u0438)",
    dryRun_name: "--dry-run",
    addDomain: "\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u0434\u043E\u043C\u0435\u043D",
    id_name: "ID",
    id_desc: "\u0411\u0443\u043A\u0432\u044B (\u0432\u043A\u043B\u044E\u0447\u0430\u044F \u043A\u0438\u0440\u0438\u043B\u043B\u0438\u0446\u0443), \u0446\u0438\u0444\u0440\u044B, \u0434\u0435\u0444\u0438\u0441, \u043F\u043E\u0434\u0447\u0451\u0440\u043A\u0438\u0432\u0430\u043D\u0438\u0435. \u0418\u0441\u043F\u043E\u043B\u044C\u0437\u0443\u0435\u0442\u0441\u044F \u043A\u0430\u043A \u0438\u043C\u044F \u043F\u0430\u043F\u043A\u0438.",
    idPlaceholder: "\u043D\u0430\u043F\u0440\u0438\u043C\u0435\u0440: \u043F\u0440\u043E\u0435\u043A\u0442\u044B",
    displayName_name: "\u041E\u0442\u043E\u0431\u0440\u0430\u0436\u0430\u0435\u043C\u043E\u0435 \u0438\u043C\u044F",
    wikiFolder_name: "Wiki-\u043F\u043E\u0434\u043F\u0430\u043F\u043A\u0430",
    wikiFolder_desc: (_root) => "\u041F\u043E\u0434\u043F\u0430\u043F\u043A\u0430 \u0432\u043D\u0443\u0442\u0440\u0438 !Wiki/. \u0417\u0430\u043F\u043E\u043B\u043D\u044F\u0435\u0442\u0441\u044F \u0430\u0432\u0442\u043E\u043C\u0430\u0442\u0438\u0447\u0435\u0441\u043A\u0438 \u0438\u0437 ID \u0434\u043E\u043C\u0435\u043D\u0430.",
    wikiFolder_placeholder: (_root) => "\u043D\u0430\u043F\u0440\u0438\u043C\u0435\u0440: os",
    wikiFolder_editDesc: "!Wiki/[\u043F\u043E\u0434\u043F\u0430\u043F\u043A\u0430]",
    addDomainNote: "\u0417\u0430\u043F\u0438\u0441\u044C \u0441\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u0441\u044F \u0432 \u043D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0430\u0445 \u043F\u043B\u0430\u0433\u0438\u043D\u0430 \u0441 \u043F\u0443\u0441\u0442\u044B\u043C\u0438 entity_types. \u041E\u0442\u0440\u0435\u0434\u0430\u043A\u0442\u0438\u0440\u0443\u0439\u0442\u0435 \u0434\u043E\u043C\u0435\u043D \u0432 \u041D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438 \u2192 \u0414\u043E\u043C\u0435\u043D\u044B \u0434\u043B\u044F \u0434\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u0438\u044F entity_types/extraction_cues.",
    addDomainSourcePathsLabel: "\u041F\u0443\u0442\u0438 \u0438\u0441\u0442\u043E\u0447\u043D\u0438\u043A\u043E\u0432",
    addDomainSourcePathsPlaceholder: "Notes/AI/",
    addDomainSourcePathsAdd: "+ \u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u043F\u0443\u0442\u044C",
    initConfirmTitle: "\u0417\u0430\u043F\u0443\u0441\u0442\u0438\u0442\u044C \u0438\u043D\u0438\u0446\u0438\u0430\u043B\u0438\u0437\u0430\u0446\u0438\u044E \u0434\u043E\u043C\u0435\u043D\u0430?",
    initConfirmBody: (files, folders) => `\u041D\u0430\u0439\u0434\u0435\u043D\u043E ${files} .md \u0444\u0430\u0439\u043B\u043E\u0432 \u0432 ${folders} \u043F\u0430\u043F\u043A\u0430\u0445. \u0417\u0430\u043F\u0443\u0441\u0442\u0438\u0442\u044C init \u0434\u043B\u044F \u0430\u043D\u0430\u043B\u0438\u0437\u0430 \u0438\u0441\u0442\u043E\u0447\u043D\u0438\u043A\u043E\u0432 \u0438 \u0441\u043E\u0437\u0434\u0430\u043D\u0438\u044F wiki-\u0441\u0442\u0440\u0430\u043D\u0438\u0446?`,
    fileErrorTitle: "\u041E\u0448\u0438\u0431\u043A\u0430 \u043F\u0440\u0438 \u043E\u0431\u0440\u0430\u0431\u043E\u0442\u043A\u0435 \u0444\u0430\u0439\u043B\u0430",
    fileErrorSkip: "\u041F\u0440\u043E\u043F\u0443\u0441\u0442\u0438\u0442\u044C",
    fileErrorRetry: "\u041F\u043E\u0432\u0442\u043E\u0440\u0438\u0442\u044C",
    fileErrorStop: "\u041E\u0441\u0442\u0430\u043D\u043E\u0432\u0438\u0442\u044C",
    add: "\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C",
    editDomainTitle: (id) => `\u0420\u0435\u0434\u0430\u043A\u0442\u0438\u0440\u043E\u0432\u0430\u043D\u0438\u0435 \u0434\u043E\u043C\u0435\u043D\u0430: ${id}`,
    entityTypesLabel: "\u0422\u0438\u043F\u044B \u0441\u0443\u0449\u043D\u043E\u0441\u0442\u0435\u0439",
    entityTypesError: "\u041D\u0435\u0432\u0430\u043B\u0438\u0434\u043D\u044B\u0439 JSON-\u043C\u0430\u0441\u0441\u0438\u0432 \u2014 \u0434\u043E\u043B\u0436\u0435\u043D \u0431\u044B\u0442\u044C \u043C\u0430\u0441\u0441\u0438\u0432\u043E\u043C \u043E\u0431\u044A\u0435\u043A\u0442\u043E\u0432",
    sourcePathsLabel: "\u041F\u0443\u0442\u0438 \u0438\u0441\u0442\u043E\u0447\u043D\u0438\u043A\u043E\u0432",
    entityTypesEditJson: "\u0420\u0435\u0434\u0430\u043A\u0442\u0438\u0440\u043E\u0432\u0430\u0442\u044C JSON",
    entityTypesBackToCards: "\u2190 \u041A\u0430\u0440\u0442\u043E\u0447\u043A\u0438",
    entityTypesEmpty: "\u0422\u0438\u043F\u044B \u0441\u0443\u0449\u043D\u043E\u0441\u0442\u0435\u0439 \u043D\u0435 \u0437\u0430\u0434\u0430\u043D\u044B. \u041D\u0430\u0436\u043C\u0438\u0442\u0435 \xAB\u0420\u0435\u0434\u0430\u043A\u0442\u0438\u0440\u043E\u0432\u0430\u0442\u044C JSON\xBB, \u0447\u0442\u043E\u0431\u044B \u0434\u043E\u0431\u0430\u0432\u0438\u0442\u044C.",
    sourcePathsAdd: "\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C",
    sourcePathsPlaceholder: "/\u043F\u0443\u0442\u044C/\u043A/\u043F\u0430\u043F\u043A\u0435 \u0438\u043B\u0438 \u0444\u0430\u0439\u043B\u0443",
    languageNotesLabel: "\u0417\u0430\u043C\u0435\u0442\u043A\u0438 \u043E \u044F\u0437\u044B\u043A\u0435",
    save: "\u0421\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C",
    busyCloseTitle: "\u041E\u043F\u0435\u0440\u0430\u0446\u0438\u044F \u0432\u044B\u043F\u043E\u043B\u043D\u044F\u0435\u0442\u0441\u044F",
    busyCloseBody: "\u041F\u0440\u0435\u0440\u0432\u0430\u0442\u044C \u043E\u043F\u0435\u0440\u0430\u0446\u0438\u044E \u0438\u043B\u0438 \u043E\u0441\u0442\u0430\u0432\u0438\u0442\u044C \u0432\u044B\u043F\u043E\u043B\u043D\u044F\u0442\u044C\u0441\u044F \u0432 \u0444\u043E\u043D\u0435?",
    busyCloseAbort: "\u041F\u0440\u0435\u0440\u0432\u0430\u0442\u044C \u043E\u043F\u0435\u0440\u0430\u0446\u0438\u044E",
    busyCloseLeave: "\u041E\u0441\u0442\u0430\u0432\u0438\u0442\u044C \u0432 \u0444\u043E\u043D\u0435"
  }
};
var es = {
  settings: {
    h3_general: "Configuraci\xF3n general",
    h3_backend: "Configuraci\xF3n del backend",
    systemPrompt_name: "User prompt",
    systemPrompt_desc: "Se a\xF1ade al final del prompt del sistema de cada operaci\xF3n. Vac\xEDo por defecto.",
    maxTokens_name: "M\xE1x. tokens",
    maxTokens_desc: "M\xE1ximo de tokens en la respuesta. Recomendado \u2265 4096.",
    domains_heading: "Dominios",
    editDomain: "Editar",
    deleteDomain: "Eliminar",
    confirmDeleteDomain: (id) => `\xBFEliminar dominio "${id}"?`,
    domainDeleted: (id) => `Dominio \xAB${id}\xBB eliminado`,
    busyBanner: "Operaci\xF3n en curso \u2014 la edici\xF3n de dominios est\xE1 desactivada.",
    domains_empty: "No hay dominios. Use 'A\xF1adir dominio' en el panel lateral.",
    timeouts_name: "Tiempos de espera (segundos)",
    timeouts_desc: "ingest / query / lint / init",
    historyLimit_name: "L\xEDmite de historial",
    historyLimit_desc: "M\xE1ximo de operaciones en el historial del panel lateral.",
    agentLog_name: "Log del agente (JSONL)",
    agentLog_desc: "Registra eventos del agente en <vault>/!Logs/agent.jsonl. La carpeta se crea autom\xE1ticamente.",
    backend_name: "Backend",
    backend_desc: "Selecciona el backend para las operaciones.",
    claudeCodeAgent: "Claude Code agent",
    nativeAgent: "Native agent (OpenAI-compatible)",
    iclaudePath_name: "Ruta a Claude Code",
    iclaudePath_desc: "Obligatorio. Ruta absoluta completa a iclaude.sh / iclaude / claude.",
    model_name: "Modelo",
    model_desc_claude: "Nombre del modelo: sonnet, opus, claude-sonnet-4-6, etc.",
    baseUrl_name: "Base URL",
    baseUrl_desc: "Endpoint compatible con OpenAI. Ollama: http://localhost:11434/v1",
    apiKey_name: "API key",
    apiKey_desc: 'Para Ollama introduce "ollama". Para OpenAI \u2014 clave sk-...',
    model_desc_native: "Nombre del modelo: llama3.2, mistral, gpt-4o, etc.",
    temperature_name: "Temperatura",
    temperature_desc: "0.0\u20131.0.",
    topP_name: "Top-p",
    topP_desc: "0.0\u20131.0, o vac\xEDo \u2014 desactivar.",
    numCtx_name: "Ventana de contexto",
    numCtx_desc: "Tama\xF1o del contexto (num_ctx). Vac\xEDo \u2014 valor por defecto del modelo.",
    allowedTools_name: "Herramientas permitidas",
    allowedTools_desc: "Lista separada por comas para --tools. Vac\xEDo \u2014 sin restricci\xF3n.",
    perOperation_name: "Modelos por operaci\xF3n",
    perOperation_desc: "Configurar modelo y par\xE1metros separados para cada operaci\xF3n.",
    op_ingest: "Ingest",
    op_query: "Query",
    op_lint: "Lint",
    op_init: "Init",
    op_format: "Format",
    opModel_name: "Modelo",
    opModel_desc: "Nombre del modelo para esta operaci\xF3n.",
    opMaxTokens_name: "M\xE1x. tokens",
    opMaxTokens_desc: "M\xE1ximo de tokens para esta operaci\xF3n.",
    opTemperature_name: "Temperatura",
    opTemperature_desc: "Temperatura para esta operaci\xF3n (0\u20132).",
    h3_devmode: "Desarrollo",
    devMode_enabled_name: "Modo dev",
    devMode_enabled_desc: "Activar el registrador dev y el evaluador tras cada operaci\xF3n.",
    devMode_evaluatorModel_name: "Modelo evaluador",
    devMode_evaluatorModel_desc: "Nombre del modelo para el evaluador (mismo backend)."
  },
  view: {
    refreshTitle: "Actualizar dominios",
    addDomain: "A\xF1adir dominio",
    sectionCreate: "Crear",
    sectionDomain: "Rellenar / Mantener",
    sectionQuery: "Consulta",
    ingest: "Ingest",
    lint: "Lint",
    format: "Formatear",
    formatOnlyMarkdown: "El formateo solo funciona con archivos markdown",
    formatInWikiTitle: "El archivo est\xE1 dentro de un dominio wiki",
    formatInWikiBody: (id) => `El archivo pertenece al dominio wiki \xAB${id}\xBB. \xBFRe-ejecutar ingest desde las fuentes?`,
    formatInWikiNoSources: "Sin wiki_sources en frontmatter \u2014 no se puede re-ingestar",
    formatNoPending: "No hay previsualizaci\xF3n de formato",
    formatApplied: (path2) => `Formateado: ${path2}`,
    formatCancelled: "Formateo cancelado",
    formatPreviewHeader: "Previsualizaci\xF3n del formateo",
    formatApply: "Aplicar",
    formatCancelBtn: "Descartar",
    formatRefinePlaceholder: "Refina el formateo (Enter para enviar)\u2026",
    formatMissingTokens: (n) => `\u26A0 ${n} token(s) significativo(s) perdido(s)`,
    fixPlaceholder: "Describe la tarea para el modelo (Enter para enviar, Shift+Enter nueva l\xEDnea)\u2026",
    fixSend: "Enviar",
    chatLabel: "Chat",
    chatSend: "Enviar",
    init: "Init \u2014 nuevo dominio",
    ask: "Preguntar",
    askAndSave: "Preguntar y guardar",
    cancel: "Cancelar",
    result: "Resultado",
    history: "Historial",
    allDomains: "(todos)",
    noHistory: "Sin historial.",
    answerRequired: "LLM Wiki \u2014 se requiere respuesta",
    noActiveFile: "No hay archivo activo",
    selectDomainForInit: "Selecciona un dominio espec\xEDfico para init",
    cwdNotSet: "El directorio de trabajo no est\xE1 configurado",
    enterQuestion: "Introduce una pregunta",
    operationInProgress: "Operaci\xF3n ya en curso",
    stepsCount: (n, s) => `${n} pasos \xB7 ${s}s`,
    starting: "Iniciando",
    initialising: "Inicializando"
  },
  ctrl: {
    cancelling: "Cancelando\u2026",
    noActiveFile: "No hay archivo activo",
    domainAdded: (id) => `Dominio \xAB${id}\xBB a\xF1adido`,
    domainAddFailed: (err) => `Error al a\xF1adir dominio: ${err}`,
    setClaudeCodePath: "Configura la ruta a Claude Code en los ajustes",
    operationRunning: "Ya hay una operaci\xF3n en curso, canc\xE9lala primero",
    errorPrefix: (msg) => `Error: ${msg}`,
    mobileNotAvailable: "Operaci\xF3n no disponible en m\xF3vil",
    configureCloudLlm: "Configura cloud LLM (baseUrl + apiKey) en los ajustes"
  },
  cmd: {
    openPanel: "Abrir panel",
    ingestActive: "Ingest del archivo activo",
    query: "Consulta",
    querySave: "Consulta y guardar como p\xE1gina",
    lint: "Lint del dominio",
    init: "Init del dominio",
    cancel: "Cancelar operaci\xF3n"
  },
  modal: {
    cancel: "Cancelar",
    run: "Ejecutar",
    query: "Consulta",
    queryAndSave: "Consulta + guardar",
    queryPlaceholder: "Formula tu pregunta\u2026",
    domain_name: "Dominio",
    noDomains_desc: "No se encontraron dominios. Crea uno mediante \xABA\xF1adir dominio\xBB.",
    domainIdPlaceholder: "id del dominio",
    allWiki: "(toda la wiki)",
    dryRun_name: "--dry-run",
    addDomain: "A\xF1adir dominio",
    id_name: "ID",
    id_desc: "Letras, d\xEDgitos, gui\xF3n, gui\xF3n bajo. Se usa como nombre de carpeta.",
    idPlaceholder: "ej.: proyectos",
    displayName_name: "Nombre para mostrar",
    wikiFolder_name: "Subcarpeta wiki",
    wikiFolder_desc: (_root) => "Subcarpeta dentro de !Wiki/. Se rellena autom\xE1ticamente desde el ID.",
    wikiFolder_placeholder: (_root) => "ej.: os",
    wikiFolder_editDesc: "!Wiki/[subcarpeta]",
    addDomainNote: "La entrada se guardar\xE1 en la configuraci\xF3n del plugin con entity_types vac\xEDos. Edita el dominio en Ajustes \u2192 Dominios para a\xF1adir entity_types/extraction_cues.",
    addDomainSourcePathsLabel: "Rutas de fuentes",
    addDomainSourcePathsPlaceholder: "Notes/AI/",
    addDomainSourcePathsAdd: "+ A\xF1adir ruta",
    initConfirmTitle: "\xBFIniciar inicializaci\xF3n del dominio?",
    initConfirmBody: (files, folders) => `Se encontraron ${files} archivos .md en ${folders} carpeta(s). \xBFEjecutar init para analizar fuentes y crear p\xE1ginas wiki?`,
    fileErrorTitle: "Error al procesar archivo",
    fileErrorSkip: "Saltar",
    fileErrorRetry: "Reintentar",
    fileErrorStop: "Detener",
    add: "A\xF1adir",
    editDomainTitle: (id) => `Editar dominio: ${id}`,
    entityTypesLabel: "Tipos de entidades",
    entityTypesError: "Array JSON inv\xE1lido \u2014 debe ser un array de objetos",
    sourcePathsLabel: "Rutas fuente",
    entityTypesEditJson: "Editar JSON",
    entityTypesBackToCards: "\u2190 Tarjetas",
    entityTypesEmpty: "No hay tipos de entidades. Haz clic en 'Editar JSON' para a\xF1adir.",
    sourcePathsAdd: "A\xF1adir",
    sourcePathsPlaceholder: "/ruta/a/carpeta o archivo",
    languageNotesLabel: "Notas de idioma",
    save: "Guardar",
    busyCloseTitle: "Operaci\xF3n en curso",
    busyCloseBody: "\xBFAbortar la operaci\xF3n o dejarla ejecutarse en segundo plano?",
    busyCloseAbort: "Abortar operaci\xF3n",
    busyCloseLeave: "Dejar en segundo plano"
  }
};
var locales = { ru, es };
function i18n() {
  const locale = import_obsidian.moment.locale();
  return locales[locale] ?? en;
}

// src/modals.ts
var BusyCloseModal = class extends import_obsidian2.Modal {
  constructor(app, onAbort) {
    super(app);
    this.onAbort = onAbort;
  }
  onOpen() {
    const T = i18n().modal;
    const { contentEl } = this;
    contentEl.createEl("h3", { text: T.busyCloseTitle });
    contentEl.createEl("p", { text: T.busyCloseBody });
    new import_obsidian2.Setting(contentEl).addButton((b) => b.setButtonText(T.busyCloseLeave).onClick(() => this.close())).addButton((b) => b.setButtonText(T.busyCloseAbort).setWarning().onClick(() => {
      this.close();
      this.onAbort();
    }));
  }
  onClose() {
    this.contentEl.empty();
  }
};
var ConfirmModal = class extends import_obsidian2.Modal {
  constructor(app, title, lines, onConfirm) {
    super(app);
    this.title = title;
    this.lines = lines;
    this.onConfirm = onConfirm;
  }
  onOpen() {
    const T = i18n().modal;
    const { contentEl } = this;
    contentEl.createEl("h3", { text: this.title });
    for (const line of this.lines) {
      contentEl.createEl("p", { text: line });
    }
    new import_obsidian2.Setting(contentEl).addButton((b) => b.setButtonText(T.cancel).onClick(() => this.close())).addButton((b) => b.setButtonText(`\u25B6 ${T.run}`).setCta().onClick(() => {
      this.close();
      this.onConfirm();
    }));
  }
  onClose() {
    this.contentEl.empty();
  }
};
var QueryModal = class extends import_obsidian2.Modal {
  constructor(app, save, onSubmit) {
    super(app);
    this.save = save;
    this.onSubmit = onSubmit;
  }
  question = "";
  onOpen() {
    const T = i18n().modal;
    const { contentEl } = this;
    contentEl.createEl("h3", { text: this.save ? T.queryAndSave : T.query });
    const ta = contentEl.createEl("textarea", {
      cls: "llm-wiki-modal-input",
      attr: { rows: "5" },
      placeholder: T.queryPlaceholder
    });
    ta.addEventListener("input", () => {
      this.question = ta.value;
    });
    new import_obsidian2.Setting(contentEl).addButton(
      (b) => b.setButtonText(`\u25B6 ${T.run}`).setCta().onClick(() => {
        const q = this.question.trim();
        if (!q)
          return;
        this.close();
        this.onSubmit(q);
      })
    );
    setTimeout(() => ta.focus(), 0);
  }
  onClose() {
    this.contentEl.empty();
  }
};
var DomainModal = class extends import_obsidian2.Modal {
  constructor(app, title, allowAll, extra, domains, onSubmit) {
    super(app);
    this.title = title;
    this.allowAll = allowAll;
    this.extra = extra;
    this.domains = domains;
    this.onSubmit = onSubmit;
  }
  onOpen() {
    const T = i18n().modal;
    const { contentEl } = this;
    contentEl.createEl("h3", { text: this.title });
    let domain = this.allowAll ? "all" : this.domains[0]?.id ?? "";
    let dryRun = false;
    if (this.domains.length === 0) {
      new import_obsidian2.Setting(contentEl).setName(T.domain_name).setDesc(T.noDomains_desc).addText((t) => t.setPlaceholder(T.domainIdPlaceholder).onChange((v) => {
        domain = v.trim();
      }));
    } else {
      new import_obsidian2.Setting(contentEl).setName(T.domain_name).addDropdown((d) => {
        if (this.allowAll)
          d.addOption("all", T.allWiki);
        for (const entry of this.domains) {
          d.addOption(entry.id, entry.name || entry.id);
        }
        d.setValue(domain);
        d.onChange((v) => {
          domain = v;
        });
      });
    }
    if (this.extra && "dryRun" in this.extra) {
      new import_obsidian2.Setting(contentEl).setName(T.dryRun_name).addToggle((t) => t.onChange((v) => {
        dryRun = v;
      }));
    }
    new import_obsidian2.Setting(contentEl).addButton(
      (b) => b.setButtonText(`\u25B6 ${T.run}`).setCta().onClick(() => {
        this.close();
        this.onSubmit(domain, { dryRun });
      })
    );
  }
  onClose() {
    this.contentEl.empty();
  }
};
function attachFolderDropdown(app, inputEl, onSelect) {
  let dropEl = null;
  const hideDropdown = () => {
    dropEl?.remove();
    dropEl = null;
  };
  const showDropdown = (folders) => {
    hideDropdown();
    if (!folders.length)
      return;
    const rect = inputEl.getBoundingClientRect();
    dropEl = document.body.createDiv({ cls: "llm-wiki-folder-dropdown" });
    dropEl.style.top = `${rect.bottom + window.scrollY}px`;
    dropEl.style.left = `${rect.left + window.scrollX}px`;
    dropEl.style.width = `${rect.width}px`;
    for (const folder of folders) {
      const item = dropEl.createDiv({ cls: "llm-wiki-folder-dropdown-item" });
      item.setText(folder.path + "/");
      item.addEventListener("mousedown", (e) => {
        e.preventDefault();
        hideDropdown();
        onSelect(folder.path + "/");
      });
    }
  };
  inputEl.addEventListener("input", () => {
    const lower = inputEl.value.toLowerCase();
    if (!lower) {
      hideDropdown();
      return;
    }
    const matches = app.vault.getAllFolders(true).filter((f) => f.path.toLowerCase().includes(lower)).slice(0, 20);
    showDropdown(matches);
  });
  inputEl.addEventListener("blur", hideDropdown);
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Escape")
      hideDropdown();
  });
}
var AddDomainModal = class extends import_obsidian2.Modal {
  constructor(app, onSubmit) {
    super(app);
    this.onSubmit = onSubmit;
  }
  input = { id: "", name: "", wikiFolder: "", sourcePaths: [] };
  wikiFolderInput = null;
  sourcePathsContainer = null;
  onOpen() {
    const T = i18n().modal;
    const { contentEl } = this;
    contentEl.createEl("h3", { text: T.addDomain });
    new import_obsidian2.Setting(contentEl).setName(T.id_name).setDesc(T.id_desc).addText(
      (t) => t.setPlaceholder(T.idPlaceholder).onChange((v) => {
        this.input.id = v.trim();
        if (this.wikiFolderInput && !this.input.wikiFolder) {
          this.wikiFolderInput.setValue(this.input.id);
        }
      })
    );
    new import_obsidian2.Setting(contentEl).setName(T.displayName_name).addText((t) => t.setPlaceholder(T.idPlaceholder).onChange((v) => {
      this.input.name = v.trim();
    }));
    new import_obsidian2.Setting(contentEl).setName(T.wikiFolder_name).setDesc(T.wikiFolder_desc("")).addText((t) => {
      t.setPlaceholder(T.wikiFolder_placeholder("")).onChange((v) => {
        this.input.wikiFolder = v.trim();
      });
      this.wikiFolderInput = t;
    });
    this.sourcePathsContainer = contentEl.createDiv();
    this.renderSourcePaths();
    new import_obsidian2.Setting(contentEl).addButton(
      (b) => b.setButtonText(T.add).setCta().onClick(() => {
        if (!this.input.id)
          return;
        this.close();
        this.onSubmit(this.input);
      })
    );
  }
  renderSourcePaths() {
    if (!this.sourcePathsContainer)
      return;
    this.sourcePathsContainer.empty();
    const T = i18n().modal;
    const header = this.sourcePathsContainer.createDiv({ cls: "llm-wiki-sp-header" });
    header.createEl("span", { text: T.addDomainSourcePathsLabel, cls: "llm-wiki-sp-label" });
    const listEl = this.sourcePathsContainer.createDiv({ cls: "llm-wiki-sp-list" });
    const rerender = () => {
      listEl.empty();
      this.input.sourcePaths.forEach((p, i) => {
        const row = listEl.createDiv({ cls: "llm-wiki-sp-row" });
        row.createEl("span", { text: p, cls: "llm-wiki-sp-path", attr: { title: p } });
        const removeBtn = row.createEl("button", { text: "\xD7", cls: "llm-wiki-sp-remove" });
        removeBtn.addEventListener("click", () => {
          this.input.sourcePaths.splice(i, 1);
          rerender();
        });
      });
    };
    rerender();
    const addRow = this.sourcePathsContainer.createDiv({ cls: "llm-wiki-sp-add-row" });
    const inputEl = addRow.createEl("input", {
      cls: "llm-wiki-sp-input",
      attr: { type: "text", placeholder: T.addDomainSourcePathsPlaceholder }
    });
    const addPath = (val) => {
      const v = val ?? inputEl.value.trim();
      if (!v || this.input.sourcePaths.includes(v))
        return;
      this.input.sourcePaths.push(v);
      inputEl.value = "";
      rerender();
    };
    attachFolderDropdown(this.app, inputEl, addPath);
    inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        addPath();
      }
    });
  }
  onClose() {
    this.contentEl.empty();
  }
};
var FileErrorModal = class extends import_obsidian2.Modal {
  constructor(app, file, err, canRetry) {
    super(app);
    this.file = file;
    this.err = err;
    this.canRetry = canRetry;
    this.result = new Promise((res) => {
      this.resolve = res;
    });
  }
  resolve;
  result;
  resolved = false;
  pick(choice) {
    if (this.resolved)
      return;
    this.resolved = true;
    this.close();
    this.resolve(choice);
  }
  onOpen() {
    const T = i18n().modal;
    const { contentEl } = this;
    contentEl.createEl("h3", { text: T.fileErrorTitle });
    contentEl.createEl("p", { text: this.file, cls: "llm-wiki-file-error-path" });
    contentEl.createEl("p", { text: this.err.message, cls: "llm-wiki-file-error-msg" });
    const setting = new import_obsidian2.Setting(contentEl);
    setting.addButton(
      (b) => b.setButtonText(T.fileErrorSkip).onClick(() => this.pick("skip"))
    );
    if (this.canRetry) {
      setting.addButton(
        (b) => b.setButtonText(T.fileErrorRetry).onClick(() => this.pick("retry"))
      );
    }
    setting.addButton(
      (b) => b.setButtonText(T.fileErrorStop).setWarning().onClick(() => this.pick("stop"))
    );
  }
  onClose() {
    this.contentEl.empty();
    if (!this.resolved) {
      this.resolved = true;
      this.resolve("skip");
    }
  }
};
var EditDomainModal = class extends import_obsidian2.Modal {
  constructor(app, domain, onSave) {
    super(app);
    this.domain = domain;
    this.onSave = onSave;
    this.nameVal = domain.name;
    this.wikiFolderVal = domain.wiki_folder;
    this.entityTypesList = [...domain.entity_types ?? []];
    this.entityTypesVal = JSON.stringify(domain.entity_types ?? [], null, 2);
    this.sourcePathsList = [...domain.source_paths ?? []];
    this.languageNotesVal = domain.language_notes ?? "";
  }
  nameVal;
  wikiFolderVal;
  entityTypesMode = "cards";
  entityTypesList;
  entityTypesVal;
  sourcePathsList;
  languageNotesVal;
  errorEl = null;
  onOpen() {
    const T = i18n().modal;
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: T.editDomainTitle(this.domain.id) });
    new import_obsidian2.Setting(contentEl).setName(T.displayName_name).addText((t) => t.setValue(this.nameVal).onChange((v) => {
      this.nameVal = v;
    }));
    new import_obsidian2.Setting(contentEl).setName(T.wikiFolder_name).setDesc(T.wikiFolder_editDesc).addText((t) => t.setValue(this.wikiFolderVal).onChange((v) => {
      this.wikiFolderVal = v;
    }));
    const entityTypesContainer = contentEl.createDiv();
    this.renderEntityTypes(entityTypesContainer);
    const sourcePathsContainer = contentEl.createDiv();
    this.renderSourcePaths(sourcePathsContainer);
    new import_obsidian2.Setting(contentEl).setName(T.languageNotesLabel).addTextArea((t) => {
      t.inputEl.rows = 4;
      t.setValue(this.languageNotesVal).onChange((v) => {
        this.languageNotesVal = v;
      });
    });
    this.errorEl = contentEl.createEl("p", { cls: "mod-warning llm-wiki-hidden" });
    new import_obsidian2.Setting(contentEl).addButton((b) => b.setButtonText(T.cancel).onClick(() => this.close())).addButton((b) => b.setButtonText(T.save).setCta().onClick(() => this.handleSave()));
  }
  renderEntityTypes(container) {
    container.empty();
    const T = i18n().modal;
    const header = container.createDiv({ cls: "llm-wiki-et-header" });
    header.createEl("span", { text: T.entityTypesLabel, cls: "llm-wiki-et-label" });
    const toggleBtn = header.createEl("button", {
      text: this.entityTypesMode === "cards" ? T.entityTypesEditJson : T.entityTypesBackToCards
    });
    if (this.entityTypesMode === "cards") {
      toggleBtn.addEventListener("click", () => {
        this.entityTypesVal = JSON.stringify(this.entityTypesList, null, 2);
        this.entityTypesMode = "json";
        this.renderEntityTypes(container);
      });
      if (this.entityTypesList.length === 0) {
        container.createEl("p", { text: T.entityTypesEmpty, cls: "setting-item-description" });
      } else {
        for (const et of this.entityTypesList) {
          this.renderEntityTypeCard(container, et);
        }
      }
    } else {
      const ta = container.createEl("textarea", {
        cls: "llm-wiki-settings-textarea llm-wiki-monospace",
        attr: { rows: "10" }
      });
      ta.value = this.entityTypesVal;
      ta.addEventListener("input", () => {
        this.entityTypesVal = ta.value;
      });
      const jsonErrorEl = container.createEl("p", { cls: "mod-warning llm-wiki-hidden" });
      toggleBtn.addEventListener("click", () => {
        try {
          const parsed = JSON.parse(this.entityTypesVal.trim() || "[]");
          if (!Array.isArray(parsed))
            throw new Error();
          if (!parsed.every((x) => typeof x === "object" && x !== null && !Array.isArray(x))) {
            throw new Error();
          }
          this.entityTypesList = parsed;
          this.entityTypesMode = "cards";
          this.renderEntityTypes(container);
        } catch {
          jsonErrorEl.textContent = T.entityTypesError;
          jsonErrorEl.removeClass("llm-wiki-hidden");
        }
      });
    }
  }
  renderSourcePaths(container) {
    container.empty();
    const T = i18n().modal;
    const header = container.createDiv({ cls: "llm-wiki-sp-header" });
    header.createEl("span", { text: T.sourcePathsLabel, cls: "llm-wiki-sp-label" });
    const listEl = container.createDiv({ cls: "llm-wiki-sp-list" });
    const rerender = () => {
      listEl.empty();
      this.sourcePathsList.forEach((p, i) => {
        const row = listEl.createDiv({ cls: "llm-wiki-sp-row" });
        row.createEl("span", { text: p, cls: "llm-wiki-sp-path", attr: { title: p } });
        const removeBtn = row.createEl("button", { text: "\xD7", cls: "llm-wiki-sp-remove" });
        removeBtn.addEventListener("click", () => {
          this.sourcePathsList.splice(i, 1);
          rerender();
        });
      });
    };
    rerender();
    const addRow = container.createDiv({ cls: "llm-wiki-sp-add-row" });
    const input = addRow.createEl("input", {
      cls: "llm-wiki-sp-input",
      attr: { type: "text", placeholder: T.sourcePathsPlaceholder }
    });
    const addPath = (val) => {
      const v = val ?? input.value.trim();
      if (!v || this.sourcePathsList.includes(v))
        return;
      this.sourcePathsList.push(v);
      input.value = "";
      rerender();
    };
    attachFolderDropdown(this.app, input, addPath);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        addPath();
      }
    });
  }
  renderEntityTypeCard(container, et) {
    const card = container.createDiv({ cls: "llm-wiki-et-card" });
    const head = card.createDiv({ cls: "llm-wiki-et-card-head" });
    head.createEl("span", { text: et.type, cls: "llm-wiki-et-card-type" });
    if (et.wiki_subfolder) {
      head.createEl("span", { text: et.wiki_subfolder + "/", cls: "llm-wiki-et-card-subfolder" });
    }
    const body = card.createDiv({ cls: "llm-wiki-et-card-body" });
    if (et.description) {
      body.createEl("p", { text: et.description, cls: "llm-wiki-et-card-desc" });
    }
    if (et.extraction_cues?.length) {
      const tags = body.createDiv({ cls: "llm-wiki-et-card-tags" });
      for (const cue of et.extraction_cues) {
        tags.createEl("span", { text: cue, cls: "llm-wiki-et-card-tag" });
      }
    }
    if (et.min_mentions_for_page != null) {
      body.createEl("small", { text: `min_mentions: ${et.min_mentions_for_page}`, cls: "llm-wiki-et-card-meta" });
    }
  }
  handleSave() {
    this.errorEl?.addClass("llm-wiki-hidden");
    let entityTypes;
    if (this.entityTypesMode === "cards") {
      entityTypes = this.entityTypesList;
    } else {
      try {
        const parsed = JSON.parse(this.entityTypesVal.trim() || "[]");
        if (!Array.isArray(parsed))
          throw new Error("not an array");
        if (!parsed.every((x) => typeof x === "object" && x !== null && !Array.isArray(x))) {
          throw new Error("not an array of objects");
        }
        entityTypes = parsed;
      } catch {
        if (this.errorEl) {
          this.errorEl.textContent = i18n().modal.entityTypesError;
          this.errorEl.removeClass("llm-wiki-hidden");
        }
        return;
      }
    }
    const updated = {
      ...this.domain,
      name: this.nameVal.trim() || this.domain.name,
      wiki_folder: this.wikiFolderVal.trim() || this.domain.wiki_folder,
      source_paths: this.sourcePathsList.filter(Boolean),
      entity_types: entityTypes,
      language_notes: this.languageNotesVal.trim()
    };
    this.close();
    this.onSave(updated);
  }
  onClose() {
    this.contentEl.empty();
  }
};

// src/effective-settings.ts
function resolveEffective(s, l) {
  return {
    ...s,
    backend: l.backend ?? s.backend,
    agentLogEnabled: l.agentLogEnabled ?? s.agentLogEnabled,
    claudeAgent: { ...s.claudeAgent, ...l.claudeAgent ?? {} },
    nativeAgent: { ...s.nativeAgent, ...l.nativeAgent ?? {} }
  };
}

// src/settings.ts
var LlmWikiSettingTab = class extends import_obsidian3.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  cachedDomains = [];
  localCache = { iclaudePath: "" };
  display() {
    void this.refresh();
  }
  async refresh() {
    try {
      this.cachedDomains = await this.plugin.domainStore.load();
    } catch (e) {
      this.cachedDomains = [];
      new import_obsidian3.Notice(`Domain map load failed: ${e.message}`);
    }
    this.localCache = await this.plugin.localConfigStore.load();
    this.render();
  }
  async patchLocal(patch) {
    this.localCache = { ...this.localCache, ...patch };
    await this.plugin.localConfigStore.save(patch);
  }
  async patchLocalNative(patch) {
    const cur = this.localCache.nativeAgent ?? {
      baseUrl: this.plugin.settings.nativeAgent.baseUrl,
      apiKey: this.plugin.settings.nativeAgent.apiKey,
      model: this.plugin.settings.nativeAgent.model,
      temperature: this.plugin.settings.nativeAgent.temperature,
      topP: this.plugin.settings.nativeAgent.topP,
      numCtx: this.plugin.settings.nativeAgent.numCtx
    };
    await this.patchLocal({ nativeAgent: { ...cur, ...patch } });
  }
  async patchLocalClaude(patch) {
    const cur = this.localCache.claudeAgent ?? {
      model: this.plugin.settings.claudeAgent.model,
      allowedTools: this.plugin.settings.claudeAgent.allowedTools
    };
    await this.patchLocal({ claudeAgent: { ...cur, ...patch } });
  }
  render() {
    const { containerEl } = this;
    containerEl.empty();
    const s = this.plugin.settings;
    const eff = resolveEffective(s, this.localCache);
    const T = i18n();
    const busy = this.plugin.controller.running;
    if (busy) {
      containerEl.createEl("div", {
        text: T.settings.busyBanner,
        cls: "setting-item-description llm-wiki-settings-busy-banner"
      });
    }
    new import_obsidian3.Setting(containerEl).setName(T.settings.h3_general).setHeading();
    new import_obsidian3.Setting(containerEl).setName(T.settings.systemPrompt_name).setDesc(T.settings.systemPrompt_desc).addTextArea((t) => {
      t.inputEl.addClass("llm-wiki-settings-textarea");
      t.setValue(s.systemPrompt).onChange(async (v) => {
        s.systemPrompt = v;
        await this.plugin.saveSettings();
      });
      return t;
    });
    const isPerOp = eff.backend === "claude-agent" ? s.claudeAgent.perOperation : s.nativeAgent.perOperation;
    if (!isPerOp && eff.backend !== "claude-agent") {
      new import_obsidian3.Setting(containerEl).setName(T.settings.maxTokens_name).setDesc(T.settings.maxTokens_desc).addText(
        (t) => t.setPlaceholder("4096").setValue(String(s.maxTokens)).onChange(async (v) => {
          const n = Number(v);
          if (Number.isFinite(n) && n > 0) {
            s.maxTokens = Math.floor(n);
            await this.plugin.saveSettings();
          }
        })
      );
    }
    new import_obsidian3.Setting(containerEl).setName(T.settings.timeouts_name).setDesc(T.settings.timeouts_desc).addText(
      (t) => t.setValue(`${s.timeouts.ingest}/${s.timeouts.query}/${s.timeouts.lint}/${s.timeouts.init}`).onChange(async (v) => {
        const parts = v.split("/").map((x) => Number(x.trim()));
        if (parts.length === 4 && parts.every((n) => Number.isFinite(n) && n > 0)) {
          s.timeouts = { ingest: parts[0], query: parts[1], lint: parts[2], init: parts[3] };
          await this.plugin.saveSettings();
        }
      })
    );
    new import_obsidian3.Setting(containerEl).setName(T.settings.historyLimit_name).setDesc(T.settings.historyLimit_desc).addText(
      (t) => t.setValue(String(s.historyLimit)).onChange(async (v) => {
        const n = Number(v);
        if (Number.isFinite(n) && n > 0) {
          s.historyLimit = Math.floor(n);
          await this.plugin.saveSettings();
        }
      })
    );
    if (!import_obsidian3.Platform.isMobile) {
      new import_obsidian3.Setting(containerEl).setName(T.settings.agentLog_name).setDesc(T.settings.agentLog_desc).addToggle(
        (t) => t.setValue(eff.agentLogEnabled).onChange(async (v) => {
          await this.patchLocal({ agentLogEnabled: v });
        })
      );
    }
    new import_obsidian3.Setting(containerEl).setName(T.settings.domains_heading).setHeading();
    const domains = this.cachedDomains;
    if (domains.length === 0) {
      containerEl.createEl("p", {
        text: T.settings.domains_empty,
        cls: "setting-item-description"
      });
    } else {
      for (let i = 0; i < domains.length; i++) {
        const d = domains[i];
        new import_obsidian3.Setting(containerEl).setName(d.name || d.id).setDesc(d.id).addButton((b) => {
          b.setButtonText(T.settings.editDomain).setDisabled(busy).onClick(() => {
            new EditDomainModal(this.plugin.app, d, (updated) => {
              void (async () => {
                const cur = await this.plugin.domainStore.load();
                const idx = cur.findIndex((x) => x.id === updated.id);
                if (idx >= 0)
                  cur[idx] = updated;
                await this.plugin.domainStore.save(cur);
                await this.refresh();
              })();
            }).open();
          });
        }).addButton((b) => {
          b.setButtonText(T.settings.deleteDomain).setWarning().setDisabled(busy).onClick(() => {
            new ConfirmModal(this.plugin.app, T.settings.confirmDeleteDomain(d.id), [], () => {
              void (async () => {
                new import_obsidian3.Notice(T.settings.domainDeleted(d.id));
                const cur = await this.plugin.domainStore.load();
                await this.plugin.domainStore.save(cur.filter((x) => x.id !== d.id));
                await this.refresh();
              })();
            }).open();
          });
        });
      }
    }
    new import_obsidian3.Setting(containerEl).setName(T.settings.h3_backend).setHeading();
    if (!import_obsidian3.Platform.isMobile) {
      new import_obsidian3.Setting(containerEl).setName(T.settings.backend_name).setDesc(T.settings.backend_desc).addDropdown(
        (d) => d.addOption("claude-agent", T.settings.claudeCodeAgent).addOption("native-agent", T.settings.nativeAgent).setValue(eff.backend).onChange(async (v) => {
          await this.patchLocal({ backend: v });
          this.display();
        })
      );
    } else {
      const p = containerEl.createEl("p", {
        text: "Mobile: cloud LLM (native-agent) only. Setup guide: ",
        cls: "setting-item-description"
      });
      p.createEl("a", {
        text: "ikeniborn/obsidian-llm-wiki \u2014 mobile-cloud-ollama.md",
        href: "https://github.com/ikeniborn/obsidian-llm-wiki/blob/master/docs/mobile-cloud-ollama.md"
      });
    }
    if (eff.backend === "claude-agent" && !import_obsidian3.Platform.isMobile) {
      new import_obsidian3.Setting(containerEl).setName(T.settings.iclaudePath_name).setDesc(T.settings.iclaudePath_desc).addText(
        (t) => t.setPlaceholder("/home/user/Documents/Project/iclaude/iclaude.sh").setValue(this.localCache.iclaudePath).onChange(async (v) => {
          await this.patchLocal({ iclaudePath: v.trim() });
        })
      );
      if (!s.claudeAgent.perOperation) {
        new import_obsidian3.Setting(containerEl).setName(T.settings.model_name).setDesc(T.settings.model_desc_claude).addText(
          (t) => t.setPlaceholder("").setValue(eff.claudeAgent.model).onChange(async (v) => {
            await this.patchLocalClaude({ model: v.trim() });
          })
        );
      }
      new import_obsidian3.Setting(containerEl).setName(T.settings.allowedTools_name).setDesc(T.settings.allowedTools_desc).addText(
        (t) => t.setPlaceholder("Bash,read,write").setValue(eff.claudeAgent.allowedTools).onChange(async (v) => {
          await this.patchLocalClaude({ allowedTools: v.trim() });
        })
      );
      new import_obsidian3.Setting(containerEl).setName(T.settings.perOperation_name).setDesc(T.settings.perOperation_desc).addToggle(
        (t) => t.setValue(s.claudeAgent.perOperation).onChange(async (v) => {
          s.claudeAgent.perOperation = v;
          await this.plugin.saveSettings();
          this.display();
        })
      );
      if (s.claudeAgent.perOperation) {
        const ops = [
          { key: "ingest", label: T.settings.op_ingest },
          { key: "query", label: T.settings.op_query },
          { key: "lint", label: T.settings.op_lint },
          { key: "init", label: T.settings.op_init },
          { key: "format", label: T.settings.op_format }
        ];
        for (const { key, label } of ops) {
          new import_obsidian3.Setting(containerEl).setName(label).setHeading();
          new import_obsidian3.Setting(containerEl).setName(T.settings.opModel_name).setDesc(T.settings.opModel_desc).addText(
            (t) => t.setValue(s.claudeAgent.operations[key].model).onChange(async (v) => {
              s.claudeAgent.operations[key].model = v.trim();
              await this.plugin.saveSettings();
            })
          );
          new import_obsidian3.Setting(containerEl).setName(T.settings.opMaxTokens_name).setDesc(T.settings.opMaxTokens_desc).addText(
            (t) => t.setValue(String(s.claudeAgent.operations[key].maxTokens)).onChange(async (v) => {
              const n = Number(v);
              if (Number.isFinite(n) && n > 0) {
                s.claudeAgent.operations[key].maxTokens = Math.floor(n);
                await this.plugin.saveSettings();
              }
            })
          );
        }
      }
    } else {
      new import_obsidian3.Setting(containerEl).setName(T.settings.baseUrl_name).setDesc(T.settings.baseUrl_desc).addText(
        (t) => t.setPlaceholder("").setValue(eff.nativeAgent.baseUrl).onChange(async (v) => {
          await this.patchLocalNative({ baseUrl: v.trim() });
        })
      );
      new import_obsidian3.Setting(containerEl).setName(T.settings.apiKey_name).setDesc(T.settings.apiKey_desc).addText(
        (t) => t.setPlaceholder("Ollama").setValue(eff.nativeAgent.apiKey).onChange(async (v) => {
          await this.patchLocalNative({ apiKey: v.trim() });
        })
      );
      if (!s.nativeAgent.perOperation) {
        new import_obsidian3.Setting(containerEl).setName(T.settings.model_name).setDesc(T.settings.model_desc_native).addText(
          (t) => t.setPlaceholder("llama3.2").setValue(eff.nativeAgent.model).onChange(async (v) => {
            await this.patchLocalNative({ model: v.trim() });
          })
        );
        new import_obsidian3.Setting(containerEl).setName(T.settings.numCtx_name).setDesc(T.settings.numCtx_desc).addText(
          (t) => t.setPlaceholder("(\u0434\u0435\u0444\u043E\u043B\u0442 \u043C\u043E\u0434\u0435\u043B\u0438)").setValue(eff.nativeAgent.numCtx != null ? String(eff.nativeAgent.numCtx) : "").onChange(async (v) => {
            const trimmed = v.trim();
            if (!trimmed) {
              await this.patchLocalNative({ numCtx: null });
              return;
            }
            const n = Number(trimmed);
            if (Number.isFinite(n) && n > 0)
              await this.patchLocalNative({ numCtx: Math.floor(n) });
          })
        );
        new import_obsidian3.Setting(containerEl).setName(T.settings.temperature_name).setDesc(T.settings.temperature_desc).addText(
          (t) => t.setPlaceholder("0.2").setValue(String(eff.nativeAgent.temperature)).onChange(async (v) => {
            const n = Number(v);
            if (Number.isFinite(n) && n >= 0 && n <= 2)
              await this.patchLocalNative({ temperature: n });
          })
        );
      }
      if (!import_obsidian3.Platform.isMobile) {
        new import_obsidian3.Setting(containerEl).setName(T.settings.perOperation_name).setDesc(T.settings.perOperation_desc).addToggle(
          (t) => t.setValue(s.nativeAgent.perOperation).onChange(async (v) => {
            s.nativeAgent.perOperation = v;
            await this.plugin.saveSettings();
            this.display();
          })
        );
      }
      if (s.nativeAgent.perOperation) {
        const ops = [
          { key: "ingest", label: T.settings.op_ingest },
          { key: "query", label: T.settings.op_query },
          { key: "lint", label: T.settings.op_lint },
          { key: "init", label: T.settings.op_init },
          { key: "format", label: T.settings.op_format }
        ];
        for (const { key, label } of ops) {
          new import_obsidian3.Setting(containerEl).setName(label).setHeading();
          new import_obsidian3.Setting(containerEl).setName(T.settings.opModel_name).setDesc(T.settings.opModel_desc).addText(
            (t) => t.setValue(s.nativeAgent.operations[key].model).onChange(async (v) => {
              s.nativeAgent.operations[key].model = v.trim();
              await this.plugin.saveSettings();
            })
          );
          new import_obsidian3.Setting(containerEl).setName(T.settings.opMaxTokens_name).setDesc(T.settings.opMaxTokens_desc).addText(
            (t) => t.setValue(String(s.nativeAgent.operations[key].maxTokens)).onChange(async (v) => {
              const n = Number(v);
              if (Number.isFinite(n) && n > 0) {
                s.nativeAgent.operations[key].maxTokens = Math.floor(n);
                await this.plugin.saveSettings();
              }
            })
          );
          new import_obsidian3.Setting(containerEl).setName(T.settings.opTemperature_name).setDesc(T.settings.opTemperature_desc).addText(
            (t) => t.setValue(String(s.nativeAgent.operations[key].temperature)).onChange(async (v) => {
              const n = Number(v);
              if (Number.isFinite(n) && n >= 0 && n <= 2) {
                s.nativeAgent.operations[key].temperature = n;
                await this.plugin.saveSettings();
              }
            })
          );
        }
      }
    }
    if (!import_obsidian3.Platform.isMobile) {
      new import_obsidian3.Setting(containerEl).setName(T.settings.h3_devmode).setHeading();
      new import_obsidian3.Setting(containerEl).setName(T.settings.devMode_enabled_name).setDesc(T.settings.devMode_enabled_desc).addToggle(
        (t) => t.setValue(s.devMode.enabled).onChange(async (v) => {
          s.devMode.enabled = v;
          await this.plugin.saveSettings();
          this.display();
        })
      );
      if (s.devMode.enabled) {
        new import_obsidian3.Setting(containerEl).setName(T.settings.devMode_evaluatorModel_name).setDesc(T.settings.devMode_evaluatorModel_desc).addText(
          (t) => t.setPlaceholder("").setValue(s.devMode.evaluatorModel).onChange(async (v) => {
            s.devMode.evaluatorModel = v.trim();
            await this.plugin.saveSettings();
          })
        );
      }
    }
  }
};

// src/view.ts
var import_obsidian4 = require("obsidian");
var LLM_WIKI_VIEW_TYPE = "llm-wiki-view";
function registerLinkHandler(el, app) {
  el.addEventListener("click", (e) => {
    const a = e.target.closest("a.internal-link");
    if (!a)
      return;
    e.preventDefault();
    const href = a.getAttribute("data-href") ?? a.getAttribute("href") ?? "";
    if (href)
      void app.workspace.openLinkText(href, "", false);
  });
}
var PREVIEW_INLINE = 140;
var ASSISTANT_TEXT_MAX = 600;
var LlmWikiView = class extends import_obsidian4.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
  }
  state = "idle";
  stepsEl;
  finalEl;
  resultSection;
  resultToggle;
  resultOpen = false;
  historyEl;
  historySection;
  historyToggle;
  historyOpen = false;
  statusEl;
  progressToggle;
  progressCount;
  stepsOpen = true;
  cancelBtn;
  queryInput;
  askBtn;
  askSaveBtn;
  domainSelect;
  initBtn;
  ingestBtn;
  lintBtn;
  formatBtn;
  formatPreviewSection = null;
  fixChatEl = null;
  lastContext = null;
  // Chat state
  chatSection = null;
  chatMessagesEl = null;
  chatInputEl = null;
  chatSendBtn = null;
  chatHistory = [];
  chatToggle = null;
  chatOpen = true;
  chatBodyEl = null;
  currentChatBubble = null;
  currentChatBuffer = "";
  chatTickHandle = null;
  chatStartTs = 0;
  lastUserMessage = "";
  startTs = 0;
  toolCount = 0;
  stepCount = 0;
  progressEl = null;
  progressTotal = 0;
  progressDone = 0;
  tickHandle = null;
  currentToolStep = null;
  currentToolStartedAt = 0;
  assistantBlock = null;
  assistantBuffer = "";
  reasoningBlock = null;
  reasoningBuffer = "";
  getViewType() {
    return LLM_WIKI_VIEW_TYPE;
  }
  getDisplayText() {
    return "LLM wiki";
  }
  getIcon() {
    return "brain-circuit";
  }
  onOpen() {
    const root = this.containerEl.children[1];
    root.empty();
    root.addClass("llm-wiki-view");
    const T = i18n();
    const header = root.createDiv("llm-wiki-header");
    header.createEl("h3", { text: "LLM wiki" });
    this.statusEl = header.createDiv("llm-wiki-status");
    root.createDiv({ cls: "llm-wiki-section-label", text: T.view.sectionCreate });
    const createRow = root.createDiv("llm-wiki-create-row");
    this.initBtn = createRow.createEl("button", { text: T.view.init, cls: "llm-wiki-init-btn" });
    this.initBtn.addEventListener("click", () => this.openAddDomain());
    root.createDiv({ cls: "llm-wiki-section-label", text: T.view.sectionDomain });
    const domainBox = root.createDiv("llm-wiki-domain");
    const domainRow = domainBox.createDiv("llm-wiki-domain-row");
    domainRow.createSpan({ cls: "muted", text: "Domain:" });
    this.domainSelect = domainRow.createEl("select", { cls: "llm-wiki-domain-select" });
    const refreshBtn = domainRow.createEl("button", { text: "\u21BB", attr: { title: T.view.refreshTitle } });
    refreshBtn.addEventListener("click", () => this.refreshDomains());
    const actionRow = domainBox.createDiv("llm-wiki-domain-actions");
    this.ingestBtn = actionRow.createEl("button", { text: T.view.ingest });
    this.lintBtn = actionRow.createEl("button", { text: T.view.lint });
    this.formatBtn = actionRow.createEl("button", { text: T.view.format });
    this.formatBtn.addEventListener("click", () => void this.plugin.controller.format());
    this.ingestBtn.addEventListener("click", () => {
      const file = this.plugin.app.workspace.getActiveFile();
      if (!file) {
        new import_obsidian4.Notice(i18n().view.noActiveFile);
        return;
      }
      const domainId = this.domainSelect.value || void 0;
      new ConfirmModal(this.plugin.app, "Ingest \u2014 confirm", [
        `File: ${file.name}`,
        "Claude will read the file, extract entities and update domain wiki pages."
      ], () => void this.plugin.controller.ingestActive(domainId)).open();
    });
    this.lintBtn.addEventListener("click", () => {
      const d = this.domainSelect.value;
      const domainLabel = d ? `\xAB${d}\xBB` : "all wiki";
      new ConfirmModal(this.plugin.app, "Lint \u2014 confirm", [
        `Domain: ${domainLabel}`,
        "Claude will check wiki pages for quality and update entity_types."
      ], () => void this.plugin.controller.lint(d || "all")).open();
    });
    this.refreshDomains();
    root.createDiv({ cls: "llm-wiki-section-label", text: T.view.sectionQuery });
    const ask = root.createDiv("llm-wiki-ask");
    this.queryInput = ask.createEl("textarea", {
      cls: "llm-wiki-query-input",
      attr: { placeholder: "Question\u2026", rows: "3" }
    });
    const askRow = ask.createDiv("llm-wiki-ask-row");
    this.askBtn = askRow.createEl("button", { text: T.view.ask });
    this.askSaveBtn = askRow.createEl("button", { text: T.view.askAndSave });
    this.cancelBtn = askRow.createEl("button", { text: T.view.cancel, cls: "mod-warning" });
    this.cancelBtn.disabled = true;
    this.askBtn.addEventListener("click", () => this.submitQuery(false));
    this.askSaveBtn.addEventListener("click", () => this.submitQuery(true));
    this.cancelBtn.addEventListener("click", () => this.plugin.controller.cancelCurrent());
    const progressHeader = root.createDiv("llm-wiki-progress-header");
    const progressH4 = progressHeader.createEl("h4", { cls: "llm-wiki-progress-title" });
    this.progressToggle = progressH4.createSpan({ cls: "llm-wiki-progress-arrow", text: "\u25B6" });
    progressH4.appendText(" Progress ");
    this.progressCount = progressH4.createSpan({ cls: "llm-wiki-progress-count muted", text: "" });
    progressHeader.addEventListener("click", () => this.toggleSteps());
    this.stepsEl = root.createDiv("llm-wiki-steps");
    this.stepsEl.addClass("llm-wiki-hidden");
    this.resultSection = root.createDiv("llm-wiki-result-section llm-wiki-hidden");
    const resultHeader = this.resultSection.createDiv("llm-wiki-progress-header");
    const resultH4 = resultHeader.createEl("h4", { cls: "llm-wiki-progress-title" });
    this.resultToggle = resultH4.createSpan({ cls: "llm-wiki-progress-arrow", text: "\u25B6" });
    resultH4.appendText(` ${T.view.result}`);
    resultHeader.addEventListener("click", () => this.toggleResult());
    this.finalEl = this.resultSection.createDiv("llm-wiki-final llm-wiki-hidden");
    registerLinkHandler(this.finalEl, this.app);
    this.historySection = root.createDiv("llm-wiki-history-section llm-wiki-hidden");
    const historyHeader = this.historySection.createDiv("llm-wiki-progress-header");
    const historyH4 = historyHeader.createEl("h4", { cls: "llm-wiki-progress-title" });
    this.historyToggle = historyH4.createSpan({ cls: "llm-wiki-progress-arrow", text: "\u25B6" });
    historyH4.appendText(` ${T.view.history}`);
    historyHeader.addEventListener("click", () => this.toggleHistory());
    this.historyEl = this.historySection.createDiv("llm-wiki-history llm-wiki-hidden");
    this.renderHistory();
    const ongoing = this.plugin.controller.currentOp;
    if (ongoing) {
      this.setRunning(ongoing.op, ongoing.args);
    }
  }
  onClose() {
    if (this.tickHandle !== null)
      window.clearInterval(this.tickHandle);
    if (this.chatTickHandle !== null)
      window.clearInterval(this.chatTickHandle);
    if (this.plugin.controller.isBusy()) {
      new BusyCloseModal(this.app, () => this.plugin.controller.cancelCurrent()).open();
    }
  }
  async refreshDomains() {
    let domains;
    try {
      domains = await this.plugin.controller.loadDomains();
    } catch {
      return;
    }
    const previous = this.domainSelect.value;
    this.domainSelect.empty();
    const allOpt = this.domainSelect.createEl("option", { value: "", text: i18n().view.allDomains });
    for (const d of domains) {
      this.domainSelect.createEl("option", { value: d.id, text: d.name || d.id });
    }
    if (previous && Array.from(this.domainSelect.options).some((o) => o.value === previous)) {
      this.domainSelect.value = previous;
    }
  }
  openAddDomain() {
    const cwd = this.plugin.controller.cwdOrEmpty();
    if (!cwd) {
      new import_obsidian4.Notice(i18n().view.cwdNotSet);
      return;
    }
    new AddDomainModal(this.app, (input) => {
      void (async () => {
        const r = await this.plugin.controller.registerDomain(input);
        if (!r.ok)
          return;
        await this.refreshDomains();
        this.domainSelect.value = input.id;
        if (!input.sourcePaths.length) {
          void this.plugin.controller.init(input.id, false);
          return;
        }
        const T = i18n().modal;
        const allFiles = this.app.vault.getFiles();
        const mdFiles = allFiles.filter(
          (f) => f.extension === "md" && input.sourcePaths.some((p) => f.path.startsWith(p))
        );
        if (!mdFiles.length) {
          void this.plugin.controller.init(input.id, false);
          return;
        }
        new ConfirmModal(
          this.app,
          T.initConfirmTitle,
          [T.initConfirmBody(mdFiles.length, input.sourcePaths.length)],
          () => void this.plugin.controller.init(input.id, false, input.sourcePaths)
        ).open();
      })();
    }).open();
  }
  submitQuery(save) {
    const q = this.queryInput.value.trim();
    if (!q) {
      new import_obsidian4.Notice(i18n().view.enterQuestion);
      return;
    }
    if (this.state === "running") {
      new import_obsidian4.Notice(i18n().view.operationInProgress);
      return;
    }
    void this.plugin.controller.query(q, save, this.domainSelect.value || void 0);
    this.queryInput.value = "";
  }
  setRunning(operation, args) {
    this.state = "running";
    this.stepsEl.empty();
    this.finalEl.empty();
    this.statusEl.setText(`\u25B6 ${operation} ${args.join(" ")}`);
    this.cancelBtn.disabled = false;
    this.askBtn.disabled = true;
    this.askSaveBtn.disabled = true;
    this.initBtn.disabled = true;
    this.ingestBtn.disabled = true;
    this.lintBtn.disabled = true;
    this.formatBtn.disabled = true;
    this.fixChatEl?.remove();
    this.fixChatEl = null;
    this.chatSection?.remove();
    this.chatSection = null;
    this.lastContext = null;
    this.chatHistory = [];
    this.resultSection.addClass("llm-wiki-hidden");
    this.finalEl.empty();
    this.resultOpen = false;
    this.startTs = Date.now();
    this.toolCount = 0;
    this.stepCount = 0;
    this.progressEl = null;
    this.progressTotal = 0;
    this.progressDone = 0;
    this.currentToolStep = null;
    this.assistantBlock = null;
    this.assistantBuffer = "";
    this.reasoningBlock = null;
    this.reasoningBuffer = "";
    this.stepsOpen = true;
    this.stepsEl.removeClass("llm-wiki-hidden");
    this.progressToggle.setText("\u25BC");
    this.updateMetrics();
    if (this.tickHandle !== null)
      window.clearInterval(this.tickHandle);
    this.tickHandle = window.setInterval(() => this.updateMetrics(), 500);
  }
  appendEvent(ev) {
    if (ev.kind === "format_preview") {
      this.renderFormatPreview(ev.tempPath, ev.report, ev.missingTokens);
      return;
    }
    if (ev.kind === "format_applied" || ev.kind === "format_cancelled") {
      this.formatPreviewSection?.remove();
      this.formatPreviewSection = null;
      return;
    }
    if (ev.kind === "init_start") {
      this.progressTotal = ev.totalFiles;
      this.progressDone = 0;
      const step = this.stepsEl.createDiv("llm-wiki-step llm-wiki-progress");
      step.createSpan({ cls: "llm-wiki-step-icon" }).setText("\u{1F4C2}");
      this.progressEl = step.createSpan({ cls: "llm-wiki-progress-text" });
      this.progressEl.setText(`0 / ${ev.totalFiles} \u0444\u0430\u0439\u043B\u043E\u0432`);
      this.scrollSteps();
      return;
    }
    if (ev.kind === "file_start") {
      if (this.progressEl) {
        this.progressEl.setText(`${ev.index} / ${ev.total} \u0444\u0430\u0439\u043B\u043E\u0432 \u2192 ${ev.file.split("/").pop()}`);
      }
      this.scrollSteps();
      return;
    }
    if (ev.kind === "file_done") {
      this.progressDone++;
      if (this.progressEl) {
        this.progressEl.setText(`${this.progressDone} / ${this.progressTotal} \u0444\u0430\u0439\u043B\u043E\u0432`);
      }
      this.scrollSteps();
      return;
    }
    if (ev.kind === "domain_created") {
      this.refreshDomains();
      return;
    }
    if (ev.kind === "source_path_added")
      return;
    if (ev.kind === "domain_updated") {
      this.refreshDomains();
      return;
    }
    this.stepCount++;
    if (ev.kind === "tool_use") {
      this.toolCount++;
      this.assistantBlock = null;
      this.assistantBuffer = "";
      this.reasoningBlock = null;
      this.reasoningBuffer = "";
      const step = this.stepsEl.createDiv("llm-wiki-step");
      const head = step.createDiv("llm-wiki-step-head");
      head.createSpan({ cls: "llm-wiki-step-icon" }).setText("\u{1F527}");
      head.createSpan({ cls: "llm-wiki-step-name" }).setText(ev.name);
      const summary = summariseInput(ev.input);
      if (summary)
        head.createSpan({ cls: "llm-wiki-step-arg" }).setText(summary);
      head.createSpan({ cls: "llm-wiki-step-time muted" }).setText(this.elapsedShort());
      this.currentToolStep = step;
      this.currentToolStartedAt = Date.now();
      this.scrollSteps();
    } else if (ev.kind === "tool_result") {
      const step = this.currentToolStep;
      if (step) {
        const head = step.querySelector(".llm-wiki-step-head");
        head?.addClass(ev.ok ? "ok" : "err");
        const dur = ((Date.now() - this.currentToolStartedAt) / 1e3).toFixed(1);
        const t = step.querySelector(".llm-wiki-step-time");
        if (t)
          t.setText(`${dur}s`);
        if (ev.preview) {
          const p = step.createDiv("llm-wiki-step-preview");
          p.setText(truncate(ev.preview.replace(/\s+/g, " "), PREVIEW_INLINE));
        }
        this.currentToolStep = null;
      }
    } else if (ev.kind === "ask_user") {
      const el = this.stepsEl.createDiv("llm-wiki-step llm-wiki-step--ask");
      el.createSpan({ text: "\u23F3 Waiting for answer\u2026" });
      return;
    } else if (ev.kind === "assistant_text") {
      if (ev.isReasoning) {
        if (!this.reasoningBlock) {
          this.reasoningBlock = this.stepsEl.createDiv("llm-wiki-step reasoning");
          if (this.assistantBlock) {
            this.stepsEl.insertBefore(this.reasoningBlock, this.assistantBlock);
          }
          this.reasoningBlock.createSpan({ cls: "llm-wiki-step-icon" }).setText("\u{1F9E0}");
          this.reasoningBlock.createSpan({ cls: "llm-wiki-reasoning-text" });
        }
        this.reasoningBuffer += ev.delta;
        const span = this.reasoningBlock.querySelector(".llm-wiki-reasoning-text");
        if (span)
          span.setText(truncate(this.reasoningBuffer, ASSISTANT_TEXT_MAX));
      } else {
        if (!this.assistantBlock) {
          this.assistantBlock = this.stepsEl.createDiv("llm-wiki-step assistant");
          this.assistantBlock.createSpan({ cls: "llm-wiki-step-icon" }).setText("\u{1F4AC}");
          this.assistantBlock.createSpan({ cls: "llm-wiki-assistant-text" });
        }
        this.assistantBuffer += ev.delta;
        const span = this.assistantBlock.querySelector(".llm-wiki-assistant-text");
        if (span)
          span.setText(truncate(this.assistantBuffer, ASSISTANT_TEXT_MAX));
      }
      this.scrollSteps();
    } else if (ev.kind === "system") {
      const step = this.stepsEl.createDiv("llm-wiki-step");
      const head = step.createDiv("llm-wiki-step-head");
      head.createSpan({ cls: "llm-wiki-step-icon" }).setText("\u2699");
      head.createSpan({ cls: "llm-wiki-step-name muted" }).setText(translateSystemEvent(ev.message));
      this.scrollSteps();
    } else if (ev.kind === "error") {
      this.stepsEl.createDiv("llm-wiki-step err").setText(`\u2717 ${ev.message}`);
      this.scrollSteps();
    } else if (ev.kind === "result") {
      this.assistantBlock = null;
    } else if (ev.kind === "eval_result") {
      const el = this.stepsEl.createEl("div", { cls: "llm-wiki-eval-result" });
      el.setText(`[eval: ${ev.score}/10] ${ev.reasoning}`);
    }
    this.updateMetrics();
  }
  renderFormatPreview(tempPath, report, missing) {
    const T = i18n();
    this.formatPreviewSection?.remove();
    const root = this.containerEl.children[1];
    this.formatPreviewSection = root.createDiv("llm-wiki-format-preview");
    this.formatPreviewSection.createEl("h4", { text: T.view.formatPreviewHeader });
    const link = this.formatPreviewSection.createEl("a", {
      text: `\u{1F4C4} ${tempPath}`,
      cls: "internal-link",
      attr: { href: tempPath, "data-href": tempPath }
    });
    registerLinkHandler(this.formatPreviewSection, this.app);
    const reportEl = this.formatPreviewSection.createDiv("llm-wiki-format-report");
    const comp = new import_obsidian4.Component();
    comp.load();
    void import_obsidian4.MarkdownRenderer.render(this.app, report, reportEl, "", comp);
    if (missing.length > 0) {
      const warn = this.formatPreviewSection.createDiv("llm-wiki-format-warn");
      warn.setText(T.view.formatMissingTokens(missing.length));
    }
    const btnRow = this.formatPreviewSection.createDiv("llm-wiki-format-actions");
    const applyBtn = btnRow.createEl("button", { text: T.view.formatApply, cls: "mod-cta" });
    applyBtn.disabled = false;
    applyBtn.addEventListener("click", () => void this.plugin.controller.formatApply());
    const cancelBtn = btnRow.createEl("button", { text: T.view.formatCancelBtn, cls: "mod-warning" });
    cancelBtn.addEventListener("click", () => void this.plugin.controller.formatCancel());
    const chatBox = this.formatPreviewSection.createDiv("llm-wiki-format-chat");
    const inputEl = chatBox.createEl("textarea", {
      cls: "llm-wiki-format-chat-input",
      attr: { placeholder: T.view.formatRefinePlaceholder, rows: "3" }
    });
    const sendRow = chatBox.createDiv("llm-wiki-format-chat-send-row");
    const sendBtn = sendRow.createEl("button", { text: T.view.chatSend });
    sendBtn.addEventListener("click", () => {
      const msg = inputEl.value.trim();
      if (!msg)
        return;
      inputEl.value = "";
      void this.plugin.controller.formatRefine(msg);
    });
    inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendBtn.click();
      }
    });
  }
  async finish(entry) {
    this.state = entry.status;
    this.statusEl.setText(this.statusLabel(entry));
    this.cancelBtn.disabled = true;
    this.askBtn.disabled = false;
    this.askSaveBtn.disabled = false;
    this.initBtn.disabled = false;
    this.ingestBtn.disabled = false;
    this.lintBtn.disabled = false;
    this.formatBtn.disabled = false;
    this.fixChatEl?.remove();
    this.fixChatEl = null;
    if (this.tickHandle !== null) {
      window.clearInterval(this.tickHandle);
      this.tickHandle = null;
    }
    this.updateMetrics();
    this.finalEl.empty();
    if (entry.finalText) {
      const comp = new import_obsidian4.Component();
      comp.load();
      await import_obsidian4.MarkdownRenderer.render(this.app, entry.finalText, this.finalEl, "", comp);
      this.resultSection.removeClass("llm-wiki-hidden");
      this.finalEl.removeClass("llm-wiki-hidden");
      this.resultOpen = true;
      this.resultToggle.setText("\u25BC");
      const CHAT_OPS = ["lint", "ingest", "query", "query-save"];
      if (CHAT_OPS.includes(entry.operation) && entry.status === "done" && entry.finalText) {
        this.lastContext = {
          operation: entry.operation,
          domainId: entry.domainId,
          report: entry.finalText
        };
        this.chatHistory = [];
        this.showChatSection();
      }
    }
    this.renderHistory();
  }
  showChatSection() {
    this.chatSection?.remove();
    this.chatOpen = true;
    const T = i18n();
    this.chatSection = this.resultSection.createDiv("llm-wiki-chat-section");
    const chatHeader = this.chatSection.createDiv("llm-wiki-progress-header");
    const chatH4 = chatHeader.createEl("h4", { cls: "llm-wiki-progress-title" });
    this.chatToggle = chatH4.createSpan({ cls: "llm-wiki-progress-arrow", text: "\u25BC" });
    chatH4.appendText(` ${T.view.chatLabel}`);
    chatHeader.addEventListener("click", () => this.toggleChat());
    this.chatBodyEl = this.chatSection.createDiv("llm-wiki-chat-body");
    this.chatMessagesEl = this.chatBodyEl.createDiv("llm-wiki-chat-messages");
    const inputRow = this.chatBodyEl.createDiv("llm-wiki-chat-input-row");
    this.chatInputEl = inputRow.createEl("textarea", { cls: "llm-wiki-chat-input", attr: { rows: "2" } });
    this.chatSendBtn = inputRow.createEl("button", { text: T.view.chatSend, cls: "llm-wiki-chat-send" });
    const submit = () => {
      const text = this.chatInputEl.value.trim();
      if (!text || !this.lastContext)
        return;
      this.chatInputEl.value = "";
      this.addChatBubble("user", text);
      this.lastUserMessage = text;
      void this.plugin.controller.chat(
        this.lastContext.operation,
        this.lastContext.domainId,
        this.lastContext.report,
        this.chatHistory,
        text
      );
    };
    this.chatSendBtn.addEventListener("click", submit);
  }
  addChatBubble(role, text) {
    const el = this.chatMessagesEl.createDiv(`llm-wiki-chat-msg llm-wiki-chat-msg--${role}`);
    if (role === "user") {
      el.setText(text);
    } else {
      const comp = new import_obsidian4.Component();
      comp.load();
      void import_obsidian4.MarkdownRenderer.render(this.app, text, el, "", comp);
      registerLinkHandler(el, this.app);
    }
    el.scrollIntoView({ block: "end" });
    return el;
  }
  setChatRunning() {
    if (this.chatSendBtn)
      this.chatSendBtn.disabled = true;
    if (this.chatInputEl)
      this.chatInputEl.disabled = true;
    this.currentChatBuffer = "";
    if (this.chatMessagesEl) {
      this.currentChatBubble = this.chatMessagesEl.createDiv("llm-wiki-chat-msg llm-wiki-chat-msg--assistant llm-wiki-chat-msg--streaming");
      this.currentChatBubble.setText("\u2026");
      this.currentChatBubble.scrollIntoView({ block: "end" });
    }
    this.chatStartTs = Date.now();
    this.chatTickHandle = window.setInterval(() => {
      if (this.currentChatBubble) {
        const s = ((Date.now() - this.chatStartTs) / 1e3).toFixed(1);
        this.currentChatBubble.setText(`\u23F3 ${s}s\u2026`);
      }
    }, 500);
  }
  appendChatEvent(ev) {
    if (ev.kind === "assistant_text" && !ev.isReasoning && this.currentChatBubble) {
      if (this.chatTickHandle !== null) {
        window.clearInterval(this.chatTickHandle);
        this.chatTickHandle = null;
        this.currentChatBubble.setText("");
      }
      this.currentChatBuffer += ev.delta;
      this.currentChatBubble.setText(this.currentChatBuffer);
      this.currentChatBubble.scrollIntoView({ block: "end" });
    }
  }
  finishChat(msg, isError) {
    if (this.chatTickHandle !== null) {
      window.clearInterval(this.chatTickHandle);
      this.chatTickHandle = null;
    }
    if (this.chatSendBtn)
      this.chatSendBtn.disabled = false;
    if (this.chatInputEl) {
      this.chatInputEl.disabled = false;
      this.chatInputEl.focus();
    }
    if (this.currentChatBubble) {
      this.currentChatBubble.removeClass("llm-wiki-chat-msg--streaming");
      this.currentChatBubble.empty();
      if (isError) {
        this.currentChatBubble.addClass("llm-wiki-chat-msg--error");
        this.currentChatBubble.setText(msg.content);
      } else {
        const comp = new import_obsidian4.Component();
        comp.load();
        void import_obsidian4.MarkdownRenderer.render(this.app, msg.content, this.currentChatBubble, "", comp);
        registerLinkHandler(this.currentChatBubble, this.app);
      }
      this.currentChatBubble = null;
    }
    if (!isError && this.lastUserMessage) {
      this.chatHistory.push({ role: "user", content: this.lastUserMessage });
      this.chatHistory.push(msg);
    }
    this.lastUserMessage = "";
    this.currentChatBuffer = "";
  }
  toggleHistory() {
    this.historyOpen = !this.historyOpen;
    if (this.historyOpen) {
      this.historyEl.removeClass("llm-wiki-hidden");
    } else {
      this.historyEl.addClass("llm-wiki-hidden");
    }
    this.historyToggle.setText(this.historyOpen ? "\u25BC" : "\u25B6");
  }
  toggleResult() {
    this.resultOpen = !this.resultOpen;
    if (this.resultOpen) {
      this.finalEl.removeClass("llm-wiki-hidden");
    } else {
      this.finalEl.addClass("llm-wiki-hidden");
    }
    this.resultToggle.setText(this.resultOpen ? "\u25BC" : "\u25B6");
  }
  toggleSteps() {
    this.stepsOpen = !this.stepsOpen;
    if (this.stepsOpen) {
      this.stepsEl.removeClass("llm-wiki-hidden");
    } else {
      this.stepsEl.addClass("llm-wiki-hidden");
    }
    this.progressToggle.setText(this.stepsOpen ? "\u25BC" : "\u25B6");
  }
  toggleChat() {
    this.chatOpen = !this.chatOpen;
    this.chatBodyEl?.toggleClass("llm-wiki-hidden", !this.chatOpen);
    this.chatToggle?.setText(this.chatOpen ? "\u25BC" : "\u25B6");
  }
  updateMetrics() {
    if (this.state !== "running") {
      this.progressCount.setText("");
      return;
    }
    const dur = ((Date.now() - this.startTs) / 1e3).toFixed(1);
    this.progressCount.setText(i18n().view.stepsCount(this.stepCount, dur));
  }
  elapsedShort() {
    return `${((Date.now() - this.startTs) / 1e3).toFixed(1)}s`;
  }
  scrollSteps() {
    this.stepsEl.scrollTop = this.stepsEl.scrollHeight;
  }
  statusLabel(entry) {
    const dur = ((entry.finishedAt - entry.startedAt) / 1e3).toFixed(1);
    const icon = entry.status === "done" ? "\u2713" : entry.status === "cancelled" ? "\u26D4" : "\u2717";
    return `${icon} ${entry.operation} (${dur}s)`;
  }
  renderHistory() {
    this.historyEl.empty();
    const items = this.plugin.settings.history.slice().reverse();
    if (items.length === 0) {
      this.historySection.addClass("llm-wiki-hidden");
      this.historyOpen = false;
      return;
    }
    this.historySection.removeClass("llm-wiki-hidden");
    for (const it of items) {
      const row = this.historyEl.createDiv("llm-wiki-history-row");
      row.createSpan().setText(this.statusLabel(it));
      row.createSpan({ cls: "muted" }).setText(` ${it.args.join(" ")}`);
      row.addEventListener("click", () => {
        this.finalEl.empty();
        const comp = new import_obsidian4.Component();
        comp.load();
        void import_obsidian4.MarkdownRenderer.render(this.app, it.finalText || "(empty)", this.finalEl, "", comp);
        this.resultSection.removeClass("llm-wiki-hidden");
        this.finalEl.removeClass("llm-wiki-hidden");
        this.resultOpen = true;
        this.resultToggle.setText("\u25BC");
      });
    }
  }
  showQuestionModal(question, options) {
    return new Promise((resolve, reject) => {
      const modal = new WikiQuestionModal(this.app, question, options, resolve, reject);
      modal.open();
    });
  }
};
var WikiQuestionModal = class extends import_obsidian4.Modal {
  constructor(app, question, options, resolve, reject) {
    super(app);
    this.question = question;
    this.options = options;
    this.resolve = resolve;
    this.reject = reject;
  }
  settled = false;
  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: i18n().view.answerRequired });
    contentEl.createEl("p", { text: this.question });
    if (this.options.length > 0) {
      const btnRow = contentEl.createDiv("llm-wiki-modal-options");
      for (const opt of this.options) {
        const btn = btnRow.createEl("button", { text: opt });
        btn.addEventListener("click", () => {
          if (this.settled)
            return;
          this.settled = true;
          this.resolve(opt);
          this.close();
        });
      }
    } else {
      const input = contentEl.createEl("input", {
        attr: { type: "text" },
        cls: "llm-wiki-modal-input"
      });
      input.focus();
      const submit = () => {
        if (this.settled)
          return;
        const val = input.value.trim();
        if (!val)
          return;
        this.settled = true;
        this.resolve(val);
        this.close();
      };
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter")
          submit();
      });
      contentEl.createEl("button", { text: "OK" }).addEventListener("click", submit);
    }
    const cancelBtn = contentEl.createEl("button", {
      text: i18n().view.cancel,
      cls: "mod-warning"
    });
    cancelBtn.addEventListener("click", () => {
      if (this.settled)
        return;
      this.settled = true;
      this.reject();
      this.close();
    });
  }
  onClose() {
    this.contentEl.empty();
    if (!this.settled) {
      this.settled = true;
      this.reject();
    }
  }
};
function summariseInput(input) {
  if (!input || typeof input !== "object")
    return "";
  const o = input;
  const candidates = [
    ["file_path"],
    ["path"],
    ["pattern"],
    ["query"],
    ["command"],
    ["url"],
    ["notebook_path"]
  ];
  for (const [k] of candidates) {
    const v = o[k];
    if (typeof v === "string" && v)
      return truncate(v, 80);
  }
  for (const k of Object.keys(o)) {
    const v = o[k];
    if (typeof v === "string" && v)
      return `${k}=${truncate(v, 60)}`;
  }
  return "";
}
function truncate(s, n) {
  return s.length <= n ? s : s.slice(0, n) + "\u2026";
}
function translateSystemEvent(message) {
  const T = i18n().view;
  if (message === "hook_started")
    return T.starting;
  if (message === "hook_response")
    return T.initialising;
  if (message.startsWith("init")) {
    const model = message.replace(/^init\s*/, "").replace(/[()]/g, "").trim();
    return model ? `${T.initialising} (${model})` : T.initialising;
  }
  return message;
}

// src/controller.ts
var import_obsidian6 = require("obsidian");

// src/source-paths.ts
var import_node_path = require("node:path");
function consolidateSourcePaths(existing, newPath, vaultRoot) {
  const toAbs = (p) => (0, import_node_path.isAbsolute)(p) ? p : (0, import_node_path.join)(vaultRoot, p);
  const normed = (p) => {
    const a = toAbs(p);
    return a.endsWith("/") ? a : a + "/";
  };
  const newNormed = normed(newPath);
  if (existing.some((sp) => newNormed.startsWith(normed(sp)))) {
    return existing;
  }
  const filtered = existing.filter((sp) => !normed(sp).startsWith(newNormed));
  return [...filtered, newPath];
}

// src/domain.ts
function validateDomainId(id) {
  if (!id)
    return "ID \u0434\u043E\u043C\u0435\u043D\u0430 \u043F\u0443\u0441\u0442";
  if (!/^[\p{L}\p{N}_-]+$/u.test(id))
    return "ID \u0434\u043E\u043F\u0443\u0441\u043A\u0430\u0435\u0442 \u0442\u043E\u043B\u044C\u043A\u043E \u0431\u0443\u043A\u0432\u044B/\u0446\u0438\u0444\u0440\u044B/_/-";
  return null;
}
function applyDomainEvent(domains, ev, opts) {
  const next = [...domains];
  if (ev.kind === "domain_created") {
    if (next.some((d) => d.id === ev.entry.id))
      return next;
    next.push(ev.entry);
    return next;
  }
  const i = next.findIndex((d) => d.id === ev.domainId);
  if (i < 0)
    return next;
  if (ev.kind === "domain_updated") {
    next[i] = { ...next[i], ...ev.patch };
    return next;
  }
  const existing = next[i].source_paths ?? [];
  let updated;
  if (opts?.vaultRoot !== void 0) {
    updated = consolidateSourcePaths(existing, ev.path, opts.vaultRoot);
    if (updated === existing)
      return domains;
  } else {
    if (existing.includes(ev.path))
      return domains;
    updated = [...existing, ev.path];
  }
  next[i] = { ...next[i], source_paths: updated };
  return next;
}

// src/phases/ingest.ts
var import_node_path2 = require("node:path");

// prompts/base.md
var base_default = "\u0422\u044B \u2014 wiki-\u0430\u0433\u0435\u043D\u0442. \u0421\u043B\u0435\u0434\u0443\u0439 \u044D\u0442\u0438\u043C \u043F\u0440\u0430\u0432\u0438\u043B\u0430\u043C \u043D\u0435\u0437\u0430\u0432\u0438\u0441\u0438\u043C\u043E \u043E\u0442 \u043E\u043F\u0435\u0440\u0430\u0446\u0438\u0438.\n\n## \u0414\u043E\u0441\u0442\u043E\u0432\u0435\u0440\u043D\u043E\u0441\u0442\u044C\n\u041E\u0442\u0432\u0435\u0447\u0430\u0439 \u0441\u0442\u0440\u043E\u0433\u043E \u043D\u0430 \u043E\u0441\u043D\u043E\u0432\u0435 \u043F\u0440\u0435\u0434\u043E\u0441\u0442\u0430\u0432\u043B\u0435\u043D\u043D\u043E\u0433\u043E \u043A\u043E\u043D\u0442\u0435\u043A\u0441\u0442\u0430.\n\u041D\u0435 \u0432\u044B\u0434\u0443\u043C\u044B\u0432\u0430\u0439 \u0444\u0430\u043A\u0442\u044B, \u043A\u043E\u0442\u043E\u0440\u044B\u0445 \u043D\u0435\u0442 \u0432 \u0438\u0441\u0442\u043E\u0447\u043D\u0438\u043A\u0435.\n\u0415\u0441\u043B\u0438 \u043A\u043E\u043D\u0442\u0435\u043A\u0441\u0442\u0430 \u043D\u0435\u0434\u043E\u0441\u0442\u0430\u0442\u043E\u0447\u043D\u043E \u2014 \u0441\u043A\u0430\u0436\u0438 \u043E\u0431 \u044D\u0442\u043E\u043C \u043F\u0440\u044F\u043C\u043E.\n\n## \u0424\u043E\u0440\u043C\u0430\u0442\n\u0412\u043E\u0437\u0432\u0440\u0430\u0449\u0430\u0439 \u0440\u043E\u0432\u043D\u043E \u0442\u043E, \u0447\u0442\u043E \u0437\u0430\u043F\u0440\u043E\u0448\u0435\u043D\u043E.\n\u0415\u0441\u043B\u0438 \u043E\u0436\u0438\u0434\u0430\u0435\u0442\u0441\u044F JSON \u2014 \u0442\u043E\u043B\u044C\u043A\u043E \u0432\u0430\u043B\u0438\u0434\u043D\u044B\u0439 JSON, \u0431\u0435\u0437 \u043F\u043E\u044F\u0441\u043D\u0435\u043D\u0438\u0439 \u0432\u043E\u043A\u0440\u0443\u0433.\n\u0415\u0441\u043B\u0438 \u043E\u0436\u0438\u0434\u0430\u0435\u0442\u0441\u044F \u0442\u0435\u043A\u0441\u0442 \u2014 \u0431\u0435\u0437 \u0441\u043B\u0443\u0436\u0435\u0431\u043D\u044B\u0445 \u043C\u0435\u0442\u043E\u043A \u0438 \u0442\u0435\u0445\u043D\u0438\u0447\u0435\u0441\u043A\u0438\u0445 \u0430\u0440\u0442\u0435\u0444\u0430\u043A\u0442\u043E\u0432.\n\n## \u041C\u0438\u043D\u0438\u043C\u0430\u043B\u0438\u0437\u043C\n\u041D\u0435 \u0434\u043E\u0431\u0430\u0432\u043B\u044F\u0439 \u0442\u043E, \u043E \u0447\u0451\u043C \u043D\u0435 \u043F\u0440\u043E\u0441\u0438\u043B\u0438.\n\u041D\u0435 \u043A\u043E\u043C\u043C\u0435\u043D\u0442\u0438\u0440\u0443\u0439 \u0441\u043E\u0431\u0441\u0442\u0432\u0435\u043D\u043D\u044B\u0435 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u044F, \u0435\u0441\u043B\u0438 \u044D\u0442\u043E \u043D\u0435 \u0447\u0430\u0441\u0442\u044C \u0437\u0430\u0434\u0430\u0447\u0438.\n";

// src/phases/llm-utils.ts
function extractStreamDeltas(chunk) {
  const delta = chunk.choices[0]?.delta;
  const rawReasoning = delta?.reasoning;
  return {
    reasoning: typeof rawReasoning === "string" ? rawReasoning : "",
    content: typeof delta?.content === "string" ? delta.content : ""
  };
}
function buildChatParams(model, messages, opts) {
  let msgs = prependBaseContract(messages);
  msgs = opts.systemPrompt ? injectSystemPrompt(msgs, opts.systemPrompt) : msgs;
  const params = { model, messages: msgs };
  if (opts.temperature !== void 0)
    params.temperature = opts.temperature;
  if (opts.maxTokens != null)
    params.max_tokens = opts.maxTokens;
  if (opts.topP != null)
    params.top_p = opts.topP;
  if (opts.numCtx != null)
    params.num_ctx = opts.numCtx;
  return params;
}
function prependBaseContract(messages) {
  const firstSystem = messages.findIndex((m) => m.role === "system");
  if (firstSystem >= 0) {
    const updated = [...messages];
    const existing = typeof updated[firstSystem].content === "string" ? updated[firstSystem].content : "";
    updated[firstSystem] = { role: "system", content: `${base_default}

${existing}` };
    return updated;
  }
  return [{ role: "system", content: base_default }, ...messages];
}
function injectSystemPrompt(messages, systemPrompt) {
  if (!systemPrompt)
    return messages;
  const section = `## \u0423\u0442\u043E\u0447\u043D\u0435\u043D\u0438\u0435
${systemPrompt}`;
  const firstSystem = messages.findIndex((m) => m.role === "system");
  if (firstSystem >= 0) {
    const updated = [...messages];
    const existing = typeof updated[firstSystem].content === "string" ? updated[firstSystem].content : "";
    updated[firstSystem] = { role: "system", content: `${existing}

${section}` };
    return updated;
  }
  return [{ role: "system", content: section }, ...messages];
}

// prompts/ingest.md
var ingest_default = '\u0422\u044B \u2014 \u0430\u0441\u0441\u0438\u0441\u0442\u0435\u043D\u0442 \u0441\u0438\u043D\u0442\u0435\u0437\u0430 wiki-\u0437\u043D\u0430\u043D\u0438\u0439 \u0434\u043B\u044F \u0434\u043E\u043C\u0435\u043D\u0430 \xAB{{domain_name}}\xBB.\n\u0418\u0437\u0432\u043B\u0435\u043A\u0430\u0439 \u0441\u0443\u0449\u043D\u043E\u0441\u0442\u0438 \u0438\u0437 \u0438\u0441\u0442\u043E\u0447\u043D\u0438\u043A\u0430 \u0438 \u0441\u043E\u0437\u0434\u0430\u0432\u0430\u0439/\u043E\u0431\u043D\u043E\u0432\u043B\u044F\u0439 wiki-\u0441\u0442\u0440\u0430\u043D\u0438\u0446\u044B.\n\n\u0422\u0418\u041F\u042B \u0421\u0423\u0429\u041D\u041E\u0421\u0422\u0415\u0419 \u0414\u041E\u041C\u0415\u041D\u0410:\n{{entity_types_block}}\n{{lang_notes}}\n\n\u041F\u0420\u0410\u0412\u0418\u041B\u0410:\n- CREATE: \u0441\u0443\u0449\u043D\u043E\u0441\u0442\u044C \u043D\u0435 \u0441\u0443\u0449\u0435\u0441\u0442\u0432\u0443\u0435\u0442 \u0432 wiki, \u0443\u043F\u043E\u043C\u0438\u043D\u0430\u043D\u0438\u0439 >= min_mentions_for_page\n- UPDATE: \u0441\u0443\u0449\u043D\u043E\u0441\u0442\u044C \u0441\u0443\u0449\u0435\u0441\u0442\u0432\u0443\u0435\u0442 \u2192 \u0434\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u043D\u043E\u0432\u0443\u044E \u0438\u043D\u0444\u043E\u0440\u043C\u0430\u0446\u0438\u044E, \u041D\u0415 \u0443\u0434\u0430\u043B\u044F\u0442\u044C \u0441\u0442\u0430\u0440\u0443\u044E\n- SKIP: \u0441\u043B\u0438\u0448\u043A\u043E\u043C \u043C\u0430\u043B\u043E \u0443\u043F\u043E\u043C\u0438\u043D\u0430\u043D\u0438\u0439 \u0438\u043B\u0438 \u0438\u043D\u0444\u043E\u0440\u043C\u0430\u0446\u0438\u044F \u0443\u0436\u0435 \u0435\u0441\u0442\u044C\n- \u0421\u0438\u043D\u0442\u0435\u0437, \u043D\u0435 \u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u043D\u0438\u0435. \u0422\u0435\u0445\u043D\u0438\u0447\u0435\u0441\u043A\u0438\u0435 \u043A\u043E\u043D\u0444\u0438\u0433\u0438/SQL \u043C\u043E\u0436\u043D\u043E \u0446\u0438\u0442\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u0432 code-\u0431\u043B\u043E\u043A\u0430\u0445.\n- \u041F\u0443\u0442\u044C \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u044B \u0434\u043E\u043B\u0436\u0435\u043D \u043D\u0430\u0447\u0438\u043D\u0430\u0442\u044C\u0441\u044F \u0441 "{{wiki_path}}/"\n- Frontmatter \u043E\u0431\u044F\u0437\u0430\u0442\u0435\u043B\u0435\u043D: wiki_sources, wiki_updated: {{today}}, wiki_status: stub|developing|mature\n- wiki_sources: \u043A\u0430\u0436\u0434\u044B\u0439 \u044D\u043B\u0435\u043C\u0435\u043D\u0442 \u043E\u0431\u044F\u0437\u0430\u0442\u0435\u043B\u044C\u043D\u043E \u0432 \u0444\u043E\u0440\u043C\u0430\u0442\u0435 [[path/to/source]], \u0442\u0438\u043F \u0441\u0432\u043E\u0439\u0441\u0442\u0432\u0430 Links \u0432 Obsidian\n- \u0420\u0430\u0437\u0434\u0435\u043B "## \u041E\u0441\u043D\u043E\u0432\u043D\u044B\u0435 \u0445\u0430\u0440\u0430\u043A\u0442\u0435\u0440\u0438\u0441\u0442\u0438\u043A\u0438" \u043E\u0431\u044F\u0437\u0430\u0442\u0435\u043B\u0435\u043D \u0434\u043B\u044F \u043A\u0430\u0436\u0434\u043E\u0439 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u044B\n- \u041F\u0440\u0438 \u0434\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u0438\u0438 \u0438\u0437 \u043D\u043E\u0432\u043E\u0433\u043E \u0438\u0441\u0442\u043E\u0447\u043D\u0438\u043A\u0430 \u2014 \u0444\u0438\u043A\u0441\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u0432 "## \u0418\u0441\u0442\u043E\u0440\u0438\u044F \u0438\u0437\u043C\u0435\u043D\u0435\u043D\u0438\u0439" \u0441 \u0434\u0430\u0442\u043E\u0439 \u0438 \u0438\u0441\u0442\u043E\u0447\u043D\u0438\u043A\u043E\u043C\n- "## \u0421\u0432\u044F\u0437\u0430\u043D\u043D\u044B\u0435 \u043A\u043E\u043D\u0446\u0435\u043F\u0446\u0438\u0438" \u2014 \u0441\u043E\u0437\u0434\u0430\u0432\u0430\u0442\u044C \u0442\u043E\u043B\u044C\u043A\u043E \u043F\u0440\u0438 \u043D\u0430\u043B\u0438\u0447\u0438\u0438 \u043F\u043E\u044F\u0441\u043D\u0438\u0442\u0435\u043B\u044C\u043D\u043E\u0433\u043E \u043A\u043E\u043D\u0442\u0435\u043A\u0441\u0442\u0430 \u043A \u0441\u0432\u044F\u0437\u044F\u043C\n{{schema_block}}\n\n\u0412\u0435\u0440\u043D\u0438 \u0422\u041E\u041B\u042C\u041A\u041E JSON-\u043C\u0430\u0441\u0441\u0438\u0432, \u0431\u0435\u0437 \u0434\u0440\u0443\u0433\u043E\u0433\u043E \u0442\u0435\u043A\u0441\u0442\u0430:\n[{"path":"{{wiki_path}}/EntityName.md","content":"---\\nwiki_sources: [\\"[[{{source_path}}]]\\"]\\nwiki_updated: {{today}}\\nwiki_status: stub\\ntags: []\\nwiki_outgoing_links: []\\n---\\n# EntityName\\n\\ncont\u0435\u043D\u0442..."}]\n';

// src/phases/template.ts
function render(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
}

// src/wiki-path.ts
var WIKI_ROOT = "!Wiki";
function domainWikiFolder(subfolder) {
  return `${WIKI_ROOT}/${subfolder}`;
}

// src/phases/ingest.ts
async function* runIngest(args, vaultTools, llm, model, domains, vaultRoot, signal, opts = {}) {
  const filePath = args[0];
  if (!filePath) {
    yield { kind: "error", message: "ingest: file path required" };
    return;
  }
  const absSource = (0, import_node_path2.isAbsolute)(filePath) ? filePath : (0, import_node_path2.join)(vaultRoot, filePath);
  const sourceVaultPath = vaultTools.toVaultPath(absSource);
  if (!sourceVaultPath) {
    yield { kind: "error", message: `Source file ${filePath} is outside the vault.` };
    return;
  }
  yield { kind: "tool_use", name: "Read", input: { path: sourceVaultPath } };
  let sourceContent;
  try {
    sourceContent = await vaultTools.read(sourceVaultPath);
  } catch (e) {
    yield { kind: "error", message: `Cannot read ${sourceVaultPath}: ${e.message}` };
    return;
  }
  yield { kind: "tool_result", ok: true, preview: sourceContent.slice(0, 100) };
  const domain = detectDomain(absSource, domains, vaultRoot);
  if (!domain) {
    yield { kind: "error", message: "No domain found for this file. Configure domain-map." };
    return;
  }
  const absWiki = (0, import_node_path2.join)(vaultRoot, domainWikiFolder(domain.wiki_folder));
  const wikiVaultPath = vaultTools.toVaultPath(absWiki);
  if (!wikiVaultPath) {
    yield { kind: "error", message: `Wiki folder ${domainWikiFolder(domain.wiki_folder)} is outside the vault.` };
    return;
  }
  const wikiRoot = wikiVaultPath.split("/").slice(0, -1).join("/");
  const [schemaContent, indexContent] = await Promise.all([
    tryRead(vaultTools, `${wikiRoot}/_wiki_schema.md`),
    tryRead(vaultTools, `${wikiRoot}/_index.md`)
  ]);
  const existingPaths = await vaultTools.listFiles(wikiVaultPath);
  const existingPages = await vaultTools.readAll(existingPaths.filter((f) => !f.endsWith("_index.md")));
  yield { kind: "assistant_text", delta: `Synthesizing wiki pages for domain "${domain.id}"...
` };
  const start = Date.now();
  const messages = buildIngestMessages(
    sourceVaultPath,
    sourceContent,
    domain,
    wikiVaultPath,
    existingPages,
    schemaContent,
    indexContent
  );
  const params = buildChatParams(model, messages, opts);
  let fullText = "";
  try {
    const stream = await llm.chat.completions.create(
      { ...params, stream: true },
      { signal }
    );
    for await (const chunk of stream) {
      const { reasoning, content } = extractStreamDeltas(chunk);
      if (reasoning)
        yield { kind: "assistant_text", delta: reasoning, isReasoning: true };
      if (content)
        fullText += content;
    }
  } catch (e) {
    if (signal.aborted || e.name === "AbortError")
      return;
    const resp = await llm.chat.completions.create(
      { ...params, stream: false }
    );
    fullText = resp.choices[0]?.message?.content ?? "";
  }
  if (signal.aborted)
    return;
  const pages = parseJsonPages(fullText);
  const written = [];
  for (const page of pages) {
    if (!page.path.startsWith(wikiVaultPath + "/")) {
      yield { kind: "tool_use", name: "Write", input: { path: page.path } };
      yield { kind: "tool_result", ok: false, preview: `Blocked: path outside wiki folder (${wikiVaultPath})` };
      continue;
    }
    yield { kind: "tool_use", name: "Write", input: { path: page.path } };
    try {
      await vaultTools.write(page.path, page.content);
      written.push(page.path);
      yield { kind: "tool_result", ok: true };
    } catch (e) {
      yield { kind: "tool_result", ok: false, preview: e.message };
    }
  }
  const resultText = buildIngestSummary(domain.id, sourceVaultPath, written, pages.length);
  yield { kind: "assistant_text", delta: resultText };
  if (written.length > 0) {
    await appendLog(vaultTools, wikiRoot, sourceVaultPath, domain.id, written);
    await updateIndex(vaultTools, wikiRoot, written);
    const parentPath = extractParentSourcePath(absSource, vaultRoot);
    yield { kind: "source_path_added", domainId: domain.id, path: parentPath };
  }
  yield { kind: "result", durationMs: Date.now() - start, text: resultText };
}
function buildIngestSummary(domainId, sourcePath, written, total) {
  const src = sourcePath.split("/").pop() ?? sourcePath;
  if (written.length === 0) {
    return `\u0418\u0441\u0442\u043E\u0447\u043D\u0438\u043A \xAB${src}\xBB \u043E\u0431\u0440\u0430\u0431\u043E\u0442\u0430\u043D \u2014 \u043D\u043E\u0432\u044B\u0445 \u0438\u043B\u0438 \u0438\u0437\u043C\u0435\u043D\u0451\u043D\u043D\u044B\u0445 \u0441\u0442\u0440\u0430\u043D\u0438\u0446 \u043D\u0435\u0442.`;
  }
  const skipped = total - written.length;
  const lines = [`\u0418\u0441\u0442\u043E\u0447\u043D\u0438\u043A \xAB${src}\xBB \u2192 \u0434\u043E\u043C\u0435\u043D \xAB${domainId}\xBB: \u0437\u0430\u043F\u0438\u0441\u0430\u043D\u043E ${written.length} \u0441\u0442\u0440.${skipped > 0 ? `, \u043E\u0448\u0438\u0431\u043E\u043A ${skipped}` : ""}`];
  for (const p of written) {
    lines.push(`  \u2022 ${p.split("/").pop()}`);
  }
  return lines.join("\n");
}
function detectDomain(absFilePath, domains, vaultRoot) {
  for (const d of domains) {
    const matched = d.source_paths?.some((sp) => {
      const abs = (0, import_node_path2.isAbsolute)(sp) ? sp : (0, import_node_path2.join)(vaultRoot, sp);
      return absFilePath.startsWith(abs);
    });
    if (matched)
      return d;
  }
  return domains[0] ?? null;
}
function parseJsonPages(text) {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match)
    return [];
  try {
    const arr = JSON.parse(match[0]);
    if (!Array.isArray(arr))
      return [];
    return arr.filter(
      (x) => x !== null && typeof x === "object" && typeof x.path === "string" && typeof x.content === "string"
    );
  } catch {
    return [];
  }
}
async function appendLog(vaultTools, wikiRoot, sourcePath, domainId, written) {
  const logPath = `${wikiRoot}/_log.md`;
  const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const entry = `
## ${today} \u2014 ingest \u2014 ${domainId}
- \u0418\u0441\u0442\u043E\u0447\u043D\u0438\u043A: ${sourcePath}
- \u0421\u0442\u0440\u0430\u043D\u0438\u0446: ${written.map((p) => `
  - ${p}`).join("")}
`;
  try {
    const existing = await tryRead(vaultTools, logPath);
    await vaultTools.write(logPath, existing + entry);
  } catch {
  }
}
async function updateIndex(vaultTools, wikiRoot, written) {
  const indexPath = `${wikiRoot}/_index.md`;
  try {
    const existing = await tryRead(vaultTools, indexPath);
    const newLinks = written.map((p) => {
      const name = p.split("/").pop()?.replace(/\.md$/, "") ?? p;
      return `- [[${name}]]`;
    }).join("\n");
    const updated = existing ? existing + "\n" + newLinks : `# Wiki Index

${newLinks}`;
    await vaultTools.write(indexPath, updated);
  } catch {
  }
}
async function tryRead(vaultTools, path2) {
  try {
    return await vaultTools.read(path2);
  } catch {
    return "";
  }
}
function extractParentSourcePath(absSource, vaultRoot) {
  const parentAbs = (0, import_node_path2.dirname)(absSource);
  const normedVault = vaultRoot.endsWith("/") ? vaultRoot : vaultRoot + "/";
  const clamped = (parentAbs + "/").startsWith(normedVault) ? parentAbs : vaultRoot;
  const rel = (0, import_node_path2.relative)(vaultRoot, clamped);
  return (rel || ".") + "/";
}
function buildEntityTypesBlock(domain) {
  if (!domain.entity_types?.length)
    return "";
  return domain.entity_types.map((et) => [
    `### \u0422\u0438\u043F: ${et.type}`,
    `\u041E\u043F\u0438\u0441\u0430\u043D\u0438\u0435: ${et.description}`,
    `\u041A\u043B\u044E\u0447\u0435\u0432\u044B\u0435 \u0441\u043B\u043E\u0432\u0430: ${et.extraction_cues.join(", ")}`,
    et.min_mentions_for_page != null ? `\u041C\u0438\u043D. \u0443\u043F\u043E\u043C\u0438\u043D\u0430\u043D\u0438\u0439 \u0434\u043B\u044F \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u044B: ${et.min_mentions_for_page}` : "",
    et.wiki_subfolder ? `\u041F\u043E\u0434\u043F\u0430\u043F\u043A\u0430 \u0432 wiki: ${et.wiki_subfolder}` : ""
  ].filter(Boolean).join("\n")).join("\n\n");
}
function buildIngestMessages(sourcePath, sourceContent, domain, wikiVaultPath, existingPages, schemaContent, indexContent) {
  const existing = existingPages.size > 0 ? [...existingPages.entries()].map(([p, c]) => `${p}:
${c.slice(0, 400)}`).join("\n\n") : "\u041D\u0435\u0442.";
  const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const entityTypesBlock = buildEntityTypesBlock(domain);
  const langNotes = domain.language_notes ? `\u042F\u0437\u044B\u043A\u043E\u0432\u044B\u0435 \u043F\u0440\u0430\u0432\u0438\u043B\u0430: ${domain.language_notes}` : "";
  const systemContent = render(ingest_default, {
    domain_name: domain.name,
    entity_types_block: entityTypesBlock || "(\u043D\u0435 \u0437\u0430\u0434\u0430\u043D\u044B)",
    lang_notes: langNotes,
    wiki_path: wikiVaultPath,
    today,
    schema_block: schemaContent ? `\u041A\u041E\u041D\u0412\u0415\u041D\u0426\u0418\u0418 (_wiki_schema.md):
${schemaContent.slice(0, 2e3)}` : "",
    source_path: sourcePath
  });
  return [
    { role: "system", content: systemContent },
    {
      role: "user",
      content: [
        `\u0414\u043E\u043C\u0435\u043D: ${domain.id} (${domain.name})`,
        `Wiki-\u043F\u0430\u043F\u043A\u0430: ${wikiVaultPath}`,
        ``,
        `\u0418\u0441\u0442\u043E\u0447\u043D\u0438\u043A: ${sourcePath}`,
        sourceContent.slice(0, 8e3),
        ``,
        `\u0421\u0443\u0449\u0435\u0441\u0442\u0432\u0443\u044E\u0449\u0438\u0435 wiki-\u0441\u0442\u0440\u0430\u043D\u0438\u0446\u044B:
${existing}`,
        indexContent ? `
\u0418\u043D\u0434\u0435\u043A\u0441 wiki (_index.md):
${indexContent.slice(0, 2e3)}` : ""
      ].filter(Boolean).join("\n")
    }
  ];
}

// prompts/query.md
var query_default = "\u0422\u044B \u2014 \u0430\u0441\u0441\u0438\u0441\u0442\u0435\u043D\u0442 \u043F\u043E wiki-\u0431\u0430\u0437\u0435 \u0437\u043D\u0430\u043D\u0438\u0439 \u0434\u043E\u043C\u0435\u043D\u0430 \xAB{{domain_name}}\xBB.\n\u041E\u0442\u0432\u0435\u0447\u0430\u0439 \u0441\u0442\u0440\u043E\u0433\u043E \u043D\u0430 \u043E\u0441\u043D\u043E\u0432\u0435 \u043F\u0440\u0435\u0434\u043E\u0441\u0442\u0430\u0432\u043B\u0435\u043D\u043D\u044B\u0445 wiki-\u0441\u0442\u0440\u0430\u043D\u0438\u0446. \u0411\u0443\u0434\u044C \u0442\u043E\u0447\u0435\u043D \u0438 \u043B\u0430\u043A\u043E\u043D\u0438\u0447\u0435\u043D.\n\u0418\u0441\u043F\u043E\u043B\u044C\u0437\u0443\u0439 WikiLinks [[\u043D\u0430\u0437\u0432\u0430\u043D\u0438\u0435]] \u043F\u0440\u0438 \u0441\u0441\u044B\u043B\u043A\u0430\u0445 \u043D\u0430 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u044B \u0438\u0437 \u0438\u043D\u0434\u0435\u043A\u0441\u0430.\n{{entity_types_block}}\n{{schema_block}}\n{{index_block}}\n";

// src/phases/query.ts
var MAX_CONTEXT_CHARS = 8e4;
var META_FILES = ["_index.md", "_log.md", "_wiki_schema.md"];
async function* runQuery(args, save, vaultTools, llm, model, domains, vaultRoot, signal, opts = {}) {
  const question = args[0]?.trim();
  if (!question) {
    yield { kind: "error", message: "query: question required" };
    return;
  }
  const domain = domains[0];
  if (!domain) {
    yield { kind: "error", message: "No domain configured. Add a domain in settings." };
    return;
  }
  if (!domain.wiki_folder || domain.wiki_folder.includes("..")) {
    yield { kind: "error", message: `Wiki folder ${domain.wiki_folder} is outside the vault.` };
    return;
  }
  const wikiVaultPath = domainWikiFolder(domain.wiki_folder);
  const wikiRoot = wikiVaultPath.split("/").slice(0, -1).join("/");
  yield { kind: "tool_use", name: "Glob", input: { pattern: `${wikiVaultPath}/**/*.md` } };
  const allFiles = await vaultTools.listFiles(wikiVaultPath);
  const files = allFiles.filter((f) => !META_FILES.some((m) => f.endsWith(m)));
  yield { kind: "tool_result", ok: true, preview: `${files.length} pages` };
  const [indexContent, schemaContent] = await Promise.all([
    tryRead2(vaultTools, `${wikiRoot}/_index.md`),
    tryRead2(vaultTools, `${wikiRoot}/_wiki_schema.md`)
  ]);
  const pages = await vaultTools.readAll(files);
  const start = Date.now();
  let contextBlock = [...pages.entries()].map(([p, c]) => `--- ${p} ---
${c}`).join("\n\n");
  if (contextBlock.length > MAX_CONTEXT_CHARS) {
    contextBlock = contextBlock.slice(0, MAX_CONTEXT_CHARS) + "\n[...truncated]";
  }
  const entityTypesBlock = buildEntityTypesBlock2(domain);
  const systemPrompt = render(query_default, {
    domain_name: domain.name,
    entity_types_block: entityTypesBlock,
    schema_block: schemaContent ? `
\u041A\u043E\u043D\u0432\u0435\u043D\u0446\u0438\u0438 (_wiki_schema.md):
${schemaContent.slice(0, 2e3)}` : "",
    index_block: indexContent ? `
\u0412\u0438\u043A\u0438-\u0438\u043D\u0434\u0435\u043A\u0441 (_index.md):
${indexContent.slice(0, 3e3)}` : ""
  });
  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: `\u0412\u043E\u043F\u0440\u043E\u0441: ${question}

Wiki-\u0441\u0442\u0440\u0430\u043D\u0438\u0446\u044B:
${contextBlock}` }
  ];
  const params = buildChatParams(model, messages, opts);
  let answer = "";
  try {
    const stream = await llm.chat.completions.create(
      { ...params, stream: true },
      { signal }
    );
    for await (const chunk of stream) {
      const { reasoning, content } = extractStreamDeltas(chunk);
      if (reasoning)
        yield { kind: "assistant_text", delta: reasoning, isReasoning: true };
      if (content) {
        answer += content;
        yield { kind: "assistant_text", delta: content };
      }
    }
  } catch (e) {
    if (signal.aborted || e.name === "AbortError")
      return;
    const resp = await llm.chat.completions.create(
      { ...params, stream: false }
    );
    answer = resp.choices[0]?.message?.content ?? "";
    if (answer)
      yield { kind: "assistant_text", delta: answer };
  }
  if (signal.aborted)
    return;
  if (save && answer) {
    const slug = question.slice(0, 40).replace(/[^a-zA-Z0-9а-яёА-ЯЁ\s]/g, "").trim().replace(/\s+/g, "-");
    const savePath = `${wikiVaultPath}/Q-${slug}.md`;
    const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    const pageContent = [
      `---`,
      `wiki_sources: []`,
      `wiki_updated: ${today}`,
      `wiki_status: mature`,
      `tags: []`,
      `---`,
      ``,
      `# ${question}`,
      ``,
      answer
    ].join("\n");
    yield { kind: "tool_use", name: "Write", input: { path: savePath } };
    try {
      await vaultTools.write(savePath, pageContent);
      yield { kind: "tool_result", ok: true };
      yield { kind: "result", durationMs: Date.now() - start, text: `\u0421\u043E\u0437\u0434\u0430\u043D\u0430 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0430: ${savePath}

${answer}` };
    } catch (e) {
      yield { kind: "tool_result", ok: false, preview: e.message };
      yield { kind: "result", durationMs: Date.now() - start, text: answer };
    }
  } else {
    yield { kind: "result", durationMs: Date.now() - start, text: answer };
  }
}
async function tryRead2(vaultTools, path2) {
  try {
    return await vaultTools.read(path2);
  } catch {
    return "";
  }
}
function buildEntityTypesBlock2(domain) {
  if (!domain.entity_types?.length)
    return "";
  const types = domain.entity_types.map((et) => `  - ${et.type}: ${et.description}`).join("\n");
  const notes = domain.language_notes ? `
\u042F\u0437\u044B\u043A\u043E\u0432\u044B\u0435 \u043F\u0440\u0430\u0432\u0438\u043B\u0430: ${domain.language_notes}` : "";
  return `\u0422\u0438\u043F\u044B \u0441\u0443\u0449\u043D\u043E\u0441\u0442\u0435\u0439 \u0434\u043E\u043C\u0435\u043D\u0430 \xAB${domain.name}\xBB:
${types}${notes}`;
}

// src/phases/lint.ts
var import_node_path3 = require("node:path");

// prompts/lint.md
var lint_default = "\u0422\u044B \u2014 \u0440\u0435\u0446\u0435\u043D\u0437\u0435\u043D\u0442 \u043A\u0430\u0447\u0435\u0441\u0442\u0432\u0430 wiki-\u0431\u0430\u0437\u044B \u0437\u043D\u0430\u043D\u0438\u0439 \u0434\u043E\u043C\u0435\u043D\u0430 \xAB{{domain_name}}\xBB.\n\u0412\u044B\u044F\u0432\u043B\u044F\u0439: \u0434\u0443\u0431\u043B\u0438\u0440\u043E\u0432\u0430\u043D\u0438\u0435, \u043F\u0440\u043E\u0431\u0435\u043B\u044B, \u0440\u0430\u0437\u043C\u044B\u0442\u044B\u0435 \u043E\u043F\u0440\u0435\u0434\u0435\u043B\u0435\u043D\u0438\u044F, \u0443\u0441\u0442\u0430\u0440\u0435\u0432\u0448\u0438\u0439 \u043A\u043E\u043D\u0442\u0435\u043D\u0442.\n\u0412\u0435\u0440\u043D\u0438 \u043A\u0440\u0430\u0442\u043A\u0438\u0439 \u043E\u0442\u0447\u0451\u0442 \u0432 markdown.\n{{entity_types_block}}\n";

// src/phases/lint.ts
var META_FILES2 = ["_index.md", "_log.md", "_wiki_schema.md"];
async function* runLint(args, vaultTools, llm, model, domains, vaultRoot, signal, opts = {}) {
  const domainId = args[0];
  const targets = domainId ? domains.filter((d) => d.id === domainId) : domains;
  if (targets.length === 0) {
    yield { kind: "error", message: domainId ? `Domain "${domainId}" not found.` : "No domains configured." };
    return;
  }
  const start = Date.now();
  const reportParts = [];
  for (const domain of targets) {
    if (signal.aborted)
      return;
    const absWiki = (0, import_node_path3.join)(vaultRoot, domainWikiFolder(domain.wiki_folder));
    const wikiVaultPath = vaultTools.toVaultPath(absWiki);
    if (!wikiVaultPath) {
      reportParts.push(`## ${domain.id}
Wiki folder outside vault \u2014 skipped.`);
      continue;
    }
    yield { kind: "tool_use", name: "Glob", input: { pattern: `${wikiVaultPath}/**/*.md` } };
    const allFiles = await vaultTools.listFiles(wikiVaultPath);
    const files = allFiles.filter((f) => !META_FILES2.some((m) => f.endsWith(m)));
    yield { kind: "tool_result", ok: true, preview: `${files.length} pages` };
    const pages = await vaultTools.readAll(files);
    const structuralIssues = checkStructure(pages);
    const entityTypesBlock = buildEntityTypesBlock3(domain);
    yield { kind: "assistant_text", delta: `Evaluating domain "${domain.id}" quality...
` };
    const systemContent = render(lint_default, {
      domain_name: domain.name,
      entity_types_block: entityTypesBlock ? `
\u0422\u0418\u041F\u042B \u0421\u0423\u0429\u041D\u041E\u0421\u0422\u0415\u0419 \u0414\u041E\u041C\u0415\u041D\u0410:
${entityTypesBlock}` : ""
    });
    const messages = [
      { role: "system", content: systemContent },
      {
        role: "user",
        content: [
          `\u0414\u043E\u043C\u0435\u043D: ${domain.id} (${domain.name})`,
          `\u0410\u0432\u0442\u043E\u043C\u0430\u0442\u0438\u0447\u0435\u0441\u043A\u0438\u0435 \u043F\u0440\u043E\u0431\u043B\u0435\u043C\u044B:
${structuralIssues || "\u041D\u0435\u0442."}`,
          "",
          `Wiki-\u0441\u0442\u0440\u0430\u043D\u0438\u0446\u044B:
${[...pages.entries()].map(([p, c]) => `--- ${p} ---
${c.slice(0, 500)}`).join("\n\n")}`
        ].join("\n")
      }
    ];
    const params = buildChatParams(model, messages, opts);
    let llmReport = "";
    try {
      const stream = await llm.chat.completions.create(
        { ...params, stream: true },
        { signal }
      );
      for await (const chunk of stream) {
        const { reasoning, content } = extractStreamDeltas(chunk);
        if (reasoning)
          yield { kind: "assistant_text", delta: reasoning, isReasoning: true };
        if (content) {
          llmReport += content;
          yield { kind: "assistant_text", delta: content };
        }
      }
    } catch (e) {
      if (signal.aborted || e.name === "AbortError")
        return;
      const resp = await llm.chat.completions.create(
        { ...params, stream: false }
      );
      llmReport = resp.choices[0]?.message?.content ?? "";
      if (llmReport)
        yield { kind: "assistant_text", delta: llmReport };
    }
    reportParts.push(`## ${domain.id}
${structuralIssues ? `**\u0421\u0442\u0440\u0443\u043A\u0442\u0443\u0440\u043D\u044B\u0435 \u043F\u0440\u043E\u0431\u043B\u0435\u043C\u044B:**
${structuralIssues}

` : ""}${llmReport}`);
    if (signal.aborted)
      return;
    yield { kind: "assistant_text", delta: `
Actualizing domain config for "${domain.id}"...
` };
    const patch = await actualizeDomainConfig(domain, pages, llm, model, opts, signal);
    if (patch) {
      const diffReport = computeEntityDiff(domain.entity_types ?? [], patch.entity_types ?? domain.entity_types ?? []);
      reportParts.push(diffReport);
      yield { kind: "domain_updated", domainId: domain.id, patch };
    }
    if (signal.aborted)
      return;
    yield { kind: "assistant_text", delta: `
Applying fixes for "${domain.id}"...
` };
    const fixMessages = buildFixMessages(domain, wikiVaultPath, pages, structuralIssues, entityTypesBlock, llmReport);
    const fixParams = buildChatParams(model, fixMessages, opts);
    let fixFullText = "";
    try {
      const fixStream = await llm.chat.completions.create(
        { ...fixParams, stream: true },
        { signal }
      );
      for await (const chunk of fixStream) {
        const { content } = extractStreamDeltas(chunk);
        if (content)
          fixFullText += content;
      }
    } catch (e) {
      if (signal.aborted || e.name === "AbortError")
        return;
      const resp = await llm.chat.completions.create(
        { ...fixParams, stream: false }
      );
      fixFullText = resp.choices[0]?.message?.content ?? "";
    }
    const fixedPages = parseJsonPages(fixFullText);
    const writtenPaths = [];
    for (const page of fixedPages) {
      if (!page.path.startsWith(wikiVaultPath + "/")) {
        yield { kind: "tool_use", name: "Write", input: { path: page.path } };
        yield { kind: "tool_result", ok: false, preview: `Blocked: path outside wiki folder (${wikiVaultPath})` };
        continue;
      }
      yield { kind: "tool_use", name: "Write", input: { path: page.path } };
      try {
        await vaultTools.write(page.path, page.content);
        writtenPaths.push(page.path);
        yield { kind: "tool_result", ok: true };
      } catch (e) {
        yield { kind: "tool_result", ok: false, preview: e.message };
      }
    }
    if (writtenPaths.length > 0) {
      reportParts.push(`### \u0418\u0441\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u043E \u0441\u0442\u0440\u0430\u043D\u0438\u0446: ${writtenPaths.length}
${writtenPaths.map((p) => `- ${p.split("/").pop()}`).join("\n")}`);
    }
  }
  yield { kind: "result", durationMs: Date.now() - start, text: reportParts.join("\n\n---\n\n") };
}
function checkStructure(pages) {
  const issues = [];
  for (const [path2, content] of pages) {
    if (!content.startsWith("---")) {
      issues.push(`- ${path2}: missing frontmatter`);
    }
    const links = [...content.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1]);
    for (const link of links) {
      const linked = [...pages.keys()].some((p) => p.endsWith(`${link}.md`));
      if (!linked)
        issues.push(`- ${path2}: dead link [[${link}]]`);
    }
  }
  return issues.join("\n");
}
function buildEntityTypesBlock3(domain) {
  if (!domain.entity_types?.length)
    return "";
  return domain.entity_types.map((et) => `- ${et.type}: ${et.description}`).join("\n");
}
function computeEntityDiff(oldTypes, newTypes) {
  const oldMap = new Map(oldTypes.map((et) => [et.type, et]));
  const newMap = new Map(newTypes.map((et) => [et.type, et]));
  const added = newTypes.filter((et) => !oldMap.has(et.type));
  const removed = oldTypes.filter((et) => !newMap.has(et.type));
  const modified = newTypes.filter((et) => {
    const old = oldMap.get(et.type);
    return old && JSON.stringify(old) !== JSON.stringify(et);
  });
  if (!added.length && !removed.length && !modified.length)
    return "### \u0418\u0437\u043C\u0435\u043D\u0435\u043D\u0438\u044F entity_types\n\u0418\u0437\u043C\u0435\u043D\u0435\u043D\u0438\u0439 \u043D\u0435\u0442.";
  const lines = ["### \u0418\u0437\u043C\u0435\u043D\u0435\u043D\u0438\u044F entity_types"];
  added.forEach((et) => lines.push(`- \u271A \u0434\u043E\u0431\u0430\u0432\u043B\u0435\u043D: **${et.type}**`));
  removed.forEach((et) => lines.push(`- \u2716 \u0443\u0434\u0430\u043B\u0451\u043D: **${et.type}**`));
  modified.forEach((et) => lines.push(`- \u270E \u043E\u0431\u043D\u043E\u0432\u043B\u0451\u043D: **${et.type}**`));
  return lines.join("\n");
}
function buildFixMessages(domain, wikiVaultPath, pages, structuralIssues, entityTypesBlock, lintReport) {
  const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const pagesBlock = [...pages.entries()].map(([p, c]) => `--- ${p} ---
${c}`).join("\n\n");
  return [
    {
      role: "system",
      content: [
        `\u0422\u044B \u2014 \u0440\u0435\u0434\u0430\u043A\u0442\u043E\u0440 wiki-\u0431\u0430\u0437\u044B \u0437\u043D\u0430\u043D\u0438\u0439 \u0434\u043E\u043C\u0435\u043D\u0430 \xAB${domain.name}\xBB.`,
        `\u0418\u0441\u043F\u0440\u0430\u0432\u044C \u043F\u0440\u043E\u0431\u043B\u0435\u043C\u044B \u0432 wiki-\u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0430\u0445 \u0438 \u0432\u0435\u0440\u043D\u0438 \u0442\u043E\u043B\u044C\u043A\u043E \u0438\u0437\u043C\u0435\u043D\u0451\u043D\u043D\u044B\u0435 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u044B.`,
        `\u041F\u0420\u0410\u0412\u0418\u041B\u0410: \u043C\u0451\u0440\u0442\u0432\u044B\u0435 \u0441\u0441\u044B\u043B\u043A\u0438 [[X]] \u0443\u0431\u0435\u0440\u0438 \u0438\u043B\u0438 \u0437\u0430\u043C\u0435\u043D\u0438; \u043E\u0442\u0441\u0443\u0442\u0441\u0442\u0432\u0443\u044E\u0449\u0438\u0439 frontmatter \u0434\u043E\u0431\u0430\u0432\u044C (wiki_updated: ${today}, wiki_status: stub); \u0434\u0443\u0431\u043B\u0438\u0440\u043E\u0432\u0430\u043D\u0438\u0435 \u043E\u0431\u044A\u0435\u0434\u0438\u043D\u0438; \u0440\u0430\u0437\u043C\u044B\u0442\u044B\u0435 \u043E\u043F\u0440\u0435\u0434\u0435\u043B\u0435\u043D\u0438\u044F \u0443\u0442\u043E\u0447\u043D\u0438.`,
        entityTypesBlock ? `
\u0422\u0418\u041F\u042B \u0421\u0423\u0429\u041D\u041E\u0421\u0422\u0415\u0419:
${entityTypesBlock}` : "",
        `
\u0412\u0435\u0440\u043D\u0438 \u0422\u041E\u041B\u042C\u041A\u041E JSON-\u043C\u0430\u0441\u0441\u0438\u0432 \u0438\u0437\u043C\u0435\u043D\u0451\u043D\u043D\u044B\u0445 \u0441\u0442\u0440\u0430\u043D\u0438\u0446:`,
        `[{"path":"${wikiVaultPath}/EntityName.md","content":"\u043F\u043E\u043B\u043D\u044B\u0439 \u043A\u043E\u043D\u0442\u0435\u043D\u0442"}]`
      ].filter(Boolean).join("\n")
    },
    {
      role: "user",
      content: [
        `\u0414\u043E\u043C\u0435\u043D: ${domain.id} (${domain.name})`,
        structuralIssues ? `
\u0421\u0442\u0440\u0443\u043A\u0442\u0443\u0440\u043D\u044B\u0435 \u043F\u0440\u043E\u0431\u043B\u0435\u043C\u044B:
${structuralIssues}` : "\n\u0421\u0442\u0440\u0443\u043A\u0442\u0443\u0440\u043D\u044B\u0445 \u043F\u0440\u043E\u0431\u043B\u0435\u043C \u043D\u0435 \u043E\u0431\u043D\u0430\u0440\u0443\u0436\u0435\u043D\u043E.",
        `
\u041E\u0442\u0447\u0451\u0442 Lint (\u0440\u0435\u043A\u043E\u043C\u0435\u043D\u0434\u0430\u0446\u0438\u0438):
${lintReport}`,
        `
Wiki-\u0441\u0442\u0440\u0430\u043D\u0438\u0446\u044B:
${pagesBlock}`
      ].join("\n")
    }
  ];
}
async function actualizeDomainConfig(domain, pages, llm, model, opts, signal) {
  const currentConfig = JSON.stringify({
    entity_types: domain.entity_types ?? [],
    language_notes: domain.language_notes ?? ""
  }, null, 2);
  const pagesSnippet = [...pages.entries()].map(([p, c]) => `${p}:
${c.slice(0, 300)}`).join("\n\n");
  const messages = [
    {
      role: "system",
      content: [
        `\u0422\u044B \u2014 \u0430\u0440\u0445\u0438\u0442\u0435\u043A\u0442\u043E\u0440 wiki-\u0431\u0430\u0437\u044B \u0437\u043D\u0430\u043D\u0438\u0439. \u041F\u0440\u043E\u0430\u043D\u0430\u043B\u0438\u0437\u0438\u0440\u0443\u0439 \u0442\u0435\u043A\u0443\u0449\u0438\u0439 \u043A\u043E\u043D\u0444\u0438\u0433 \u0434\u043E\u043C\u0435\u043D\u0430 \u0438 \u0440\u0435\u0430\u043B\u044C\u043D\u043E\u0435 \u0441\u043E\u0434\u0435\u0440\u0436\u0438\u043C\u043E\u0435 wiki.`,
        `\u0412\u0435\u0440\u043D\u0438 \u0422\u041E\u041B\u042C\u041A\u041E \u0432\u0430\u043B\u0438\u0434\u043D\u044B\u0439 JSON \u0441 \u043E\u0431\u043D\u043E\u0432\u043B\u0451\u043D\u043D\u044B\u043C\u0438 \u043F\u043E\u043B\u044F\u043C\u0438:`,
        `{`,
        `  "entity_types": [{"type":"...","description":"...","extraction_cues":["..."],"min_mentions_for_page":1,"wiki_subfolder":"..."}],`,
        `  "language_notes": "..."`,
        `}`,
        `\u041F\u0440\u0430\u0432\u0438\u043B\u0430 \u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u0438\u044F:`,
        `- \u0421\u043E\u0445\u0440\u0430\u043D\u044F\u0439 \u0441\u0443\u0449\u0435\u0441\u0442\u0432\u0443\u044E\u0449\u0438\u0435 \u0442\u0438\u043F\u044B \u0435\u0441\u043B\u0438 \u043E\u043D\u0438 \u043F\u043E\u043B\u0435\u0437\u043D\u044B, \u0443\u0442\u043E\u0447\u043D\u044F\u0439 \u043E\u043F\u0438\u0441\u0430\u043D\u0438\u044F \u043F\u043E \u0440\u0435\u0430\u043B\u044C\u043D\u043E\u043C\u0443 \u043A\u043E\u043D\u0442\u0435\u043D\u0442\u0443`,
        `- \u0414\u043E\u0431\u0430\u0432\u043B\u044F\u0439 \u043D\u043E\u0432\u044B\u0435 \u0442\u0438\u043F\u044B \u0435\u0441\u043B\u0438 \u0432 wiki \u0435\u0441\u0442\u044C \u043F\u0430\u0442\u0442\u0435\u0440\u043D\u044B, \u043D\u0435 \u043F\u043E\u043A\u0440\u044B\u0442\u044B\u0435 \u0442\u0435\u043A\u0443\u0449\u0438\u043C \u043A\u043E\u043D\u0444\u0438\u0433\u043E\u043C`,
        `- \u0423\u0431\u0438\u0440\u0430\u0439 \u0442\u0438\u043F\u044B \u0441 \u043D\u0443\u043B\u0435\u0432\u044B\u043C \u043F\u043E\u043A\u0440\u044B\u0442\u0438\u0435\u043C \u0442\u043E\u043B\u044C\u043A\u043E \u0435\u0441\u043B\u0438 \u0443\u0432\u0435\u0440\u0435\u043D \u0447\u0442\u043E \u043E\u043D\u0438 \u043D\u0435\u0440\u0435\u043B\u0435\u0432\u0430\u043D\u0442\u043D\u044B`,
        `- \u041E\u0431\u043D\u043E\u0432\u043B\u044F\u0439 extraction_cues \u043F\u043E \u0440\u0435\u0430\u043B\u044C\u043D\u044B\u043C \u0441\u043B\u043E\u0432\u0430\u043C \u0438\u0437 wiki-\u0441\u0442\u0440\u0430\u043D\u0438\u0446`,
        `- language_notes \u2014 \u043F\u0440\u0430\u0432\u0438\u043B\u0430 \u043D\u0430\u043F\u0438\u0441\u0430\u043D\u0438\u044F \u0442\u0435\u0440\u043C\u0438\u043D\u043E\u0432, \u043A\u043E\u0442\u043E\u0440\u044B\u0435 \u0430\u0433\u0435\u043D\u0442 \u0434\u043E\u043B\u0436\u0435\u043D \u0441\u043E\u0431\u043B\u044E\u0434\u0430\u0442\u044C`
      ].join("\n")
    },
    {
      role: "user",
      content: [
        `\u0414\u043E\u043C\u0435\u043D: ${domain.id} (${domain.name})`,
        ``,
        `\u0422\u0435\u043A\u0443\u0449\u0438\u0439 \u043A\u043E\u043D\u0444\u0438\u0433:`,
        `\`\`\`json`,
        currentConfig,
        `\`\`\``,
        ``,
        `Wiki-\u0441\u0442\u0440\u0430\u043D\u0438\u0446\u044B (\u0444\u0440\u0430\u0433\u043C\u0435\u043D\u0442\u044B):`,
        pagesSnippet || "(\u043D\u0435\u0442 \u0441\u0442\u0440\u0430\u043D\u0438\u0446)"
      ].join("\n")
    }
  ];
  const params = buildChatParams(model, messages, opts);
  let fullText = "";
  try {
    const resp = await llm.chat.completions.create(
      { ...params, stream: false },
      { signal }
    );
    fullText = resp.choices[0]?.message?.content ?? "";
  } catch {
    return null;
  }
  try {
    const match = fullText.match(/\{[\s\S]*\}/);
    if (!match)
      return null;
    const parsed = JSON.parse(match[0]);
    const patch = {};
    if (Array.isArray(parsed.entity_types))
      patch.entity_types = parsed.entity_types;
    if (typeof parsed.language_notes === "string")
      patch.language_notes = parsed.language_notes;
    return Object.keys(patch).length > 0 ? patch : null;
  } catch {
    return null;
  }
}

// src/phases/fix.ts
var import_node_path4 = require("node:path");

// prompts/fix.md
var fix_default = '\u0422\u044B \u2014 \u0440\u0435\u0434\u0430\u043A\u0442\u043E\u0440 wiki-\u0431\u0430\u0437\u044B \u0437\u043D\u0430\u043D\u0438\u0439 \u0434\u043E\u043C\u0435\u043D\u0430 \xAB{{domain_name}}\xBB.\n{{fix_instruction}}\n\n{{entity_types_block}}\n\u0412\u0435\u0440\u043D\u0438 \u0422\u041E\u041B\u042C\u041A\u041E JSON-\u043C\u0430\u0441\u0441\u0438\u0432 \u0438\u0437\u043C\u0435\u043D\u0451\u043D\u043D\u044B\u0445 \u0441\u0442\u0440\u0430\u043D\u0438\u0446 (\u0435\u0441\u043B\u0438 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0430 \u043D\u0435 \u0438\u0437\u043C\u0435\u043D\u0438\u043B\u0430\u0441\u044C \u2014 \u043D\u0435 \u0432\u043A\u043B\u044E\u0447\u0430\u0439):\n[{"path":"{{wiki_path}}/EntityName.md","content":"\u043F\u043E\u043B\u043D\u044B\u0439 \u043A\u043E\u043D\u0442\u0435\u043D\u0442 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u044B"}]\n\u0414\u043E\u043F\u0443\u0441\u0442\u0438\u043C\u044B\u0435 \u043F\u0443\u0442\u0438 wiki: {{wiki_path}}/\n\u0414\u0430\u0442\u0430: {{today}}\n';

// src/phases/fix.ts
var META_FILES3 = ["_index.md", "_log.md", "_wiki_schema.md"];
async function* runFix(args, vaultTools, llm, model, domains, vaultRoot, signal, opts = {}, lintReport, userInstruction) {
  const domainId = args[0];
  const domain = domainId ? domains.find((d) => d.id === domainId) : domains[0];
  if (!domain) {
    yield { kind: "error", message: domainId ? `Domain "${domainId}" not found.` : "No domains configured." };
    return;
  }
  const absWiki = (0, import_node_path4.join)(vaultRoot, domainWikiFolder(domain.wiki_folder));
  const wikiVaultPath = vaultTools.toVaultPath(absWiki);
  if (!wikiVaultPath) {
    yield { kind: "error", message: `Wiki folder ${domainWikiFolder(domain.wiki_folder)} is outside the vault.` };
    return;
  }
  yield { kind: "tool_use", name: "Glob", input: { pattern: `${wikiVaultPath}/**/*.md` } };
  const allFiles = await vaultTools.listFiles(wikiVaultPath);
  const files = allFiles.filter((f) => !META_FILES3.some((m) => f.endsWith(m)));
  yield { kind: "tool_result", ok: true, preview: `${files.length} pages` };
  if (files.length === 0) {
    const start2 = Date.now();
    yield { kind: "result", durationMs: Date.now() - start2, text: "No wiki pages to fix." };
    return;
  }
  const pages = await vaultTools.readAll(files);
  const structuralIssues = checkStructure(pages);
  const entityTypesBlock = domain.entity_types?.length ? domain.entity_types.map((et) => `- ${et.type}: ${et.description}`).join("\n") : "";
  yield { kind: "assistant_text", delta: `Fixing wiki pages for domain "${domain.id}"...
` };
  const start = Date.now();
  const messages = buildFixMessages2(domain, wikiVaultPath, pages, structuralIssues, entityTypesBlock, lintReport, userInstruction);
  const params = buildChatParams(model, messages, opts);
  let fullText = "";
  try {
    const stream = await llm.chat.completions.create(
      { ...params, stream: true },
      { signal }
    );
    for await (const chunk of stream) {
      const { reasoning, content } = extractStreamDeltas(chunk);
      if (reasoning)
        yield { kind: "assistant_text", delta: reasoning, isReasoning: true };
      if (content) {
        fullText += content;
        yield { kind: "assistant_text", delta: content };
      }
    }
  } catch (e) {
    if (signal.aborted || e.name === "AbortError")
      return;
    const resp = await llm.chat.completions.create(
      { ...params, stream: false }
    );
    fullText = resp.choices[0]?.message?.content ?? "";
    if (fullText)
      yield { kind: "assistant_text", delta: fullText };
  }
  if (signal.aborted)
    return;
  const fixedPages = parseJsonPages(fullText);
  const writtenPaths = [];
  const errors = [];
  for (const page of fixedPages) {
    yield { kind: "tool_use", name: "Write", input: { path: page.path } };
    try {
      await vaultTools.write(page.path, page.content);
      writtenPaths.push(page.path);
      yield { kind: "tool_result", ok: true };
    } catch (e) {
      errors.push(`${page.path}: ${e.message}`);
      yield { kind: "tool_result", ok: false, preview: e.message };
    }
  }
  const summary = buildFixSummary(domain.id, writtenPaths, errors, structuralIssues, lintReport);
  yield { kind: "result", durationMs: Date.now() - start, text: summary };
}
function buildFixSummary(domainId, writtenPaths, errors, structuralIssues, lintReport) {
  const lines = [];
  const source = lintReport ? "lint-\u043E\u0442\u0447\u0451\u0442\u0430" : "\u0441\u0442\u0440\u0443\u043A\u0442\u0443\u0440\u043D\u043E\u0433\u043E \u0430\u043D\u0430\u043B\u0438\u0437\u0430";
  if (writtenPaths.length > 0) {
    lines.push(`\u0418\u0441\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u043E ${writtenPaths.length} \u0441\u0442\u0440. \u0434\u043E\u043C\u0435\u043D\u0430 \xAB${domainId}\xBB \u043D\u0430 \u043E\u0441\u043D\u043E\u0432\u0435 ${source}:`);
    for (const p of writtenPaths) {
      const name = p.split("/").pop() ?? p;
      lines.push(`  \u2022 ${name}`);
    }
  } else {
    lines.push(`\u0414\u043E\u043C\u0435\u043D \xAB${domainId}\xBB: \u043F\u0440\u0430\u0432\u043A\u0438 \u043D\u0435 \u043F\u043E\u0442\u0440\u0435\u0431\u043E\u0432\u0430\u043B\u0438\u0441\u044C (\u043D\u0430 \u043E\u0441\u043D\u043E\u0432\u0435 ${source}).`);
  }
  if (errors.length > 0) {
    lines.push(`
\u041E\u0448\u0438\u0431\u043A\u0438 \u0437\u0430\u043F\u0438\u0441\u0438 (${errors.length}):`);
    for (const e of errors)
      lines.push(`  \u2716 ${e}`);
  }
  if (structuralIssues) {
    lines.push(`
\u0421\u0442\u0440\u0443\u043A\u0442\u0443\u0440\u043D\u044B\u0435 \u043F\u0440\u043E\u0431\u043B\u0435\u043C\u044B:
${structuralIssues}`);
  } else {
    lines.push("\n\u0421\u0442\u0440\u0443\u043A\u0442\u0443\u0440\u043D\u044B\u0445 \u043F\u0440\u043E\u0431\u043B\u0435\u043C \u043D\u0435 \u043E\u0431\u043D\u0430\u0440\u0443\u0436\u0435\u043D\u043E.");
  }
  return lines.join("\n");
}
function buildFixMessages2(domain, wikiVaultPath, pages, structuralIssues, entityTypesBlock, lintReport, userInstruction) {
  const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const pagesBlock = [...pages.entries()].map(([p, c]) => `--- ${p} ---
${c}`).join("\n\n");
  const fixInstruction = userInstruction ? `\u0412\u044B\u043F\u043E\u043B\u043D\u0438 \u0437\u0430\u0434\u0430\u0447\u0443 \u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044F. \u0412\u0435\u0440\u043D\u0438 \u0442\u043E\u043B\u044C\u043A\u043E \u0438\u0437\u043C\u0435\u043D\u0451\u043D\u043D\u044B\u0435 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u044B.` : `\u0418\u0441\u043F\u0440\u0430\u0432\u044C \u043F\u0440\u043E\u0431\u043B\u0435\u043C\u044B \u0432 wiki-\u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0430\u0445 \u0438 \u0432\u0435\u0440\u043D\u0438 \u0442\u043E\u043B\u044C\u043A\u043E \u0438\u0437\u043C\u0435\u043D\u0451\u043D\u043D\u044B\u0435 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u044B.`;
  const systemContent = render(fix_default, {
    domain_name: domain.name,
    fix_instruction: fixInstruction,
    entity_types_block: entityTypesBlock ? `\u0422\u0418\u041F\u042B \u0421\u0423\u0429\u041D\u041E\u0421\u0422\u0415\u0419:
${entityTypesBlock}
` : "",
    wiki_path: wikiVaultPath,
    today
  });
  return [
    { role: "system", content: systemContent },
    {
      role: "user",
      content: [
        userInstruction ? `\u0417\u0410\u0414\u0410\u0427\u0410:
${userInstruction}` : "",
        lintReport ? `
\u041E\u0422\u0427\u0401\u0422 LINT:
${lintReport}` : "",
        structuralIssues ? `
\u0421\u0422\u0420\u0423\u041A\u0422\u0423\u0420\u041D\u042B\u0415 \u041F\u0420\u041E\u0411\u041B\u0415\u041C\u042B:
${structuralIssues}` : "",
        `
WIKI-\u0421\u0422\u0420\u0410\u041D\u0418\u0426\u042B \u0434\u043E\u043C\u0435\u043D\u0430 ${domain.id}:
${pagesBlock}`
      ].filter(Boolean).join("\n")
    }
  ];
}

// prompts/chat.md
var chat_default = "{{operation_header}}\n\u041F\u043E\u043C\u043E\u0433\u0430\u0439 \u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044E \u0430\u043D\u0430\u043B\u0438\u0437\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u0438 \u043E\u0431\u0441\u0443\u0436\u0434\u0430\u0442\u044C \u0440\u0435\u0437\u0443\u043B\u044C\u0442\u0430\u0442\u044B \u043E\u043F\u0435\u0440\u0430\u0446\u0438\u0438.\n\u041E\u0442\u0432\u0435\u0447\u0430\u0439 \u043A\u043E\u043D\u043A\u0440\u0435\u0442\u043D\u043E, \u0441\u0441\u044B\u043B\u0430\u044F\u0441\u044C \u043D\u0430 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u044B \u0438 \u0441\u0443\u0449\u043D\u043E\u0441\u0442\u0438 \u0438\u0437 \u043A\u043E\u043D\u0442\u0435\u043A\u0441\u0442\u0430.\n\n\u0420\u0415\u0417\u0423\u041B\u042C\u0422\u0410\u0422 \u041E\u041F\u0415\u0420\u0410\u0426\u0418\u0418:\n{{context}}\n";

// src/phases/chat.ts
async function* runLintChat(llm, model, domain, signal, opts, context, history, operationHeader) {
  const start = Date.now();
  const systemContent = render(chat_default, {
    operation_header: operationHeader,
    context
  });
  const messages = [
    { role: "system", content: systemContent },
    ...history.map((m) => ({ role: m.role, content: m.content }))
  ];
  const params = buildChatParams(model, messages, opts);
  let fullText = "";
  try {
    const stream = await llm.chat.completions.create(
      { ...params, stream: true },
      { signal }
    );
    for await (const chunk of stream) {
      const { reasoning, content } = extractStreamDeltas(chunk);
      if (reasoning)
        yield { kind: "assistant_text", delta: reasoning, isReasoning: true };
      if (content) {
        fullText += content;
        yield { kind: "assistant_text", delta: content };
      }
    }
  } catch (e) {
    if (signal.aborted || e.name === "AbortError")
      return;
    const resp = await llm.chat.completions.create(
      { ...params, stream: false }
    );
    fullText = resp.choices[0]?.message?.content ?? "";
    if (fullText)
      yield { kind: "assistant_text", delta: fullText };
  }
  if (signal.aborted)
    return;
  yield { kind: "result", durationMs: Date.now() - start, text: fullText };
}

// templates/_wiki_schema.md
var wiki_schema_default = '# Wiki Schema\n\n## \u042F\u0437\u044B\u043A \u0438 \u0441\u0442\u0438\u043B\u044C\n- \u041E\u0441\u043D\u043E\u0432\u043D\u043E\u0439 \u044F\u0437\u044B\u043A: \u0440\u0443\u0441\u0441\u043A\u0438\u0439\n- \u0422\u0435\u0445\u043D\u0438\u0447\u0435\u0441\u043A\u0438\u0435 \u0442\u0435\u0440\u043C\u0438\u043D\u044B \u043D\u0435 \u043F\u0435\u0440\u0435\u0432\u043E\u0434\u0438\u0442\u044C: SQL, API, LLM, ETL, SCD, TTL, DDL, JSON, YAML\n- \u0418\u043C\u0435\u043D\u0430 \u0441\u0438\u0441\u0442\u0435\u043C \u2014 \u043E\u0440\u0438\u0433\u0438\u043D\u0430\u043B\u044C\u043D\u043E\u0435 \u043D\u0430\u043F\u0438\u0441\u0430\u043D\u0438\u0435 (RT.DataExporter, CRM B2C, \u0426\u0425\u0414)\n- \u0410\u0431\u0431\u0440\u0435\u0432\u0438\u0430\u0442\u0443\u0440\u044B \u0440\u0430\u0441\u0448\u0438\u0444\u0440\u043E\u0432\u044B\u0432\u0430\u0442\u044C \u043F\u0440\u0438 \u043F\u0435\u0440\u0432\u043E\u043C \u0438\u0441\u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u043D\u0438\u0438 \u043D\u0430 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0435\n- \u0421\u0442\u0438\u043B\u044C: \u043D\u0435\u0439\u0442\u0440\u0430\u043B\u044C\u043D\u044B\u0439, \u0438\u043D\u0444\u043E\u0440\u043C\u0430\u0442\u0438\u0432\u043D\u044B\u0439, \u0431\u0435\u0437 \u043E\u0446\u0435\u043D\u043E\u0447\u043D\u044B\u0445 \u0441\u0443\u0436\u0434\u0435\u043D\u0438\u0439\n- \u0417\u0430\u043F\u0440\u0435\u0449\u0435\u043D\u043E: "\u041E\u0447\u0435\u0432\u0438\u0434\u043D\u043E, \u0447\u0442\u043E...", "\u041B\u0443\u0447\u0448\u0438\u0439 \u0441\u043F\u043E\u0441\u043E\u0431...", \u043C\u0435\u0441\u0442\u043E\u0438\u043C\u0435\u043D\u0438\u044F "\u044F", "\u043C\u044B", "\u043D\u0430\u0448"\n\n## \u0418\u043C\u0435\u043D\u043E\u0432\u0430\u043D\u0438\u0435 \u0444\u0430\u0439\u043B\u043E\u0432 \u0438 \u043F\u0430\u043F\u043E\u043A\n- \u0424\u0430\u0439\u043B\u044B: kebab-case, \u043A\u0438\u0440\u0438\u043B\u043B\u0438\u0446\u0430 \u0434\u043E\u043F\u0443\u0441\u0442\u0438\u043C\u0430, \u0431\u0435\u0437 \u043F\u0440\u043E\u0431\u0435\u043B\u043E\u0432 \u0438 \u0441\u043F\u0435\u0446\u0441\u0438\u043C\u0432\u043E\u043B\u043E\u0432 \u043A\u0440\u043E\u043C\u0435 \u0434\u0435\u0444\u0438\u0441\u0430\n  - \u041F\u0440\u0438\u043C\u0435\u0440\u044B: `\u0432\u0435\u0440\u0441\u0438\u043E\u043D\u0438\u0440\u043E\u0432\u0430\u043D\u0438\u0435-scd.md`, `clickhouse-\u043E\u0431\u0437\u043E\u0440.md`\n- \u041F\u0430\u043F\u043A\u0438 \u0434\u043E\u043C\u0435\u043D\u043E\u0432: \u043D\u0438\u0436\u043D\u0438\u0439 \u0440\u0435\u0433\u0438\u0441\u0442\u0440, \u043B\u0430\u0442\u0438\u043D\u0438\u0446\u0430 (`\u0438\u0438/`, `\u0431\u0430\u0437\u044B-\u0434\u0430\u043D\u043D\u044B\u0445/`)\n- \u0417\u0430\u0433\u043E\u043B\u043E\u0432\u043E\u043A H1: \u0440\u0443\u0441\u0441\u043A\u043E\u0435 \u043D\u0430\u0437\u0432\u0430\u043D\u0438\u0435; \u0442\u0435\u0445\u0442\u0435\u0440\u043C\u0438\u043D \u0432 \u0441\u043A\u043E\u0431\u043A\u0430\u0445 \u043F\u0440\u0438 \u043D\u0435\u043E\u0431\u0445\u043E\u0434\u0438\u043C\u043E\u0441\u0442\u0438\n\n## \u0421\u0442\u0440\u0443\u043A\u0442\u0443\u0440\u0430 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u044B (\u043E\u0431\u044F\u0437\u0430\u0442\u0435\u043B\u044C\u043D\u044B\u0439 \u043F\u043E\u0440\u044F\u0434\u043E\u043A)\n1. Frontmatter (YAML)\n2. \u0417\u0430\u0433\u043E\u043B\u043E\u0432\u043E\u043A H1\n3. \u0412\u0432\u043E\u0434\u043D\u044B\u0439 \u0430\u0431\u0437\u0430\u0446 \u2014 1-3 \u043F\u0440\u0435\u0434\u043B\u043E\u0436\u0435\u043D\u0438\u044F \u0431\u0435\u0437 \u0437\u0430\u0433\u043E\u043B\u043E\u0432\u043A\u0430, \u0441\u0440\u0430\u0437\u0443 \u043F\u043E\u0441\u043B\u0435 H1\n4. `## \u041E\u0441\u043D\u043E\u0432\u043D\u044B\u0435 \u0445\u0430\u0440\u0430\u043A\u0442\u0435\u0440\u0438\u0441\u0442\u0438\u043A\u0438` \u2014 \u043A\u043B\u044E\u0447\u0435\u0432\u044B\u0435 \u0441\u0432\u043E\u0439\u0441\u0442\u0432\u0430 \u0438 \u043F\u0430\u0440\u0430\u043C\u0435\u0442\u0440\u044B\n\n## \u041E\u043F\u0446\u0438\u043E\u043D\u0430\u043B\u044C\u043D\u044B\u0435 \u0440\u0430\u0437\u0434\u0435\u043B\u044B\n- `## \u041F\u0440\u0438\u043C\u0435\u043D\u0435\u043D\u0438\u0435 \u0432 \u043A\u043E\u043D\u0442\u0435\u043A\u0441\u0442\u0435 [\u0414\u043E\u043C\u0435\u043D]`\n- `## \u041F\u0440\u0438\u043C\u0435\u0440\u044B`\n- `## \u041E\u0433\u0440\u0430\u043D\u0438\u0447\u0435\u043D\u0438\u044F`\n- `## Best Practices`\n- `## \u0421\u0432\u044F\u0437\u0430\u043D\u043D\u044B\u0435 \u043A\u043E\u043D\u0446\u0435\u043F\u0446\u0438\u0438` \u2014 \u0442\u043E\u043B\u044C\u043A\u043E \u0435\u0441\u043B\u0438 \u043D\u0443\u0436\u0435\u043D \u043F\u043E\u044F\u0441\u043D\u0438\u0442\u0435\u043B\u044C\u043D\u044B\u0439 \u043A\u043E\u043D\u0442\u0435\u043A\u0441\u0442 \u043A \u0441\u0432\u044F\u0437\u044F\u043C; \u0431\u0435\u0437 \u043E\u043F\u0438\u0441\u0430\u0442\u0435\u043B\u044C\u043D\u043E\u0433\u043E \u043A\u043E\u043D\u0442\u0435\u043A\u0441\u0442\u0430 \u0440\u0430\u0437\u0434\u0435\u043B \u043D\u0435 \u0441\u043E\u0437\u0434\u0430\u0432\u0430\u0442\u044C\n- `## \u0418\u0441\u0442\u043E\u0440\u0438\u044F \u0438\u0437\u043C\u0435\u043D\u0435\u043D\u0438\u0439`\n\n## Frontmatter\n\n| \u041F\u043E\u043B\u0435 | \u041F\u0440\u0430\u0432\u0438\u043B\u043E |\n|------|---------|\n| `wiki_sources` | \u041C\u0430\u0441\u0441\u0438\u0432 \u0440\u0435\u0430\u043B\u044C\u043D\u044B\u0445 \u043F\u0443\u0442\u0435\u0439 \u043E\u0442 \u043A\u043E\u0440\u043D\u044F \u0440\u0435\u043F\u043E\u0437\u0438\u0442\u043E\u0440\u0438\u044F. \u0422\u043E\u043B\u044C\u043A\u043E \u043F\u0440\u043E\u0447\u0438\u0442\u0430\u043D\u043D\u044B\u0435 \u0444\u0430\u0439\u043B\u044B. \u041F\u0440\u0438 UPDATE \u2014 \u0434\u043E\u0431\u0430\u0432\u043B\u044F\u0442\u044C, \u043D\u0435 \u0443\u0434\u0430\u043B\u044F\u0442\u044C. \u0422\u0438\u043F \u0441\u0432\u043E\u0439\u0441\u0442\u0432\u0430 \u0432 Obsidian: **Links** (\u043D\u0435 list/text) \u2014 \u0442\u043E\u043B\u044C\u043A\u043E \u0442\u043E\u0433\u0434\u0430 \u0441\u0441\u044B\u043B\u043A\u0438 \u0443\u0447\u0430\u0441\u0442\u0432\u0443\u044E\u0442 \u0432 Graph View. \u0417\u043D\u0430\u0447\u0435\u043D\u0438\u044F \u043E\u0431\u044F\u0437\u0430\u0442\u0435\u043B\u044C\u043D\u043E \u0432 \u0444\u043E\u0440\u043C\u0430\u0442\u0435 `[[page-name]]`: `["[[page-a]]", "[[page-b]]"] |\n| `wiki_updated` | YYYY-MM-DD |\n| `wiki_status` | `stub` (<2 \u0438\u0441\u0442\u043E\u0447\u043D\u0438\u043A\u043E\u0432, <10 \u043F\u0440\u0435\u0434\u043B\u043E\u0436\u0435\u043D\u0438\u0439) / `developing` (\u22652 \u0438\u0441\u0442\u043E\u0447\u043D\u0438\u043A\u0430, \u226510 \u043F\u0440\u0435\u0434\u043B\u043E\u0436\u0435\u043D\u0438\u0439, \u043E\u0441\u043D\u043E\u0432\u043D\u044B\u0435 \u0440\u0430\u0437\u0434\u0435\u043B\u044B \u0437\u0430\u043F\u043E\u043B\u043D\u0435\u043D\u044B) / `mature` (\u22654 \u0438\u0441\u0442\u043E\u0447\u043D\u0438\u043A\u0430, \u0432\u0441\u0435 \u0440\u0430\u0437\u0434\u0435\u043B\u044B) |\n| `wiki_type` | \u0422\u0438\u043F \u0444\u0430\u0439\u043B\u0430: `page \\| index \\| log \\| schema`. \u0422\u043E\u043B\u044C\u043A\u043E \u0434\u043B\u044F \u0441\u043B\u0443\u0436\u0435\u0431\u043D\u044B\u0445 \u0444\u0430\u0439\u043B\u043E\u0432 (`_index.md`, `_log.md`, `_wiki_schema.md`). \u041E\u0431\u044B\u0447\u043D\u044B\u0435 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u044B \u043D\u0435 \u0443\u043A\u0430\u0437\u044B\u0432\u0430\u044E\u0442 \u044D\u0442\u043E \u043F\u043E\u043B\u0435. |\n| `tags` | \u0418\u0435\u0440\u0430\u0440\u0445\u0438\u0447\u0435\u0441\u043A\u0438\u0435 \u0442\u0435\u0433\u0438 \u0438\u0437 tag-hierarchy.json |\n| `aliases` | \u0410\u0431\u0431\u0440\u0435\u0432\u0438\u0430\u0442\u0443\u0440\u044B, \u0430\u043D\u0433\u043B\u0438\u0439\u0441\u043A\u0438\u0435 \u0432\u0430\u0440\u0438\u0430\u043D\u0442\u044B, \u0441\u0438\u043D\u043E\u043D\u0438\u043C\u044B |\n| `wiki_outgoing_links` | \u041C\u0430\u0441\u0441\u0438\u0432 WikiLinks \u043D\u0430 \u0441\u0432\u044F\u0437\u0430\u043D\u043D\u044B\u0435 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u044B. \u0422\u0438\u043F \u0441\u0432\u043E\u0439\u0441\u0442\u0432\u0430 \u0432 Obsidian: **Links** (\u043D\u0435 list/text) \u2014 \u0442\u043E\u043B\u044C\u043A\u043E \u0442\u043E\u0433\u0434\u0430 \u0441\u0441\u044B\u043B\u043A\u0438 \u0443\u0447\u0430\u0441\u0442\u0432\u0443\u044E\u0442 \u0432 Graph View. \u0417\u043D\u0430\u0447\u0435\u043D\u0438\u044F \u043E\u0431\u044F\u0437\u0430\u0442\u0435\u043B\u044C\u043D\u043E \u0432 \u0444\u043E\u0440\u043C\u0430\u0442\u0435 `[[page-name]]`: `["[[page-a]]", "[[page-b]]"]`. \u041F\u0443\u0441\u0442\u043E\u0439 \u043C\u0430\u0441\u0441\u0438\u0432 \u0434\u043E\u043F\u0443\u0441\u0442\u0438\u043C. |\n| `wiki_external_links` | \u041C\u0430\u0441\u0441\u0438\u0432 \u0432\u043D\u0435\u0448\u043D\u0438\u0445 URL (`http://` \u0438\u043B\u0438 `https://`). \u041D\u0435 \u0444\u043E\u0440\u043C\u0438\u0440\u0443\u044E\u0442 \u0433\u0440\u0430\u0444 Obsidian \u2014 \u0442\u043E\u043B\u044C\u043A\u043E \u0441\u043F\u0440\u0430\u0432\u043E\u0447\u043D\u044B\u0435 \u0440\u0435\u0441\u0443\u0440\u0441\u044B \u0438 \u0434\u043E\u043A\u0443\u043C\u0435\u043D\u0442\u0430\u0446\u0438\u044F. |\n\n## WikiLinks\n- \u0421\u0441\u044B\u043B\u0430\u0442\u044C\u0441\u044F \u0442\u043E\u043B\u044C\u043A\u043E \u043D\u0430 \u0441\u0443\u0449\u0435\u0441\u0442\u0432\u0443\u044E\u0449\u0438\u0435 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u044B \u0447\u0435\u0440\u0435\u0437 `[[\u0438\u043C\u044F-\u0441\u0442\u0440\u0430\u043D\u0438\u0446\u044B]]`\n- \u0417\u0430\u043F\u0440\u0435\u0449\u0435\u043D\u043E: \u043C\u0451\u0440\u0442\u0432\u044B\u0435 \u0441\u0441\u044B\u043B\u043A\u0438, \u0441\u0441\u044B\u043B\u043A\u0438 \u043D\u0430 \u0444\u0430\u0439\u043B\u044B \u0432\u043D\u0435 `!Wiki/`\n\n## \u041A\u043E\u043D\u0442\u0435\u043D\u0442\n- \u0421\u0438\u043D\u0442\u0435\u0437, \u043D\u0435 \u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u043D\u0438\u0435 \u2014 \u043F\u0435\u0440\u0435\u0440\u0430\u0431\u043E\u0442\u0430\u0442\u044C \u0438\u043D\u0444\u043E\u0440\u043C\u0430\u0446\u0438\u044E \u0438\u0437 \u0438\u0441\u0442\u043E\u0447\u043D\u0438\u043A\u043E\u0432\n- \u0414\u043E\u0441\u043B\u043E\u0432\u043D\u044B\u0435 \u0446\u0438\u0442\u0430\u0442\u044B \u0442\u043E\u043B\u044C\u043A\u043E \u0432 code-\u0431\u043B\u043E\u043A\u0430\u0445 (SQL, \u043A\u043E\u043D\u0444\u0438\u0433\u0443\u0440\u0430\u0446\u0438\u0438)\n- \u041F\u0440\u0438 \u0434\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u0438\u0438 \u0438\u043D\u0444\u043E\u0440\u043C\u0430\u0446\u0438\u0438 \u0438\u0437 \u043D\u043E\u0432\u043E\u0433\u043E \u0438\u0441\u0442\u043E\u0447\u043D\u0438\u043A\u0430 \u2014 \u0443\u043A\u0430\u0437\u044B\u0432\u0430\u0442\u044C \u0434\u0430\u0442\u0443 \u0438 \u0438\u0441\u0442\u043E\u0447\u043D\u0438\u043A \u0432 `## \u0418\u0441\u0442\u043E\u0440\u0438\u044F \u0438\u0437\u043C\u0435\u043D\u0435\u043D\u0438\u0439`\n- \u0417\u0430\u043F\u0440\u0435\u0449\u0435\u043D\u043E: placeholder-\u0442\u0435\u043A\u0441\u0442 (TODO, "\u0441\u043C. \u0438\u0441\u0442\u043E\u0447\u043D\u0438\u043A"), \u043F\u0443\u0441\u0442\u044B\u0435 \u0440\u0430\u0437\u0434\u0435\u043B\u044B, \u0443\u0434\u0430\u043B\u0435\u043D\u0438\u0435 \u0441\u0443\u0449\u0435\u0441\u0442\u0432\u0443\u044E\u0449\u0435\u0439 \u0438\u043D\u0444\u043E\u0440\u043C\u0430\u0446\u0438\u0438\n- \u0422\u0430\u0431\u043B\u0438\u0446\u044B: markdown \u0441 \u0432\u044B\u0440\u0430\u0432\u043D\u0438\u0432\u0430\u043D\u0438\u0435\u043C (`| \u041F\u0430\u0440\u0430\u043C\u0435\u0442\u0440 | \u0417\u043D\u0430\u0447\u0435\u043D\u0438\u0435 |` + `|----------|----------|`)\n- \u041A\u043E\u0434\u043E\u0432\u044B\u0435 \u0431\u043B\u043E\u043A\u0438: \u0432\u0441\u0435\u0433\u0434\u0430 \u0443\u043A\u0430\u0437\u044B\u0432\u0430\u0442\u044C \u044F\u0437\u044B\u043A (` ```sql `, ` ```yaml `, ` ```json `)\n';

// prompts/init.md
var init_default = '\u0422\u044B \u2014 \u0430\u0440\u0445\u0438\u0442\u0435\u043A\u0442\u043E\u0440 wiki-\u0431\u0430\u0437\u044B \u0437\u043D\u0430\u043D\u0438\u0439. \u0421\u0433\u0435\u043D\u0435\u0440\u0438\u0440\u0443\u0439 \u0437\u0430\u043F\u0438\u0441\u044C \u0434\u043E\u043C\u0435\u043D\u0430 \u0434\u043B\u044F domain-map.json.\n\u0412\u0435\u0440\u043D\u0438 \u0422\u041E\u041B\u042C\u041A\u041E \u0432\u0430\u043B\u0438\u0434\u043D\u044B\u0439 JSON \u0441\u043B\u0435\u0434\u0443\u044E\u0449\u0435\u0439 \u0441\u0442\u0440\u0443\u043A\u0442\u0443\u0440\u044B:\n{\n  "id": "{{domain_id}}",\n  "name": "\u0427\u0435\u043B\u043E\u0432\u0435\u043A\u043E\u0447\u0438\u0442\u0430\u0435\u043C\u043E\u0435 \u043D\u0430\u0437\u0432\u0430\u043D\u0438\u0435",\n  "wiki_folder": "vaults/{{vault_name}}/!Wiki/{{domain_id}}",\n  "source_paths": [],\n  "entity_types": [{"type":"...","description":"...","extraction_cues":["..."],"min_mentions_for_page":1,"wiki_subfolder":"{{domain_id}}/..."}],\n  "language_notes": ""\n}\n{{schema_block}}\n{{index_block}}\n';

// src/phases/init.ts
async function* runInit(args, vaultTools, llm, model, domains, vaultName, signal, opts = {}, onFileError) {
  const domainId = args[0];
  const dryRun = args.includes("--dry-run");
  const sourcesIdx = args.indexOf("--sources");
  const sourcePaths = sourcesIdx >= 0 ? args.slice(sourcesIdx + 1) : [];
  if (!domainId) {
    yield { kind: "error", message: "init: domain id required" };
    return;
  }
  const existing = domains.find((d) => d.id === domainId);
  if (sourcePaths.length) {
    yield* runInitWithSources(
      domainId,
      sourcePaths,
      dryRun,
      vaultTools,
      llm,
      model,
      domains,
      vaultName,
      signal,
      opts,
      onFileError
    );
    return;
  }
  if (existing?.entity_types?.length) {
    yield { kind: "error", message: `Domain "${domainId}" already initialised. Use Lint to update entity_types.` };
    return;
  }
  yield { kind: "assistant_text", delta: `Bootstrapping domain "${domainId}"...
` };
  const wikiRootGuess = `!Wiki`;
  await ensureRootFiles(vaultTools, wikiRootGuess);
  const start = Date.now();
  const allFiles = await vaultTools.listFiles("");
  const sampleFiles = allFiles.slice(0, 5);
  const samples = await vaultTools.readAll(sampleFiles);
  const [schemaContent, indexContent] = await Promise.all([
    tryRead3(vaultTools, `${wikiRootGuess}/_wiki_schema.md`),
    tryRead3(vaultTools, `${wikiRootGuess}/_index.md`)
  ]);
  const systemContent = render(init_default, {
    domain_id: domainId,
    vault_name: vaultName,
    schema_block: schemaContent ? `
\u041A\u043E\u043D\u0432\u0435\u043D\u0446\u0438\u0438 \u0432\u0438\u043A\u0438 (_wiki_schema.md):
${schemaContent.slice(0, 1500)}` : "",
    index_block: indexContent ? `
\u0421\u0443\u0449\u0435\u0441\u0442\u0432\u0443\u044E\u0449\u0430\u044F \u0441\u0442\u0440\u0443\u043A\u0442\u0443\u0440\u0430 (_index.md):
${indexContent.slice(0, 1e3)}` : ""
  });
  const messages = [
    { role: "system", content: systemContent },
    {
      role: "user",
      content: [
        `Domain ID: ${domainId}`,
        `Vault name: ${vaultName}`,
        "",
        `\u041F\u0440\u0438\u043C\u0435\u0440\u044B \u0444\u0430\u0439\u043B\u043E\u0432 vault:`,
        [...samples.entries()].map(([p, c]) => `${p}:
${c.slice(0, 400)}`).join("\n\n")
      ].join("\n")
    }
  ];
  const params = buildChatParams(model, messages, opts);
  let fullText = "";
  try {
    const stream = await llm.chat.completions.create(
      { ...params, stream: true },
      { signal }
    );
    for await (const chunk of stream) {
      const { reasoning, content } = extractStreamDeltas(chunk);
      if (reasoning)
        yield { kind: "assistant_text", delta: reasoning, isReasoning: true };
      if (content) {
        fullText += content;
        yield { kind: "assistant_text", delta: content };
      }
    }
  } catch (e) {
    if (signal.aborted || e.name === "AbortError")
      return;
    const resp = await llm.chat.completions.create(
      { ...params, stream: false }
    );
    fullText = resp.choices[0]?.message?.content ?? "";
    if (fullText)
      yield { kind: "assistant_text", delta: fullText };
  }
  if (signal.aborted)
    return;
  let entry;
  try {
    const match = fullText.match(/\{[\s\S]*\}/);
    if (!match)
      throw new Error("No JSON object found in LLM response");
    entry = JSON.parse(match[0]);
    const vaultPrefix = `vaults/${vaultName}/`;
    if (entry.wiki_folder?.startsWith(vaultPrefix)) {
      entry.wiki_folder = entry.wiki_folder.slice(vaultPrefix.length);
    }
    if (entry.wiki_folder?.startsWith("!Wiki/")) {
      entry.wiki_folder = entry.wiki_folder.slice("!Wiki/".length);
    }
    if (!entry.id || !entry.wiki_folder)
      throw new Error("Missing required fields");
  } catch (e) {
    yield { kind: "error", message: `Failed to parse domain entry: ${e.message}` };
    return;
  }
  if (dryRun) {
    yield {
      kind: "result",
      durationMs: Date.now() - start,
      text: `Dry run \u2014 domain entry:
\`\`\`json
${JSON.stringify(entry, null, 2)}
\`\`\``
    };
    return;
  }
  yield { kind: "tool_use", name: existing ? "UpdateDomain" : "SaveDomain", input: { id: entry.id } };
  if (existing) {
    yield { kind: "domain_updated", domainId: entry.id, patch: { entity_types: entry.entity_types, language_notes: entry.language_notes } };
  } else {
    yield { kind: "domain_created", entry };
  }
  yield { kind: "tool_result", ok: true };
  await appendLog2(vaultTools, wikiRootGuess, domainId);
  yield {
    kind: "result",
    durationMs: Date.now() - start,
    text: `Domain "${domainId}" initialised. Edit entity_types in plugin settings to refine extraction.`
  };
}
async function* runInitWithSources(domainId, sourcePaths, dryRun, vaultTools, llm, model, domains, vaultName, signal, opts, onFileError) {
  const start = Date.now();
  const wikiRootGuess = `!Wiki`;
  await ensureRootFiles(vaultTools, wikiRootGuess);
  const allVaultFiles = await vaultTools.listFiles("");
  const sourceFiles = allVaultFiles.filter(
    (f) => f.endsWith(".md") && sourcePaths.some((sp) => f.startsWith(sp))
  );
  if (!sourceFiles.length) {
    yield { kind: "error", message: `No .md files found in source paths: ${sourcePaths.join(", ")}` };
    return;
  }
  yield { kind: "init_start", totalFiles: sourceFiles.length };
  yield { kind: "assistant_text", delta: `Analysing ${sourceFiles.length} source files for domain "${domainId}"...
` };
  const sampleFiles = sourceFiles.slice(0, 10);
  const samples = await vaultTools.readAll(sampleFiles);
  const [schemaContent, indexContent] = await Promise.all([
    tryRead3(vaultTools, `${wikiRootGuess}/_wiki_schema.md`),
    tryRead3(vaultTools, `${wikiRootGuess}/_index.md`)
  ]);
  const existing = domains.find((d) => d.id === domainId);
  const systemContent = render(init_default, {
    domain_id: domainId,
    vault_name: vaultName,
    schema_block: schemaContent ? `
\u041A\u043E\u043D\u0432\u0435\u043D\u0446\u0438\u0438 \u0432\u0438\u043A\u0438 (_wiki_schema.md):
${schemaContent.slice(0, 1500)}` : "",
    index_block: indexContent ? `
\u0421\u0443\u0449\u0435\u0441\u0442\u0432\u0443\u044E\u0449\u0430\u044F \u0441\u0442\u0440\u0443\u043A\u0442\u0443\u0440\u0430 (_index.md):
${indexContent.slice(0, 1e3)}` : ""
  });
  const messages = [
    { role: "system", content: systemContent },
    {
      role: "user",
      content: [
        `Domain ID: ${domainId}`,
        `Vault name: ${vaultName}`,
        `Source paths: ${sourcePaths.join(", ")}`,
        "",
        `\u041F\u0440\u0438\u043C\u0435\u0440\u044B \u0444\u0430\u0439\u043B\u043E\u0432 \u0438\u0441\u0442\u043E\u0447\u043D\u0438\u043A\u043E\u0432:`,
        [...samples.entries()].map(([p, c]) => `${p}:
${c.slice(0, 400)}`).join("\n\n")
      ].join("\n")
    }
  ];
  const params = buildChatParams(model, messages, opts);
  let fullText = "";
  try {
    const stream = await llm.chat.completions.create(
      { ...params, stream: true },
      { signal }
    );
    for await (const chunk of stream) {
      const { reasoning, content } = extractStreamDeltas(chunk);
      if (reasoning)
        yield { kind: "assistant_text", delta: reasoning, isReasoning: true };
      if (content) {
        fullText += content;
        yield { kind: "assistant_text", delta: content };
      }
    }
  } catch (e) {
    if (signal.aborted || e.name === "AbortError")
      return;
    const resp = await llm.chat.completions.create(
      { ...params, stream: false }
    );
    fullText = resp.choices[0]?.message?.content ?? "";
    if (fullText)
      yield { kind: "assistant_text", delta: fullText };
  }
  if (signal.aborted)
    return;
  let entry;
  try {
    const match = fullText.match(/\{[\s\S]*\}/);
    if (!match)
      throw new Error("No JSON object found in LLM response");
    entry = JSON.parse(match[0]);
    const vaultPrefix = `vaults/${vaultName}/`;
    if (entry.wiki_folder?.startsWith(vaultPrefix)) {
      entry.wiki_folder = entry.wiki_folder.slice(vaultPrefix.length);
    }
    if (entry.wiki_folder?.startsWith("!Wiki/")) {
      entry.wiki_folder = entry.wiki_folder.slice("!Wiki/".length);
    }
    if (!entry.id || !entry.wiki_folder)
      throw new Error("Missing required fields");
  } catch (e) {
    yield { kind: "error", message: `Failed to parse domain entry: ${e.message}` };
    return;
  }
  const updatedDomain = {
    ...existing ?? { id: domainId, name: domainId, wiki_folder: entry.wiki_folder },
    entity_types: entry.entity_types,
    language_notes: entry.language_notes,
    source_paths: sourcePaths
  };
  if (dryRun) {
    yield {
      kind: "result",
      durationMs: Date.now() - start,
      text: `Dry run \u2014 domain entry:
\`\`\`json
${JSON.stringify(entry, null, 2)}
\`\`\``
    };
    return;
  }
  yield { kind: "tool_use", name: existing ? "UpdateDomain" : "SaveDomain", input: { id: domainId } };
  if (existing) {
    yield { kind: "domain_updated", domainId, patch: { entity_types: entry.entity_types, language_notes: entry.language_notes } };
  } else {
    yield { kind: "domain_created", entry: { ...entry, source_paths: sourcePaths } };
  }
  yield { kind: "tool_result", ok: true };
  yield { kind: "assistant_text", delta: `
Creating wiki pages from ${sourceFiles.length} source files...
` };
  for (let i = 0; i < sourceFiles.length; i++) {
    if (signal.aborted)
      return;
    const file = sourceFiles[i];
    yield { kind: "file_start", file, index: i, total: sourceFiles.length };
    let retried = false;
    let done = false;
    while (!done) {
      let hadError = false;
      let caughtErr = null;
      try {
        for await (const ev of runIngest([file], vaultTools, llm, model, [updatedDomain], vaultTools.vaultRoot, signal, opts)) {
          yield ev;
        }
        done = true;
      } catch (e) {
        hadError = true;
        caughtErr = e;
      }
      if (hadError && caughtErr) {
        const canRetry = !retried;
        const choice = onFileError ? await onFileError(file, caughtErr, canRetry) : "skip";
        if (choice === "stop")
          return;
        if (choice === "retry" && canRetry) {
          retried = true;
          continue;
        }
        done = true;
      }
    }
    yield { kind: "file_done", file };
  }
  await appendLog2(vaultTools, wikiRootGuess, domainId);
  yield {
    kind: "result",
    durationMs: Date.now() - start,
    text: `Domain "${domainId}" initialised from ${sourceFiles.length} source files.`
  };
}
async function appendLog2(vaultTools, wikiRoot, domainId) {
  const logPath = `${wikiRoot}/_log.md`;
  const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const entry = `
## ${today} \u2014 init \u2014 ${domainId}
- \u0414\u043E\u043C\u0435\u043D \u0441\u043E\u0437\u0434\u0430\u043D
`;
  try {
    const existing = await tryRead3(vaultTools, logPath);
    await vaultTools.write(logPath, existing + entry);
  } catch {
  }
}
async function tryRead3(vaultTools, path2) {
  try {
    return await vaultTools.read(path2);
  } catch {
    return "";
  }
}
async function ensureRootFiles(vaultTools, wikiRoot) {
  const schema = `${wikiRoot}/_wiki_schema.md`;
  const index = `${wikiRoot}/_index.md`;
  const log = `${wikiRoot}/_log.md`;
  try {
    if (!await vaultTools.exists(schema))
      await vaultTools.write(schema, wiki_schema_default);
    if (!await vaultTools.exists(index))
      await vaultTools.write(index, "# Wiki Index\n");
    if (!await vaultTools.exists(log))
      await vaultTools.write(log, "# Wiki Log\n");
  } catch {
  }
}

// prompts/evaluator.md
var evaluator_default = '\u0422\u044B \u2014 \u043E\u0446\u0435\u043D\u0449\u0438\u043A \u043A\u0430\u0447\u0435\u0441\u0442\u0432\u0430 \u0440\u0430\u0431\u043E\u0442\u044B wiki-\u0430\u0433\u0435\u043D\u0442\u0430. \u041E\u0446\u0435\u043D\u0438 \u0440\u0435\u0437\u0443\u043B\u044C\u0442\u0430\u0442 \u043E\u043F\u0435\u0440\u0430\u0446\u0438\u0438.\n\n\u041E\u043F\u0435\u0440\u0430\u0446\u0438\u044F: {{operation}}\n\n\u0412\u0445\u043E\u0434\u043D\u043E\u0435 \u0437\u0430\u0434\u0430\u043D\u0438\u0435:\n{{task_input}}\n\n\u0420\u0435\u0437\u0443\u043B\u044C\u0442\u0430\u0442:\n{{result}}\n\n\u0412\u0435\u0440\u043D\u0438 JSON \u0441\u0442\u0440\u043E\u0433\u043E \u0432 \u0444\u043E\u0440\u043C\u0430\u0442\u0435:\n{"score": <0-10>, "reasoning": "<\u043E\u0434\u043D\u043E \u043F\u0440\u0435\u0434\u043B\u043E\u0436\u0435\u043D\u0438\u0435>"}\n\n\u041A\u0440\u0438\u0442\u0435\u0440\u0438\u0438 \u043E\u0446\u0435\u043D\u043A\u0438:\n- 9-10: \u0440\u0435\u0437\u0443\u043B\u044C\u0442\u0430\u0442 \u043F\u043E\u043B\u043D\u043E\u0441\u0442\u044C\u044E \u0441\u043E\u043E\u0442\u0432\u0435\u0442\u0441\u0442\u0432\u0443\u0435\u0442 \u0437\u0430\u0434\u0430\u043D\u0438\u044E, \u0431\u0435\u0437 \u043E\u0448\u0438\u0431\u043E\u043A\n- 7-8: \u0440\u0435\u0437\u0443\u043B\u044C\u0442\u0430\u0442 \u043A\u043E\u0440\u0440\u0435\u043A\u0442\u0435\u043D, \u0435\u0441\u0442\u044C \u043D\u0435\u0437\u043D\u0430\u0447\u0438\u0442\u0435\u043B\u044C\u043D\u044B\u0435 \u043D\u0435\u0434\u043E\u0447\u0451\u0442\u044B\n- 5-6: \u0437\u0430\u0434\u0430\u043D\u0438\u0435 \u0432\u044B\u043F\u043E\u043B\u043D\u0435\u043D\u043E \u0447\u0430\u0441\u0442\u0438\u0447\u043D\u043E\n- 0-4: \u0440\u0435\u0437\u0443\u043B\u044C\u0442\u0430\u0442 \u043D\u0435 \u0441\u043E\u043E\u0442\u0432\u0435\u0442\u0441\u0442\u0432\u0443\u0435\u0442 \u0437\u0430\u0434\u0430\u043D\u0438\u044E \u0438\u043B\u0438 \u0441\u043E\u0434\u0435\u0440\u0436\u0438\u0442 \u043E\u0448\u0438\u0431\u043A\u0438\n';

// src/phases/evaluator.ts
function parseEvalResponse(text) {
  const match = text.match(/\{[^{}]*"score"[^{}]*"reasoning"[^{}]*\}/s) ?? text.match(/\{[^{}]*"reasoning"[^{}]*"score"[^{}]*\}/s);
  if (!match)
    return null;
  try {
    const parsed = JSON.parse(match[0]);
    if (typeof parsed.score !== "number" || typeof parsed.reasoning !== "string")
      return null;
    return { score: Math.min(10, Math.max(0, parsed.score)), reasoning: parsed.reasoning };
  } catch {
    return null;
  }
}
async function* runEvaluator(llm, model, operation, taskInput, result, signal, opts = {}) {
  const userContent = render(evaluator_default, { operation, task_input: taskInput, result });
  const messages = [{ role: "user", content: userContent }];
  const params = buildChatParams(model, messages, opts);
  try {
    const nonStreamParams = { ...params, stream: false };
    const resp = await llm.chat.completions.create(nonStreamParams, { signal });
    const text = resp.choices[0]?.message?.content ?? "";
    const evalResult = parseEvalResponse(text);
    if (evalResult) {
      yield { kind: "eval_result", score: evalResult.score, reasoning: evalResult.reasoning };
    }
  } catch {
  }
}

// prompts/format.md
var format_default = '\u0422\u044B \u2014 \u0440\u0435\u0434\u0430\u043A\u0442\u043E\u0440 markdown-\u0441\u0442\u0440\u0430\u043D\u0438\u0446\u044B \u0432\u043D\u0435 wiki-\u0431\u0430\u0437\u044B \u0437\u043D\u0430\u043D\u0438\u0439.\n\n\u0422\u0432\u043E\u044F \u0437\u0430\u0434\u0430\u0447\u0430 \u2014 \u043F\u0440\u043E\u0430\u043D\u0430\u043B\u0438\u0437\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0443 \u0438 \u043F\u0440\u0435\u0434\u043B\u043E\u0436\u0438\u0442\u044C \u0444\u043E\u0440\u043C\u0430\u0442\u0438\u0440\u043E\u0432\u0430\u043D\u0438\u0435 \u043F\u043E \u043F\u0440\u0430\u0432\u0438\u043B\u0430\u043C \u043D\u0438\u0436\u0435.\n\n\u0416\u0401\u0421\u0422\u041A\u0418\u0415 \u041F\u0420\u0410\u0412\u0418\u041B\u0410:\n- \u041D\u0435 \u0434\u043E\u0431\u0430\u0432\u043B\u044F\u0439 \u0438 \u043D\u0435 \u0443\u0434\u0430\u043B\u044F\u0439 \u0444\u0430\u043A\u0442\u044B, \u0438\u043C\u0435\u043D\u0430, \u0447\u0438\u0441\u043B\u0430, URL.\n- \u041D\u0435 \u0438\u0441\u043A\u0430\u0436\u0430\u0439 \u0441\u043C\u044B\u0441\u043B. \u041F\u0435\u0440\u0435\u0444\u0440\u0430\u0437 \u0434\u043B\u044F \u044F\u0441\u043D\u043E\u0441\u0442\u0438 \u0440\u0430\u0437\u0440\u0435\u0448\u0451\u043D.\n- \u0412\u0441\u0435 \u0438\u0437\u043C\u0435\u043D\u0435\u043D\u0438\u044F \u043E\u043F\u0438\u0448\u0438 \u0432 \u043F\u043E\u043B\u0435 report.\n\n\u041F\u0420\u0410\u0412\u0418\u041B\u0410 \u0424\u041E\u0420\u041C\u0410\u0422\u0418\u0420\u041E\u0412\u0410\u041D\u0418\u042F:\n{{format_schema}}\n\nVISION: {{has_vision}}\n- \u041F\u0440\u0438 has_vision=true: \u0438\u0437\u0432\u043B\u0435\u043A\u0430\u0439 \u0441\u043E\u0434\u0435\u0440\u0436\u0438\u043C\u043E\u0435 \u0441\u0445\u0435\u043C \u0438 \u0438\u0437\u043E\u0431\u0440\u0430\u0436\u0435\u043D\u0438\u0439, \u0441\u043E\u0437\u0434\u0430\u0432\u0430\u0439 \u0442\u0430\u0431\u043B\u0438\u0446\u044B \u0438\u043B\u0438 mermaid-\u0431\u043B\u043E\u043A\u0438 \u043D\u0438\u0436\u0435 \u0438\u0437\u043E\u0431\u0440\u0430\u0436\u0435\u043D\u0438\u044F. \u0421\u0430\u043C\u043E \u0438\u0437\u043E\u0431\u0440\u0430\u0436\u0435\u043D\u0438\u0435 \u0441\u043E\u0445\u0440\u0430\u043D\u044F\u0439.\n- \u041F\u0440\u0438 has_vision=false: \u0440\u0430\u0431\u043E\u0442\u0430\u0439 \u0442\u043E\u043B\u044C\u043A\u043E \u0441 alt-\u0442\u0435\u043A\u0441\u0442\u043E\u043C \u0438 \u043F\u043E\u0434\u043F\u0438\u0441\u044F\u043C\u0438, \u043D\u043E\u0432\u043E\u0439 \u0438\u043D\u0444\u043E\u0440\u043C\u0430\u0446\u0438\u0438 \u043D\u0435 \u0441\u043E\u0447\u0438\u043D\u044F\u0439.\n\n\u0412\u0435\u0440\u043D\u0438 \u0422\u041E\u041B\u042C\u041A\u041E JSON-\u043E\u0431\u044A\u0435\u043A\u0442. \u041D\u0438\u043A\u0430\u043A\u0438\u0445 \u043F\u0440\u0435\u0430\u043C\u0431\u0443\u043B, \u043D\u0438\u043A\u0430\u043A\u043E\u0439 \u043E\u0431\u0451\u0440\u0442\u043A\u0438 ```json```, \u043D\u0438\u043A\u0430\u043A\u0438\u0445 \u043A\u043E\u043C\u043C\u0435\u043D\u0442\u0430\u0440\u0438\u0435\u0432. \u041F\u0435\u0440\u0432\u044B\u0439 \u0441\u0438\u043C\u0432\u043E\u043B \u043E\u0442\u0432\u0435\u0442\u0430 \u2014 `{`, \u043F\u043E\u0441\u043B\u0435\u0434\u043D\u0438\u0439 \u2014 `}`.\n\n\u042D\u043A\u0440\u0430\u043D\u0438\u0440\u043E\u0432\u0430\u043D\u0438\u0435 \u0432\u043D\u0443\u0442\u0440\u0438 \u0441\u0442\u0440\u043E\u043A JSON:\n- \u041A\u0430\u0436\u0434\u044B\u0439 \u043F\u0435\u0440\u0435\u0432\u043E\u0434 \u0441\u0442\u0440\u043E\u043A\u0438 \u0432\u043D\u0443\u0442\u0440\u0438 \u0437\u043D\u0430\u0447\u0435\u043D\u0438\u044F \u2014 `\\n` (\u0434\u0432\u0443\u0441\u0438\u043C\u0432\u043E\u043B\u044C\u043D\u0430\u044F \u043F\u043E\u0441\u043B\u0435\u0434\u043E\u0432\u0430\u0442\u0435\u043B\u044C\u043D\u043E\u0441\u0442\u044C).\n- \u041A\u0430\u0436\u0434\u0430\u044F \u0434\u0432\u043E\u0439\u043D\u0430\u044F \u043A\u0430\u0432\u044B\u0447\u043A\u0430 \u2014 `\\"`.\n- \u041A\u0430\u0436\u0434\u044B\u0439 \u043E\u0431\u0440\u0430\u0442\u043D\u044B\u0439 \u0441\u043B\u044D\u0448 \u2014 `\\\\`.\n- \u041D\u0438\u043A\u0430\u043A\u0438\u0445 \u0441\u044B\u0440\u044B\u0445 control-chars.\n\n\u0421\u0442\u0440\u0443\u043A\u0442\u0443\u0440\u0430:\n\n{\n  "report": "<markdown \u043E\u0442\u0447\u0451\u0442 \u043E\u0431 \u0438\u0437\u043C\u0435\u043D\u0435\u043D\u0438\u044F\u0445, \u043F\u0435\u0440\u0435\u0447\u0438\u0441\u043B\u0435\u043D\u0438\u0435 \u043F\u043E \u043F\u0443\u043D\u043A\u0442\u0430\u043C>",\n  "formatted": "<\u043F\u043E\u043B\u043D\u044B\u0439 markdown \u043E\u0442\u0444\u043E\u0440\u043C\u0430\u0442\u0438\u0440\u043E\u0432\u0430\u043D\u043D\u043E\u0439 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u044B, \u0432\u043A\u043B\u044E\u0447\u0430\u044F frontmatter>"\n}\n\n\u0411\u044E\u0434\u0436\u0435\u0442: \u043F\u043E\u043B\u0435 formatted \u043C\u043E\u0436\u0435\u0442 \u0431\u044B\u0442\u044C \u0434\u043B\u0438\u043D\u043D\u044B\u043C. \u0415\u0441\u043B\u0438 \u043F\u0440\u0438\u0431\u043B\u0438\u0436\u0430\u0435\u0448\u044C\u0441\u044F \u043A \u043B\u0438\u043C\u0438\u0442\u0443 \u2014 \u0441\u043E\u043A\u0440\u0430\u0449\u0430\u0439 report, \u043D\u0435 formatted. \u041D\u0438\u043A\u043E\u0433\u0434\u0430 \u043D\u0435 \u043E\u0431\u0440\u044B\u0432\u0430\u0439 \u043E\u0442\u0432\u0435\u0442 \u043D\u0430 \u043F\u043E\u043B\u0443\u0441\u043B\u043E\u0432\u0435 \u2014 \u043B\u0443\u0447\u0448\u0435 \u043A\u043E\u0440\u043E\u0447\u0435, \u043D\u043E \u0432\u0430\u043B\u0438\u0434\u043D\u043E.\n';

// templates/_format-schema.md
var format_schema_default = "# Format Schema (\u043F\u0440\u0430\u0432\u0438\u043B\u0430 \u0444\u043E\u0440\u043C\u0430\u0442\u0438\u0440\u043E\u0432\u0430\u043D\u0438\u044F \u043D\u0435-wiki \u0441\u0442\u0440\u0430\u043D\u0438\u0446)\n\n## Frontmatter\n\n| \u041F\u043E\u043B\u0435 | \u041F\u0440\u0430\u0432\u0438\u043B\u043E |\n|------|---------|\n| `tags` | \u0418\u0435\u0440\u0430\u0440\u0445\u0438\u0447\u0435\u0441\u043A\u0438\u0435, \u043F\u0440\u0438 \u043D\u0430\u043B\u0438\u0447\u0438\u0438 \u0442\u0435\u043C\u0430\u0442\u0438\u0447\u0435\u0441\u043A\u043E\u0439 \u043A\u043B\u0430\u0441\u0441\u0438\u0444\u0438\u043A\u0430\u0446\u0438\u0438 |\n| `aliases` | \u0410\u0431\u0431\u0440\u0435\u0432\u0438\u0430\u0442\u0443\u0440\u044B, \u0441\u0438\u043D\u043E\u043D\u0438\u043C\u044B, \u0430\u043D\u0433\u043B\u0438\u0439\u0441\u043A\u0438\u0435 \u0432\u0430\u0440\u0438\u0430\u043D\u0442\u044B |\n| `created` | YYYY-MM-DD \u043F\u0440\u0438 \u043D\u0430\u043B\u0438\u0447\u0438\u0438 \u0432 \u0438\u0441\u0442\u043E\u0447\u043D\u0438\u043A\u0435 \u0438\u043B\u0438 \u043F\u0440\u0438 \u043F\u0435\u0440\u0432\u043E\u043C \u0444\u043E\u0440\u043C\u0430\u0442\u0438\u0440\u043E\u0432\u0430\u043D\u0438\u0438 |\n| `updated` | YYYY-MM-DD \u0442\u0435\u043A\u0443\u0449\u0430\u044F \u0434\u0430\u0442\u0430 \u0444\u043E\u0440\u043C\u0430\u0442\u0438\u0440\u043E\u0432\u0430\u043D\u0438\u044F |\n| `external_links` | \u041C\u0430\u0441\u0441\u0438\u0432 URL \u2014 \u0442\u043E\u043B\u044C\u043A\u043E \u0435\u0441\u043B\u0438 \u0432 \u0442\u0435\u043B\u0435 \u0435\u0441\u0442\u044C `http(s)://` \u0441\u0441\u044B\u043B\u043A\u0438 |\n| `related` | \u041C\u0430\u0441\u0441\u0438\u0432 `[[wikilinks]]` \u2014 \u0442\u043E\u043B\u044C\u043A\u043E \u0435\u0441\u043B\u0438 \u0432 \u0442\u0435\u043B\u0435 \u0443\u0436\u0435 \u0432\u0441\u0442\u0440\u0435\u0447\u0430\u044E\u0442\u0441\u044F \u0441\u0441\u044B\u043B\u043A\u0438 \u043D\u0430 \u0434\u0440\u0443\u0433\u0438\u0435 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u044B |\n\n\u041F\u043E\u043B\u044F `wiki_*` \u0437\u0430\u043F\u0440\u0435\u0449\u0435\u043D\u044B.\n\n## \u0421\u0442\u0440\u0443\u043A\u0442\u0443\u0440\u0430\n\n- H1 \u2014 \u043D\u0430\u0437\u0432\u0430\u043D\u0438\u0435 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u044B\n- \u0412\u0432\u043E\u0434\u043D\u044B\u0439 \u0430\u0431\u0437\u0430\u0446 1-3 \u043F\u0440\u0435\u0434\u043B\u043E\u0436\u0435\u043D\u0438\u044F \u0441\u0440\u0430\u0437\u0443 \u043F\u043E\u0441\u043B\u0435 H1, \u0431\u0435\u0437 \u043F\u043E\u0434\u0437\u0430\u0433\u043E\u043B\u043E\u0432\u043A\u0430\n- `##` \u0440\u0430\u0437\u0434\u0435\u043B\u044B \u043F\u043E \u043B\u043E\u0433\u0438\u043A\u0435 \u043A\u043E\u043D\u0442\u0435\u043D\u0442\u0430; \u0438\u0435\u0440\u0430\u0440\u0445\u0438\u044F \u0431\u0435\u0437 \u0441\u043A\u0430\u0447\u043A\u043E\u0432 (H2 \u2192 H3 \u2192 H4)\n- \u0417\u0430\u043F\u0440\u0435\u0449\u0435\u043D\u044B \u043F\u0443\u0441\u0442\u044B\u0435 \u0440\u0430\u0437\u0434\u0435\u043B\u044B \u0438 placeholder-\u0442\u0435\u043A\u0441\u0442\n\n## \u0422\u0430\u0431\u043B\u0438\u0446\u044B\n\nMarkdown \u0441 \u0432\u044B\u0440\u0430\u0432\u043D\u0438\u0432\u0430\u043D\u0438\u0435\u043C. \u041F\u0440\u0438\u043C\u0435\u043D\u044F\u0442\u044C \u043F\u0440\u0438 \u0441\u0442\u0440\u0443\u043A\u0442\u0443\u0440\u043D\u044B\u0445 \u043F\u0435\u0440\u0435\u0447\u0438\u0441\u043B\u0435\u043D\u0438\u044F\u0445 \u043F\u0430\u0440\u0430\u043C\u0435\u0442\u0440\u043E\u0432/\u0441\u0440\u0430\u0432\u043D\u0435\u043D\u0438\u0439. \u041D\u0435 \u043F\u0440\u0435\u0432\u0440\u0430\u0449\u0430\u0442\u044C \u043F\u043E\u0432\u0435\u0441\u0442\u0432\u043E\u0432\u0430\u0442\u0435\u043B\u044C\u043D\u044B\u0439 \u0442\u0435\u043A\u0441\u0442 \u0432 \u0442\u0430\u0431\u043B\u0438\u0446\u044B.\n\n## Mermaid\n\n` ```mermaid ` \u0431\u043B\u043E\u043A\u0438 \u0434\u043B\u044F \u043F\u0440\u043E\u0446\u0435\u0441\u0441\u043E\u0432, \u043F\u043E\u0441\u043B\u0435\u0434\u043E\u0432\u0430\u0442\u0435\u043B\u044C\u043D\u043E\u0441\u0442\u0435\u0439, \u0441\u0432\u044F\u0437\u0435\u0439.\n- \u041E\u043F\u0438\u0441\u0430\u043D\u043D\u044B\u0435 \u0432 \u0442\u0435\u043A\u0441\u0442\u0435 \u043F\u0440\u043E\u0446\u0435\u0441\u0441\u044B \u2192 flowchart/sequenceDiagram\n- \u0421\u043E\u0434\u0435\u0440\u0436\u0438\u043C\u043E\u0435 \u0441\u0445\u0435\u043C \u0438\u0437 \u0438\u0437\u043E\u0431\u0440\u0430\u0436\u0435\u043D\u0438\u0439 (\u0442\u043E\u043B\u044C\u043A\u043E \u043F\u0440\u0438 vision-backend) \u2192 \u043E\u0442\u0434\u0435\u043B\u044C\u043D\u044B\u0439 mermaid-\u0431\u043B\u043E\u043A \u043D\u0438\u0436\u0435 \u0438\u0437\u043E\u0431\u0440\u0430\u0436\u0435\u043D\u0438\u044F. \u0421\u0430\u043C\u043E \u0438\u0437\u043E\u0431\u0440\u0430\u0436\u0435\u043D\u0438\u0435 \u0441\u043E\u0445\u0440\u0430\u043D\u044F\u0435\u0442\u0441\u044F.\n\n## \u0418\u0437\u043E\u0431\u0440\u0430\u0436\u0435\u043D\u0438\u044F\n\n- \u041A\u0430\u0436\u0434\u043E\u0439 \u043A\u0430\u0440\u0442\u0438\u043D\u043A\u0435 \u2014 \u043E\u043F\u0438\u0441\u0430\u0442\u0435\u043B\u044C\u043D\u0430\u044F \u043F\u043E\u0434\u043F\u0438\u0441\u044C \u043D\u0435\u043F\u043E\u0441\u0440\u0435\u0434\u0441\u0442\u0432\u0435\u043D\u043D\u043E \u043F\u043E\u0434 \u043D\u0435\u0439\n- \u041F\u0440\u0438 `has_vision=true`: \u0434\u043E\u043F\u043E\u043B\u043D\u0438\u0442\u0435\u043B\u044C\u043D\u043E \u0442\u0435\u043A\u0441\u0442\u043E\u0432\u043E\u0435 \u043E\u043F\u0438\u0441\u0430\u043D\u0438\u0435 (\u0442\u0430\u0431\u043B\u0438\u0446\u0430 \u043F\u0430\u0440\u0430\u043C\u0435\u0442\u0440\u043E\u0432, mermaid, \u0438\u043B\u0438 \u0441\u0432\u044F\u0437\u043D\u044B\u0439 \u0442\u0435\u043A\u0441\u0442)\n- \u041F\u0440\u0438 `has_vision=false`: \u0438\u0441\u043F\u043E\u043B\u044C\u0437\u0443\u0435\u043C \u0442\u043E\u043B\u044C\u043A\u043E alt \u0438 \u0441\u0443\u0449\u0435\u0441\u0442\u0432\u0443\u044E\u0449\u0438\u0435 \u043F\u043E\u0434\u043F\u0438\u0441\u0438; \u043D\u043E\u0432\u043E\u0439 \u0438\u043D\u0444\u043E\u0440\u043C\u0430\u0446\u0438\u0438 \u043D\u0435 \u0441\u043E\u0447\u0438\u043D\u044F\u0435\u043C\n\n## \u041A\u043E\u0434\n\nFenced blocks \u0432\u0441\u0435\u0433\u0434\u0430 \u0441 \u0443\u043A\u0430\u0437\u0430\u043D\u0438\u0435\u043C \u044F\u0437\u044B\u043A\u0430.\n\n## \u0421\u0442\u0438\u043B\u044C\n\n- \u041D\u0435\u0439\u0442\u0440\u0430\u043B\u044C\u043D\u044B\u0439, \u0438\u043D\u0444\u043E\u0440\u043C\u0430\u0442\u0438\u0432\u043D\u044B\u0439, \u0431\u0435\u0437 \u043E\u0446\u0435\u043D\u043E\u0447\u043D\u044B\u0445 \u0441\u0443\u0436\u0434\u0435\u043D\u0438\u0439\n- \u0422\u0435\u0445\u043D\u0438\u0447\u0435\u0441\u043A\u0438\u0435 \u0442\u0435\u0440\u043C\u0438\u043D\u044B \u2014 \u043E\u0440\u0438\u0433\u0438\u043D\u0430\u043B\u044C\u043D\u043E\u0435 \u043D\u0430\u043F\u0438\u0441\u0430\u043D\u0438\u0435 (SQL, API, LLM)\n- \u0417\u0430\u043F\u0440\u0435\u0449\u0435\u043D\u043E: \xAB\u043E\u0447\u0435\u0432\u0438\u0434\u043D\u043E\xBB, \xAB\u043B\u0443\u0447\u0448\u0438\u0439 \u0441\u043F\u043E\u0441\u043E\u0431\xBB, \u043C\u0435\u0441\u0442\u043E\u0438\u043C\u0435\u043D\u0438\u044F \xAB\u044F/\u043C\u044B/\u043D\u0430\u0448\xBB\n\n## \u0416\u0451\u0441\u0442\u043A\u0438\u0435 \u0437\u0430\u043F\u0440\u0435\u0442\u044B\n\n- \u041D\u0435 \u0434\u043E\u0431\u0430\u0432\u043B\u044F\u0442\u044C \u0444\u0430\u043A\u0442\u044B, \u043E\u0442\u0441\u0443\u0442\u0441\u0442\u0432\u0443\u044E\u0449\u0438\u0435 \u0432 \u0438\u0441\u0445\u043E\u0434\u043D\u0438\u043A\u0435 (\u0438\u0441\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u0435: \u0442\u0435\u043A\u0441\u0442\u043E\u0432\u043E\u0435 \u0438\u0437\u0432\u043B\u0435\u0447\u0435\u043D\u0438\u0435 \u0438\u0437 \u0438\u0437\u043E\u0431\u0440\u0430\u0436\u0435\u043D\u0438\u0439 \u043F\u0440\u0438 `has_vision=true`)\n- \u041D\u0435 \u0443\u0434\u0430\u043B\u044F\u0442\u044C \u0444\u0430\u043A\u0442\u044B\n- \u041D\u0435 \u0438\u0441\u043A\u0430\u0436\u0430\u0442\u044C \u0441\u043C\u044B\u0441\u043B; \u043F\u0435\u0440\u0435\u0444\u0440\u0430\u0437 \u0434\u043B\u044F \u044F\u0441\u043D\u043E\u0441\u0442\u0438 \u0440\u0430\u0437\u0440\u0435\u0448\u0451\u043D\n- \u0412\u0441\u0435 \u0438\u0437\u043C\u0435\u043D\u0435\u043D\u0438\u044F \u043F\u0435\u0440\u0435\u0447\u0438\u0441\u043B\u044F\u0442\u044C \u0432 `report`\n";

// src/phases/format-utils.ts
function extractJsonObject(text) {
  const cleaned = stripCodeFence(text);
  const start = cleaned.indexOf("{");
  if (start < 0)
    return null;
  let depth = 0;
  let inString = false;
  let escape2 = false;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (escape2) {
      escape2 = false;
      continue;
    }
    if (ch === "\\" && inString) {
      escape2 = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString)
      continue;
    if (ch === "{")
      depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        const slice = cleaned.slice(start, i + 1);
        const parsed = tryParseJson(slice);
        if (!parsed)
          return null;
        if (typeof parsed.report !== "string" || typeof parsed.formatted !== "string")
          return null;
        return { report: parsed.report, formatted: parsed.formatted };
      }
    }
  }
  return null;
}
function stripCodeFence(text) {
  const fence = text.match(/```(?:json|JSON)?\s*([\s\S]*?)```/);
  if (fence)
    return fence[1];
  return text;
}
function tryParseJson(slice) {
  try {
    return JSON.parse(slice);
  } catch {
    try {
      return JSON.parse(repairJson(slice));
    } catch {
      return null;
    }
  }
}
function repairJson(s) {
  const noTrailing = s.replace(/,(\s*[}\]])/g, "$1");
  return escapeRawControlsInStrings(noTrailing);
}
function escapeRawControlsInStrings(src) {
  let out = "";
  let inString = false;
  let escape2 = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    const code = ch.charCodeAt(0);
    if (escape2) {
      out += ch;
      escape2 = false;
      continue;
    }
    if (inString && ch === "\\") {
      out += ch;
      escape2 = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      out += ch;
      continue;
    }
    if (inString && code < 32) {
      if (ch === "\n")
        out += "\\n";
      else if (ch === "\r")
        out += "\\r";
      else if (ch === "	")
        out += "\\t";
      else
        out += `\\u${code.toString(16).padStart(4, "0")}`;
      continue;
    }
    out += ch;
  }
  return out;
}
var STOP_WORDS = /* @__PURE__ */ new Set([
  "The",
  "This",
  "That",
  "These",
  "Those",
  "And",
  "Or",
  "But",
  "If",
  "When"
]);
function significantTokens(text) {
  const out = /* @__PURE__ */ new Set();
  let residual = text;
  for (const m of text.matchAll(/https?:\/\/\S+/g)) {
    out.add(m[0].replace(/[.,;:!?)\]}>"']+$/, ""));
  }
  residual = residual.replace(/https?:\/\/\S+/g, " ");
  for (const m of residual.matchAll(/\d+(?:\.\d+)?/g))
    out.add(m[0]);
  for (const m of residual.matchAll(/[A-Z][A-Za-z0-9-]{2,}/g)) {
    if (!STOP_WORDS.has(m[0]))
      out.add(m[0]);
  }
  for (const m of residual.matchAll(/\b[A-Z]{2,}\b/g))
    out.add(m[0]);
  for (const m of residual.matchAll(/`([^`\n]+)`/g)) {
    for (const id of m[1].matchAll(/[A-Za-z_][A-Za-z0-9_]{2,}/g))
      out.add(id[0]);
  }
  for (const m of residual.matchAll(/```[\s\S]*?```/g)) {
    for (const id of m[0].matchAll(/[A-Za-z_][A-Za-z0-9_]{2,}/g))
      out.add(id[0]);
  }
  return out;
}
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function missingTokens(original, formatted) {
  const orig = significantTokens(original);
  const fmtLower = formatted.toLowerCase();
  const missing = [];
  for (const t of orig) {
    const tl = t.toLowerCase();
    const re = new RegExp(`(?:^|[^A-Za-z0-9_])${escapeRegExp(tl)}(?:[^A-Za-z0-9_]|$)`);
    if (!re.test(fmtLower))
      missing.push(t);
  }
  return missing;
}

// src/phases/format.ts
var TEMP_FOLDER = "!Temp";
function extractImagePaths(md) {
  const out = [];
  for (const m of md.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) {
    const url = m[1].trim();
    if (!url.startsWith("http"))
      out.push(url);
  }
  return out;
}
async function* runFormat(args, vaultTools, llm, model, hasVision, chatHistory, signal, opts = {}) {
  const start = Date.now();
  const filePath = args[0];
  if (!filePath) {
    yield { kind: "error", message: "Format: file path is required" };
    return;
  }
  if (signal.aborted)
    return;
  const original = await vaultTools.read(filePath);
  if (!original) {
    yield { kind: "error", message: `Format: cannot read ${filePath}` };
    return;
  }
  const systemContent = render(format_default, {
    format_schema: format_schema_default,
    has_vision: String(hasVision)
  });
  const userInitial = `\u0418\u0441\u0445\u043E\u0434\u043D\u044B\u0439 \u0444\u0430\u0439\u043B: ${filePath}
---
${original}`;
  const imagePaths = hasVision ? extractImagePaths(original) : [];
  const userContent = imagePaths.length > 0 ? [
    { type: "text", text: userInitial },
    ...imagePaths.map((p) => ({
      type: "image_url",
      image_url: { url: p }
    }))
  ] : userInitial;
  const messages = [
    { role: "system", content: systemContent },
    { role: "user", content: userContent },
    ...chatHistory.map((m) => ({ role: m.role, content: m.content }))
  ];
  yield { kind: "assistant_text", delta: `\u0410\u043D\u0430\u043B\u0438\u0437 \u0444\u0430\u0439\u043B\u0430 ${filePath}...
` };
  const baseParams = { ...buildChatParams(model, messages, opts), response_format: { type: "json_object" } };
  let lastFinishReason = null;
  async function* callOnce(p) {
    let acc = "";
    lastFinishReason = null;
    try {
      const stream = await llm.chat.completions.create(
        { ...p, stream: true },
        { signal }
      );
      for await (const chunk of stream) {
        const { reasoning, content } = extractStreamDeltas(chunk);
        if (reasoning)
          yield { kind: "assistant_text", delta: reasoning, isReasoning: true };
        if (content) {
          acc += content;
          yield { kind: "assistant_text", delta: content };
        }
        const fr = chunk.choices[0]?.finish_reason;
        if (fr)
          lastFinishReason = fr;
      }
    } catch (e) {
      if (signal.aborted || e.name === "AbortError")
        return acc;
      const resp = await llm.chat.completions.create(
        { ...p, stream: false }
      );
      acc = resp.choices[0]?.message?.content ?? "";
      lastFinishReason = resp.choices[0]?.finish_reason ?? null;
    }
    return acc;
  }
  let fullText = yield* callOnce(baseParams);
  if (signal.aborted)
    return;
  let parsed = extractJsonObject(fullText);
  if (!parsed && lastFinishReason === "length") {
    yield { kind: "error", message: "Format: \u043E\u0442\u0432\u0435\u0442 \u043E\u0431\u0440\u0435\u0437\u0430\u043D \u043F\u043E \u043B\u0438\u043C\u0438\u0442\u0443 \u0442\u043E\u043A\u0435\u043D\u043E\u0432 \u2014 \u0443\u0432\u0435\u043B\u0438\u0447\u044C\u0442\u0435 maxTokens (Settings \u2192 per-operation \u2192 format) \u0438\u043B\u0438 \u0441\u043E\u043A\u0440\u0430\u0442\u0438\u0442\u0435 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0443" };
    yield { kind: "result", durationMs: Date.now() - start, text: fullText };
    return;
  }
  if (!parsed) {
    yield { kind: "assistant_text", delta: "\n[JSON \u043D\u0435\u0432\u0430\u043B\u0438\u0434\u0435\u043D \u2014 \u043F\u043E\u0432\u0442\u043E\u0440\u044F\u044E \u0437\u0430\u043F\u0440\u043E\u0441]\n" };
    const retryMessages = [
      ...messages,
      { role: "assistant", content: fullText },
      { role: "user", content: '\u0422\u0432\u043E\u0439 \u043F\u0440\u0435\u0434\u044B\u0434\u0443\u0449\u0438\u0439 \u043E\u0442\u0432\u0435\u0442 \u043D\u0435 \u044F\u0432\u043B\u044F\u0435\u0442\u0441\u044F \u0432\u0430\u043B\u0438\u0434\u043D\u044B\u043C JSON. \u0412\u0435\u0440\u043D\u0438 \u0422\u041E\u041B\u042C\u041A\u041E JSON-\u043E\u0431\u044A\u0435\u043A\u0442 {"report": "...", "formatted": "..."} \u0431\u0435\u0437 markdown-\u043E\u0431\u0451\u0440\u0442\u043A\u0438, \u0431\u0435\u0437 \u043F\u043E\u044F\u0441\u043D\u0435\u043D\u0438\u0439. \u0412\u0441\u0435 \u0441\u043F\u0435\u0446\u0441\u0438\u043C\u0432\u043E\u043B\u044B \u0432\u043D\u0443\u0442\u0440\u0438 \u0441\u0442\u0440\u043E\u043A \u0434\u043E\u043B\u0436\u043D\u044B \u0431\u044B\u0442\u044C \u044D\u043A\u0440\u0430\u043D\u0438\u0440\u043E\u0432\u0430\u043D\u044B (\\n, \\", \\\\).' }
    ];
    const retryParams = { ...buildChatParams(model, retryMessages, opts), response_format: { type: "json_object" } };
    fullText = yield* callOnce(retryParams);
    if (signal.aborted)
      return;
    parsed = extractJsonObject(fullText);
  }
  if (!parsed) {
    yield { kind: "error", message: "Format: LLM \u0432\u0435\u0440\u043D\u0443\u043B \u043D\u0435\u0432\u0430\u043B\u0438\u0434\u043D\u044B\u0439 JSON (\u043F\u043E\u0441\u043B\u0435 retry)" };
    yield { kind: "result", durationMs: Date.now() - start, text: fullText };
    return;
  }
  const baseName = filePath.split("/").pop()?.replace(/\.md$/, "") ?? "page";
  const tempPath = `${TEMP_FOLDER}/${baseName}.formatted.md`;
  try {
    if (!await vaultTools.exists(TEMP_FOLDER)) {
      await vaultTools.mkdir(TEMP_FOLDER);
    }
    await vaultTools.write(tempPath, parsed.formatted);
  } catch (e) {
    yield { kind: "error", message: `Format: \u0437\u0430\u043F\u0438\u0441\u044C temp \u043D\u0435 \u0443\u0434\u0430\u043B\u0430\u0441\u044C \u2014 ${e.message}` };
    return;
  }
  const missing = missingTokens(original, parsed.formatted);
  yield { kind: "format_preview", tempPath, report: parsed.report, missingTokens: missing };
  yield { kind: "result", durationMs: Date.now() - start, text: parsed.report };
}

// src/agent-runner.ts
var AgentRunner = class {
  constructor(llm, settings, vaultTools, vaultName, domains) {
    this.llm = llm;
    this.settings = settings;
    this.vaultTools = vaultTools;
    this.vaultName = vaultName;
    this.domains = domains;
  }
  buildOptsFor(op) {
    const key = op === "query-save" ? "query" : op === "fix" || op === "chat" ? "lint" : op;
    const s = this.settings;
    if (s.backend === "claude-agent") {
      const c2 = s.claudeAgent.perOperation ? s.claudeAgent.operations[key] : void 0;
      if (c2)
        return { model: c2.model, opts: { maxTokens: c2.maxTokens, systemPrompt: s.systemPrompt } };
      return { model: s.claudeAgent.model, opts: { maxTokens: s.maxTokens, systemPrompt: s.systemPrompt } };
    }
    const na = s.nativeAgent;
    const c = na.perOperation ? na.operations[key] : void 0;
    if (c)
      return { model: c.model, opts: { maxTokens: c.maxTokens, temperature: c.temperature, topP: na.topP, numCtx: na.numCtx, systemPrompt: s.systemPrompt } };
    return { model: na.model, opts: { maxTokens: s.maxTokens, temperature: na.temperature, topP: na.topP, numCtx: na.numCtx, systemPrompt: s.systemPrompt } };
  }
  async writeDevLog(_vaultRoot, entry) {
    if (!this.settings.devMode?.enabled)
      return;
    const adapter = this.vaultTools.adapter;
    const dir = "!Logs";
    const path2 = `${dir}/dev.jsonl`;
    try {
      if (!await adapter.exists(dir))
        await adapter.mkdir(dir);
      const line = JSON.stringify({ ts: (/* @__PURE__ */ new Date()).toISOString(), ...entry, eval: null }) + "\n";
      if (await adapter.exists(path2))
        await adapter.append(path2, line);
      else
        await adapter.write(path2, line);
    } catch {
    }
  }
  async *runOperation(req, model, opts, vaultRoot, domains) {
    switch (req.operation) {
      case "ingest":
        yield* runIngest(req.args, this.vaultTools, this.llm, model, domains, vaultRoot, req.signal, opts);
        break;
      case "query":
        yield* runQuery(req.args, false, this.vaultTools, this.llm, model, domains, vaultRoot, req.signal, opts);
        break;
      case "query-save":
        yield* runQuery(req.args, true, this.vaultTools, this.llm, model, domains, vaultRoot, req.signal, opts);
        break;
      case "lint":
        yield* runLint(req.args, this.vaultTools, this.llm, model, domains, vaultRoot, req.signal, opts);
        break;
      case "fix":
        yield* runFix(req.args, this.vaultTools, this.llm, model, domains, vaultRoot, req.signal, opts, req.context, req.instruction);
        break;
      case "chat": {
        const domain = req.domainId ? this.domains.find((d) => d.id === req.domainId) : void 0;
        yield* runLintChat(
          this.llm,
          model,
          domain,
          req.signal,
          opts,
          req.context ?? "",
          req.chatMessages ?? [],
          req.operationHeader ?? ""
        );
        break;
      }
      case "init":
        yield* runInit(req.args, this.vaultTools, this.llm, model, domains, this.vaultName, req.signal, opts, req.onFileError);
        break;
      case "format": {
        const hasVision = this.settings.backend === "claude-agent";
        yield* runFormat(req.args, this.vaultTools, this.llm, model, hasVision, req.chatMessages ?? [], req.signal, opts);
        break;
      }
      default: {
        const start = Date.now();
        yield { kind: "error", message: `Unknown operation: ${req.operation}` };
        yield { kind: "result", durationMs: Date.now() - start, text: "" };
      }
    }
  }
  async *run(req) {
    const { model, opts } = this.buildOptsFor(req.operation);
    yield { kind: "system", message: `${this.settings.backend} / ${model || "claude"}` };
    if (req.signal.aborted)
      return;
    const vaultRoot = req.cwd ?? "";
    const domains = req.domainId ? this.domains.filter((d) => d.id === req.domainId) : this.domains;
    const startMs = Date.now();
    let finalResultText = "";
    for await (const ev of this.runOperation(req, model, opts, vaultRoot, domains)) {
      if (ev.kind === "result")
        finalResultText = ev.text;
      yield ev;
    }
    if (this.settings.devMode?.enabled && finalResultText) {
      const taskInput = req.args.join(" ") || req.operation;
      await this.writeDevLog(vaultRoot, {
        operation: req.operation,
        model,
        systemPrompt: opts.systemPrompt ?? "",
        userMessage: taskInput,
        result: finalResultText,
        durationMs: Date.now() - startMs
      });
      if (this.settings.devMode.evaluatorModel) {
        const evalModel = this.settings.devMode.evaluatorModel;
        for await (const ev of runEvaluator(this.llm, evalModel, req.operation, taskInput, finalResultText, req.signal)) {
          yield ev;
          if (ev.kind === "eval_result") {
            await this.updateDevLogEval(vaultRoot, ev.score, ev.reasoning);
          }
        }
      }
    }
  }
  async updateDevLogEval(_vaultRoot, score, reasoning) {
    if (!this.settings.devMode?.enabled)
      return;
    const adapter = this.vaultTools.adapter;
    const path2 = "!Logs/dev.jsonl";
    try {
      if (!await adapter.exists(path2))
        return;
      const content = await adapter.read(path2);
      const lines = content.trimEnd().split("\n");
      const lastIdx = lines.length - 1;
      const last = JSON.parse(lines[lastIdx]);
      last.eval = { score, reasoning };
      lines[lastIdx] = JSON.stringify(last);
      await adapter.write(path2, lines.join("\n") + "\n");
    } catch {
    }
  }
};

// src/vault-tools.ts
var VaultTools = class {
  constructor(adapter, basePath) {
    this.adapter = adapter;
    this.basePath = basePath;
  }
  get vaultRoot() {
    return this.basePath;
  }
  async read(vaultPath) {
    return this.adapter.read(vaultPath);
  }
  async write(vaultPath, content) {
    const dir = vaultPath.split("/").slice(0, -1).join("/");
    if (dir) {
      const dirExists = await this.adapter.exists(dir);
      if (!dirExists)
        await this.adapter.mkdir(dir);
    }
    await this.adapter.write(vaultPath, content);
  }
  async listFiles(vaultDir) {
    const exists = await this.adapter.exists(vaultDir);
    if (!exists)
      return [];
    return this._listRecursive(vaultDir);
  }
  async _listRecursive(vaultDir) {
    const result = await this.adapter.list(vaultDir);
    const deeper = await Promise.all(result.folders.map((f) => this._listRecursive(f)));
    return [...result.files, ...deeper.flat()];
  }
  async readAll(paths) {
    const entries = await Promise.all(
      paths.map(async (p) => {
        try {
          return [p, await this.read(p)];
        } catch {
          return null;
        }
      })
    );
    return new Map(entries.filter((e) => e !== null));
  }
  async exists(vaultPath) {
    return this.adapter.exists(vaultPath);
  }
  async mkdir(vaultPath) {
    return this.adapter.mkdir(vaultPath);
  }
  toVaultPath(absolutePath) {
    const base = this.basePath.endsWith("/") ? this.basePath : this.basePath + "/";
    if (!absolutePath.startsWith(base))
      return null;
    return absolutePath.slice(base.length);
  }
};

// node_modules/openai/internal/tslib.mjs
function __classPrivateFieldSet(receiver, state, value, kind, f) {
  if (kind === "m")
    throw new TypeError("Private method is not writable");
  if (kind === "a" && !f)
    throw new TypeError("Private accessor was defined without a setter");
  if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver))
    throw new TypeError("Cannot write private member to an object whose class did not declare it");
  return kind === "a" ? f.call(receiver, value) : f ? f.value = value : state.set(receiver, value), value;
}
function __classPrivateFieldGet(receiver, state, kind, f) {
  if (kind === "a" && !f)
    throw new TypeError("Private accessor was defined without a getter");
  if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver))
    throw new TypeError("Cannot read private member from an object whose class did not declare it");
  return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
}

// node_modules/openai/internal/utils/uuid.mjs
var uuid4 = function() {
  const { crypto: crypto2 } = globalThis;
  if (crypto2?.randomUUID) {
    uuid4 = crypto2.randomUUID.bind(crypto2);
    return crypto2.randomUUID();
  }
  const u8 = new Uint8Array(1);
  const randomByte = crypto2 ? () => crypto2.getRandomValues(u8)[0] : () => Math.random() * 255 & 255;
  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (+c ^ randomByte() & 15 >> +c / 4).toString(16));
};

// node_modules/openai/internal/errors.mjs
function isAbortError(err) {
  return typeof err === "object" && err !== null && // Spec-compliant fetch implementations
  ("name" in err && err.name === "AbortError" || // Expo fetch
  "message" in err && String(err.message).includes("FetchRequestCanceledException"));
}
var castToError = (err) => {
  if (err instanceof Error)
    return err;
  if (typeof err === "object" && err !== null) {
    try {
      if (Object.prototype.toString.call(err) === "[object Error]") {
        const error = new Error(err.message, err.cause ? { cause: err.cause } : {});
        if (err.stack)
          error.stack = err.stack;
        if (err.cause && !error.cause)
          error.cause = err.cause;
        if (err.name)
          error.name = err.name;
        return error;
      }
    } catch {
    }
    try {
      return new Error(JSON.stringify(err));
    } catch {
    }
  }
  return new Error(err);
};

// node_modules/openai/core/error.mjs
var OpenAIError = class extends Error {
};
var APIError = class _APIError extends OpenAIError {
  constructor(status, error, message, headers) {
    super(`${_APIError.makeMessage(status, error, message)}`);
    this.status = status;
    this.headers = headers;
    this.requestID = headers?.get("x-request-id");
    this.error = error;
    const data = error;
    this.code = data?.["code"];
    this.param = data?.["param"];
    this.type = data?.["type"];
  }
  static makeMessage(status, error, message) {
    const msg = error?.message ? typeof error.message === "string" ? error.message : JSON.stringify(error.message) : error ? JSON.stringify(error) : message;
    if (status && msg) {
      return `${status} ${msg}`;
    }
    if (status) {
      return `${status} status code (no body)`;
    }
    if (msg) {
      return msg;
    }
    return "(no status code or body)";
  }
  static generate(status, errorResponse, message, headers) {
    if (!status || !headers) {
      return new APIConnectionError({ message, cause: castToError(errorResponse) });
    }
    const error = errorResponse?.["error"];
    if (status === 400) {
      return new BadRequestError(status, error, message, headers);
    }
    if (status === 401) {
      return new AuthenticationError(status, error, message, headers);
    }
    if (status === 403) {
      return new PermissionDeniedError(status, error, message, headers);
    }
    if (status === 404) {
      return new NotFoundError(status, error, message, headers);
    }
    if (status === 409) {
      return new ConflictError(status, error, message, headers);
    }
    if (status === 422) {
      return new UnprocessableEntityError(status, error, message, headers);
    }
    if (status === 429) {
      return new RateLimitError(status, error, message, headers);
    }
    if (status >= 500) {
      return new InternalServerError(status, error, message, headers);
    }
    return new _APIError(status, error, message, headers);
  }
};
var APIUserAbortError = class extends APIError {
  constructor({ message } = {}) {
    super(void 0, void 0, message || "Request was aborted.", void 0);
  }
};
var APIConnectionError = class extends APIError {
  constructor({ message, cause }) {
    super(void 0, void 0, message || "Connection error.", void 0);
    if (cause)
      this.cause = cause;
  }
};
var APIConnectionTimeoutError = class extends APIConnectionError {
  constructor({ message } = {}) {
    super({ message: message ?? "Request timed out." });
  }
};
var BadRequestError = class extends APIError {
};
var AuthenticationError = class extends APIError {
};
var PermissionDeniedError = class extends APIError {
};
var NotFoundError = class extends APIError {
};
var ConflictError = class extends APIError {
};
var UnprocessableEntityError = class extends APIError {
};
var RateLimitError = class extends APIError {
};
var InternalServerError = class extends APIError {
};
var LengthFinishReasonError = class extends OpenAIError {
  constructor() {
    super(`Could not parse response content as the length limit was reached`);
  }
};
var ContentFilterFinishReasonError = class extends OpenAIError {
  constructor() {
    super(`Could not parse response content as the request was rejected by the content filter`);
  }
};
var InvalidWebhookSignatureError = class extends Error {
  constructor(message) {
    super(message);
  }
};
var OAuthError = class extends APIError {
  constructor(status, error, headers) {
    let finalMessage = "OAuth2 authentication error";
    let error_code = void 0;
    if (error && typeof error === "object") {
      const errorData = error;
      error_code = errorData["error"];
      const description = errorData["error_description"];
      if (description && typeof description === "string") {
        finalMessage = description;
      } else if (error_code) {
        finalMessage = error_code;
      }
    }
    super(status, error, finalMessage, headers);
    this.error_code = error_code;
  }
};
var SubjectTokenProviderError = class extends OpenAIError {
  constructor(message, provider, cause) {
    super(message);
    this.provider = provider;
    this.cause = cause;
  }
};

// node_modules/openai/internal/utils/values.mjs
var startsWithSchemeRegexp = /^[a-z][a-z0-9+.-]*:/i;
var isAbsoluteURL = (url) => {
  return startsWithSchemeRegexp.test(url);
};
var isArray = (val) => (isArray = Array.isArray, isArray(val));
var isReadonlyArray = isArray;
function maybeObj(x) {
  if (typeof x !== "object") {
    return {};
  }
  return x ?? {};
}
function isEmptyObj(obj) {
  if (!obj)
    return true;
  for (const _k in obj)
    return false;
  return true;
}
function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}
function isObj(obj) {
  return obj != null && typeof obj === "object" && !Array.isArray(obj);
}
var validatePositiveInteger = (name, n) => {
  if (typeof n !== "number" || !Number.isInteger(n)) {
    throw new OpenAIError(`${name} must be an integer`);
  }
  if (n < 0) {
    throw new OpenAIError(`${name} must be a positive integer`);
  }
  return n;
};
var safeJSON = (text) => {
  try {
    return JSON.parse(text);
  } catch (err) {
    return void 0;
  }
};

// node_modules/openai/internal/utils/sleep.mjs
var sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// node_modules/openai/version.mjs
var VERSION = "6.34.0";

// node_modules/openai/internal/detect-platform.mjs
var isRunningInBrowser = () => {
  return (
    // @ts-ignore
    typeof window !== "undefined" && // @ts-ignore
    typeof window.document !== "undefined" && // @ts-ignore
    typeof navigator !== "undefined"
  );
};
function getDetectedPlatform() {
  if (typeof Deno !== "undefined" && Deno.build != null) {
    return "deno";
  }
  if (typeof EdgeRuntime !== "undefined") {
    return "edge";
  }
  if (Object.prototype.toString.call(typeof globalThis.process !== "undefined" ? globalThis.process : 0) === "[object process]") {
    return "node";
  }
  return "unknown";
}
var getPlatformProperties = () => {
  const detectedPlatform = getDetectedPlatform();
  if (detectedPlatform === "deno") {
    return {
      "X-Stainless-Lang": "js",
      "X-Stainless-Package-Version": VERSION,
      "X-Stainless-OS": normalizePlatform(Deno.build.os),
      "X-Stainless-Arch": normalizeArch(Deno.build.arch),
      "X-Stainless-Runtime": "deno",
      "X-Stainless-Runtime-Version": typeof Deno.version === "string" ? Deno.version : Deno.version?.deno ?? "unknown"
    };
  }
  if (typeof EdgeRuntime !== "undefined") {
    return {
      "X-Stainless-Lang": "js",
      "X-Stainless-Package-Version": VERSION,
      "X-Stainless-OS": "Unknown",
      "X-Stainless-Arch": `other:${EdgeRuntime}`,
      "X-Stainless-Runtime": "edge",
      "X-Stainless-Runtime-Version": globalThis.process.version
    };
  }
  if (detectedPlatform === "node") {
    return {
      "X-Stainless-Lang": "js",
      "X-Stainless-Package-Version": VERSION,
      "X-Stainless-OS": normalizePlatform(globalThis.process.platform ?? "unknown"),
      "X-Stainless-Arch": normalizeArch(globalThis.process.arch ?? "unknown"),
      "X-Stainless-Runtime": "node",
      "X-Stainless-Runtime-Version": globalThis.process.version ?? "unknown"
    };
  }
  const browserInfo = getBrowserInfo();
  if (browserInfo) {
    return {
      "X-Stainless-Lang": "js",
      "X-Stainless-Package-Version": VERSION,
      "X-Stainless-OS": "Unknown",
      "X-Stainless-Arch": "unknown",
      "X-Stainless-Runtime": `browser:${browserInfo.browser}`,
      "X-Stainless-Runtime-Version": browserInfo.version
    };
  }
  return {
    "X-Stainless-Lang": "js",
    "X-Stainless-Package-Version": VERSION,
    "X-Stainless-OS": "Unknown",
    "X-Stainless-Arch": "unknown",
    "X-Stainless-Runtime": "unknown",
    "X-Stainless-Runtime-Version": "unknown"
  };
};
function getBrowserInfo() {
  if (typeof navigator === "undefined" || !navigator) {
    return null;
  }
  const browserPatterns = [
    { key: "edge", pattern: /Edge(?:\W+(\d+)\.(\d+)(?:\.(\d+))?)?/ },
    { key: "ie", pattern: /MSIE(?:\W+(\d+)\.(\d+)(?:\.(\d+))?)?/ },
    { key: "ie", pattern: /Trident(?:.*rv\:(\d+)\.(\d+)(?:\.(\d+))?)?/ },
    { key: "chrome", pattern: /Chrome(?:\W+(\d+)\.(\d+)(?:\.(\d+))?)?/ },
    { key: "firefox", pattern: /Firefox(?:\W+(\d+)\.(\d+)(?:\.(\d+))?)?/ },
    { key: "safari", pattern: /(?:Version\W+(\d+)\.(\d+)(?:\.(\d+))?)?(?:\W+Mobile\S*)?\W+Safari/ }
  ];
  for (const { key, pattern } of browserPatterns) {
    const match = pattern.exec(navigator.userAgent);
    if (match) {
      const major = match[1] || 0;
      const minor = match[2] || 0;
      const patch = match[3] || 0;
      return { browser: key, version: `${major}.${minor}.${patch}` };
    }
  }
  return null;
}
var normalizeArch = (arch) => {
  if (arch === "x32")
    return "x32";
  if (arch === "x86_64" || arch === "x64")
    return "x64";
  if (arch === "arm")
    return "arm";
  if (arch === "aarch64" || arch === "arm64")
    return "arm64";
  if (arch)
    return `other:${arch}`;
  return "unknown";
};
var normalizePlatform = (platform) => {
  platform = platform.toLowerCase();
  if (platform.includes("ios"))
    return "iOS";
  if (platform === "android")
    return "Android";
  if (platform === "darwin")
    return "MacOS";
  if (platform === "win32")
    return "Windows";
  if (platform === "freebsd")
    return "FreeBSD";
  if (platform === "openbsd")
    return "OpenBSD";
  if (platform === "linux")
    return "Linux";
  if (platform)
    return `Other:${platform}`;
  return "Unknown";
};
var _platformHeaders;
var getPlatformHeaders = () => {
  return _platformHeaders ?? (_platformHeaders = getPlatformProperties());
};

// node_modules/openai/internal/shims.mjs
function getDefaultFetch() {
  if (typeof fetch !== "undefined") {
    return fetch;
  }
  throw new Error("`fetch` is not defined as a global; Either pass `fetch` to the client, `new OpenAI({ fetch })` or polyfill the global, `globalThis.fetch = fetch`");
}
function makeReadableStream(...args) {
  const ReadableStream = globalThis.ReadableStream;
  if (typeof ReadableStream === "undefined") {
    throw new Error("`ReadableStream` is not defined as a global; You will need to polyfill it, `globalThis.ReadableStream = ReadableStream`");
  }
  return new ReadableStream(...args);
}
function ReadableStreamFrom(iterable) {
  let iter = Symbol.asyncIterator in iterable ? iterable[Symbol.asyncIterator]() : iterable[Symbol.iterator]();
  return makeReadableStream({
    start() {
    },
    async pull(controller) {
      const { done, value } = await iter.next();
      if (done) {
        controller.close();
      } else {
        controller.enqueue(value);
      }
    },
    async cancel() {
      await iter.return?.();
    }
  });
}
function ReadableStreamToAsyncIterable(stream) {
  if (stream[Symbol.asyncIterator])
    return stream;
  const reader = stream.getReader();
  return {
    async next() {
      try {
        const result = await reader.read();
        if (result?.done)
          reader.releaseLock();
        return result;
      } catch (e) {
        reader.releaseLock();
        throw e;
      }
    },
    async return() {
      const cancelPromise = reader.cancel();
      reader.releaseLock();
      await cancelPromise;
      return { done: true, value: void 0 };
    },
    [Symbol.asyncIterator]() {
      return this;
    }
  };
}
async function CancelReadableStream(stream) {
  if (stream === null || typeof stream !== "object")
    return;
  if (stream[Symbol.asyncIterator]) {
    await stream[Symbol.asyncIterator]().return?.();
    return;
  }
  const reader = stream.getReader();
  const cancelPromise = reader.cancel();
  reader.releaseLock();
  await cancelPromise;
}

// node_modules/openai/internal/request-options.mjs
var FallbackEncoder = ({ headers, body }) => {
  return {
    bodyHeaders: {
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  };
};

// node_modules/openai/internal/qs/formats.mjs
var default_format = "RFC3986";
var default_formatter = (v) => String(v);
var formatters = {
  RFC1738: (v) => String(v).replace(/%20/g, "+"),
  RFC3986: default_formatter
};
var RFC1738 = "RFC1738";

// node_modules/openai/internal/qs/utils.mjs
var has = (obj, key) => (has = Object.hasOwn ?? Function.prototype.call.bind(Object.prototype.hasOwnProperty), has(obj, key));
var hex_table = /* @__PURE__ */ (() => {
  const array = [];
  for (let i = 0; i < 256; ++i) {
    array.push("%" + ((i < 16 ? "0" : "") + i.toString(16)).toUpperCase());
  }
  return array;
})();
var limit = 1024;
var encode = (str2, _defaultEncoder, charset, _kind, format) => {
  if (str2.length === 0) {
    return str2;
  }
  let string = str2;
  if (typeof str2 === "symbol") {
    string = Symbol.prototype.toString.call(str2);
  } else if (typeof str2 !== "string") {
    string = String(str2);
  }
  if (charset === "iso-8859-1") {
    return escape(string).replace(/%u[0-9a-f]{4}/gi, function($0) {
      return "%26%23" + parseInt($0.slice(2), 16) + "%3B";
    });
  }
  let out = "";
  for (let j = 0; j < string.length; j += limit) {
    const segment = string.length >= limit ? string.slice(j, j + limit) : string;
    const arr = [];
    for (let i = 0; i < segment.length; ++i) {
      let c = segment.charCodeAt(i);
      if (c === 45 || // -
      c === 46 || // .
      c === 95 || // _
      c === 126 || // ~
      c >= 48 && c <= 57 || // 0-9
      c >= 65 && c <= 90 || // a-z
      c >= 97 && c <= 122 || // A-Z
      format === RFC1738 && (c === 40 || c === 41)) {
        arr[arr.length] = segment.charAt(i);
        continue;
      }
      if (c < 128) {
        arr[arr.length] = hex_table[c];
        continue;
      }
      if (c < 2048) {
        arr[arr.length] = hex_table[192 | c >> 6] + hex_table[128 | c & 63];
        continue;
      }
      if (c < 55296 || c >= 57344) {
        arr[arr.length] = hex_table[224 | c >> 12] + hex_table[128 | c >> 6 & 63] + hex_table[128 | c & 63];
        continue;
      }
      i += 1;
      c = 65536 + ((c & 1023) << 10 | segment.charCodeAt(i) & 1023);
      arr[arr.length] = hex_table[240 | c >> 18] + hex_table[128 | c >> 12 & 63] + hex_table[128 | c >> 6 & 63] + hex_table[128 | c & 63];
    }
    out += arr.join("");
  }
  return out;
};
function is_buffer(obj) {
  if (!obj || typeof obj !== "object") {
    return false;
  }
  return !!(obj.constructor && obj.constructor.isBuffer && obj.constructor.isBuffer(obj));
}
function maybe_map(val, fn) {
  if (isArray(val)) {
    const mapped = [];
    for (let i = 0; i < val.length; i += 1) {
      mapped.push(fn(val[i]));
    }
    return mapped;
  }
  return fn(val);
}

// node_modules/openai/internal/qs/stringify.mjs
var array_prefix_generators = {
  brackets(prefix) {
    return String(prefix) + "[]";
  },
  comma: "comma",
  indices(prefix, key) {
    return String(prefix) + "[" + key + "]";
  },
  repeat(prefix) {
    return String(prefix);
  }
};
var push_to_array = function(arr, value_or_array) {
  Array.prototype.push.apply(arr, isArray(value_or_array) ? value_or_array : [value_or_array]);
};
var toISOString;
var defaults = {
  addQueryPrefix: false,
  allowDots: false,
  allowEmptyArrays: false,
  arrayFormat: "indices",
  charset: "utf-8",
  charsetSentinel: false,
  delimiter: "&",
  encode: true,
  encodeDotInKeys: false,
  encoder: encode,
  encodeValuesOnly: false,
  format: default_format,
  formatter: default_formatter,
  /** @deprecated */
  indices: false,
  serializeDate(date) {
    return (toISOString ?? (toISOString = Function.prototype.call.bind(Date.prototype.toISOString)))(date);
  },
  skipNulls: false,
  strictNullHandling: false
};
function is_non_nullish_primitive(v) {
  return typeof v === "string" || typeof v === "number" || typeof v === "boolean" || typeof v === "symbol" || typeof v === "bigint";
}
var sentinel = {};
function inner_stringify(object, prefix, generateArrayPrefix, commaRoundTrip, allowEmptyArrays, strictNullHandling, skipNulls, encodeDotInKeys, encoder, filter, sort, allowDots, serializeDate, format, formatter, encodeValuesOnly, charset, sideChannel) {
  let obj = object;
  let tmp_sc = sideChannel;
  let step = 0;
  let find_flag = false;
  while ((tmp_sc = tmp_sc.get(sentinel)) !== void 0 && !find_flag) {
    const pos = tmp_sc.get(object);
    step += 1;
    if (typeof pos !== "undefined") {
      if (pos === step) {
        throw new RangeError("Cyclic object value");
      } else {
        find_flag = true;
      }
    }
    if (typeof tmp_sc.get(sentinel) === "undefined") {
      step = 0;
    }
  }
  if (typeof filter === "function") {
    obj = filter(prefix, obj);
  } else if (obj instanceof Date) {
    obj = serializeDate?.(obj);
  } else if (generateArrayPrefix === "comma" && isArray(obj)) {
    obj = maybe_map(obj, function(value) {
      if (value instanceof Date) {
        return serializeDate?.(value);
      }
      return value;
    });
  }
  if (obj === null) {
    if (strictNullHandling) {
      return encoder && !encodeValuesOnly ? (
        // @ts-expect-error
        encoder(prefix, defaults.encoder, charset, "key", format)
      ) : prefix;
    }
    obj = "";
  }
  if (is_non_nullish_primitive(obj) || is_buffer(obj)) {
    if (encoder) {
      const key_value = encodeValuesOnly ? prefix : encoder(prefix, defaults.encoder, charset, "key", format);
      return [
        formatter?.(key_value) + "=" + // @ts-expect-error
        formatter?.(encoder(obj, defaults.encoder, charset, "value", format))
      ];
    }
    return [formatter?.(prefix) + "=" + formatter?.(String(obj))];
  }
  const values = [];
  if (typeof obj === "undefined") {
    return values;
  }
  let obj_keys;
  if (generateArrayPrefix === "comma" && isArray(obj)) {
    if (encodeValuesOnly && encoder) {
      obj = maybe_map(obj, encoder);
    }
    obj_keys = [{ value: obj.length > 0 ? obj.join(",") || null : void 0 }];
  } else if (isArray(filter)) {
    obj_keys = filter;
  } else {
    const keys = Object.keys(obj);
    obj_keys = sort ? keys.sort(sort) : keys;
  }
  const encoded_prefix = encodeDotInKeys ? String(prefix).replace(/\./g, "%2E") : String(prefix);
  const adjusted_prefix = commaRoundTrip && isArray(obj) && obj.length === 1 ? encoded_prefix + "[]" : encoded_prefix;
  if (allowEmptyArrays && isArray(obj) && obj.length === 0) {
    return adjusted_prefix + "[]";
  }
  for (let j = 0; j < obj_keys.length; ++j) {
    const key = obj_keys[j];
    const value = (
      // @ts-ignore
      typeof key === "object" && typeof key.value !== "undefined" ? key.value : obj[key]
    );
    if (skipNulls && value === null) {
      continue;
    }
    const encoded_key = allowDots && encodeDotInKeys ? key.replace(/\./g, "%2E") : key;
    const key_prefix = isArray(obj) ? typeof generateArrayPrefix === "function" ? generateArrayPrefix(adjusted_prefix, encoded_key) : adjusted_prefix : adjusted_prefix + (allowDots ? "." + encoded_key : "[" + encoded_key + "]");
    sideChannel.set(object, step);
    const valueSideChannel = /* @__PURE__ */ new WeakMap();
    valueSideChannel.set(sentinel, sideChannel);
    push_to_array(values, inner_stringify(
      value,
      key_prefix,
      generateArrayPrefix,
      commaRoundTrip,
      allowEmptyArrays,
      strictNullHandling,
      skipNulls,
      encodeDotInKeys,
      // @ts-ignore
      generateArrayPrefix === "comma" && encodeValuesOnly && isArray(obj) ? null : encoder,
      filter,
      sort,
      allowDots,
      serializeDate,
      format,
      formatter,
      encodeValuesOnly,
      charset,
      valueSideChannel
    ));
  }
  return values;
}
function normalize_stringify_options(opts = defaults) {
  if (typeof opts.allowEmptyArrays !== "undefined" && typeof opts.allowEmptyArrays !== "boolean") {
    throw new TypeError("`allowEmptyArrays` option can only be `true` or `false`, when provided");
  }
  if (typeof opts.encodeDotInKeys !== "undefined" && typeof opts.encodeDotInKeys !== "boolean") {
    throw new TypeError("`encodeDotInKeys` option can only be `true` or `false`, when provided");
  }
  if (opts.encoder !== null && typeof opts.encoder !== "undefined" && typeof opts.encoder !== "function") {
    throw new TypeError("Encoder has to be a function.");
  }
  const charset = opts.charset || defaults.charset;
  if (typeof opts.charset !== "undefined" && opts.charset !== "utf-8" && opts.charset !== "iso-8859-1") {
    throw new TypeError("The charset option must be either utf-8, iso-8859-1, or undefined");
  }
  let format = default_format;
  if (typeof opts.format !== "undefined") {
    if (!has(formatters, opts.format)) {
      throw new TypeError("Unknown format option provided.");
    }
    format = opts.format;
  }
  const formatter = formatters[format];
  let filter = defaults.filter;
  if (typeof opts.filter === "function" || isArray(opts.filter)) {
    filter = opts.filter;
  }
  let arrayFormat;
  if (opts.arrayFormat && opts.arrayFormat in array_prefix_generators) {
    arrayFormat = opts.arrayFormat;
  } else if ("indices" in opts) {
    arrayFormat = opts.indices ? "indices" : "repeat";
  } else {
    arrayFormat = defaults.arrayFormat;
  }
  if ("commaRoundTrip" in opts && typeof opts.commaRoundTrip !== "boolean") {
    throw new TypeError("`commaRoundTrip` must be a boolean, or absent");
  }
  const allowDots = typeof opts.allowDots === "undefined" ? !!opts.encodeDotInKeys === true ? true : defaults.allowDots : !!opts.allowDots;
  return {
    addQueryPrefix: typeof opts.addQueryPrefix === "boolean" ? opts.addQueryPrefix : defaults.addQueryPrefix,
    // @ts-ignore
    allowDots,
    allowEmptyArrays: typeof opts.allowEmptyArrays === "boolean" ? !!opts.allowEmptyArrays : defaults.allowEmptyArrays,
    arrayFormat,
    charset,
    charsetSentinel: typeof opts.charsetSentinel === "boolean" ? opts.charsetSentinel : defaults.charsetSentinel,
    commaRoundTrip: !!opts.commaRoundTrip,
    delimiter: typeof opts.delimiter === "undefined" ? defaults.delimiter : opts.delimiter,
    encode: typeof opts.encode === "boolean" ? opts.encode : defaults.encode,
    encodeDotInKeys: typeof opts.encodeDotInKeys === "boolean" ? opts.encodeDotInKeys : defaults.encodeDotInKeys,
    encoder: typeof opts.encoder === "function" ? opts.encoder : defaults.encoder,
    encodeValuesOnly: typeof opts.encodeValuesOnly === "boolean" ? opts.encodeValuesOnly : defaults.encodeValuesOnly,
    filter,
    format,
    formatter,
    serializeDate: typeof opts.serializeDate === "function" ? opts.serializeDate : defaults.serializeDate,
    skipNulls: typeof opts.skipNulls === "boolean" ? opts.skipNulls : defaults.skipNulls,
    // @ts-ignore
    sort: typeof opts.sort === "function" ? opts.sort : null,
    strictNullHandling: typeof opts.strictNullHandling === "boolean" ? opts.strictNullHandling : defaults.strictNullHandling
  };
}
function stringify(object, opts = {}) {
  let obj = object;
  const options = normalize_stringify_options(opts);
  let obj_keys;
  let filter;
  if (typeof options.filter === "function") {
    filter = options.filter;
    obj = filter("", obj);
  } else if (isArray(options.filter)) {
    filter = options.filter;
    obj_keys = filter;
  }
  const keys = [];
  if (typeof obj !== "object" || obj === null) {
    return "";
  }
  const generateArrayPrefix = array_prefix_generators[options.arrayFormat];
  const commaRoundTrip = generateArrayPrefix === "comma" && options.commaRoundTrip;
  if (!obj_keys) {
    obj_keys = Object.keys(obj);
  }
  if (options.sort) {
    obj_keys.sort(options.sort);
  }
  const sideChannel = /* @__PURE__ */ new WeakMap();
  for (let i = 0; i < obj_keys.length; ++i) {
    const key = obj_keys[i];
    if (options.skipNulls && obj[key] === null) {
      continue;
    }
    push_to_array(keys, inner_stringify(
      obj[key],
      key,
      // @ts-expect-error
      generateArrayPrefix,
      commaRoundTrip,
      options.allowEmptyArrays,
      options.strictNullHandling,
      options.skipNulls,
      options.encodeDotInKeys,
      options.encode ? options.encoder : null,
      options.filter,
      options.sort,
      options.allowDots,
      options.serializeDate,
      options.format,
      options.formatter,
      options.encodeValuesOnly,
      options.charset,
      sideChannel
    ));
  }
  const joined = keys.join(options.delimiter);
  let prefix = options.addQueryPrefix === true ? "?" : "";
  if (options.charsetSentinel) {
    if (options.charset === "iso-8859-1") {
      prefix += "utf8=%26%2310003%3B&";
    } else {
      prefix += "utf8=%E2%9C%93&";
    }
  }
  return joined.length > 0 ? prefix + joined : "";
}

// node_modules/openai/internal/utils/query.mjs
function stringifyQuery(query) {
  return stringify(query, { arrayFormat: "brackets" });
}

// node_modules/openai/internal/utils/bytes.mjs
function concatBytes(buffers) {
  let length = 0;
  for (const buffer of buffers) {
    length += buffer.length;
  }
  const output = new Uint8Array(length);
  let index = 0;
  for (const buffer of buffers) {
    output.set(buffer, index);
    index += buffer.length;
  }
  return output;
}
var encodeUTF8_;
function encodeUTF8(str2) {
  let encoder;
  return (encodeUTF8_ ?? (encoder = new globalThis.TextEncoder(), encodeUTF8_ = encoder.encode.bind(encoder)))(str2);
}
var decodeUTF8_;
function decodeUTF8(bytes) {
  let decoder;
  return (decodeUTF8_ ?? (decoder = new globalThis.TextDecoder(), decodeUTF8_ = decoder.decode.bind(decoder)))(bytes);
}

// node_modules/openai/internal/decoders/line.mjs
var _LineDecoder_buffer;
var _LineDecoder_carriageReturnIndex;
var LineDecoder = class {
  constructor() {
    _LineDecoder_buffer.set(this, void 0);
    _LineDecoder_carriageReturnIndex.set(this, void 0);
    __classPrivateFieldSet(this, _LineDecoder_buffer, new Uint8Array(), "f");
    __classPrivateFieldSet(this, _LineDecoder_carriageReturnIndex, null, "f");
  }
  decode(chunk) {
    if (chunk == null) {
      return [];
    }
    const binaryChunk = chunk instanceof ArrayBuffer ? new Uint8Array(chunk) : typeof chunk === "string" ? encodeUTF8(chunk) : chunk;
    __classPrivateFieldSet(this, _LineDecoder_buffer, concatBytes([__classPrivateFieldGet(this, _LineDecoder_buffer, "f"), binaryChunk]), "f");
    const lines = [];
    let patternIndex;
    while ((patternIndex = findNewlineIndex(__classPrivateFieldGet(this, _LineDecoder_buffer, "f"), __classPrivateFieldGet(this, _LineDecoder_carriageReturnIndex, "f"))) != null) {
      if (patternIndex.carriage && __classPrivateFieldGet(this, _LineDecoder_carriageReturnIndex, "f") == null) {
        __classPrivateFieldSet(this, _LineDecoder_carriageReturnIndex, patternIndex.index, "f");
        continue;
      }
      if (__classPrivateFieldGet(this, _LineDecoder_carriageReturnIndex, "f") != null && (patternIndex.index !== __classPrivateFieldGet(this, _LineDecoder_carriageReturnIndex, "f") + 1 || patternIndex.carriage)) {
        lines.push(decodeUTF8(__classPrivateFieldGet(this, _LineDecoder_buffer, "f").subarray(0, __classPrivateFieldGet(this, _LineDecoder_carriageReturnIndex, "f") - 1)));
        __classPrivateFieldSet(this, _LineDecoder_buffer, __classPrivateFieldGet(this, _LineDecoder_buffer, "f").subarray(__classPrivateFieldGet(this, _LineDecoder_carriageReturnIndex, "f")), "f");
        __classPrivateFieldSet(this, _LineDecoder_carriageReturnIndex, null, "f");
        continue;
      }
      const endIndex = __classPrivateFieldGet(this, _LineDecoder_carriageReturnIndex, "f") !== null ? patternIndex.preceding - 1 : patternIndex.preceding;
      const line = decodeUTF8(__classPrivateFieldGet(this, _LineDecoder_buffer, "f").subarray(0, endIndex));
      lines.push(line);
      __classPrivateFieldSet(this, _LineDecoder_buffer, __classPrivateFieldGet(this, _LineDecoder_buffer, "f").subarray(patternIndex.index), "f");
      __classPrivateFieldSet(this, _LineDecoder_carriageReturnIndex, null, "f");
    }
    return lines;
  }
  flush() {
    if (!__classPrivateFieldGet(this, _LineDecoder_buffer, "f").length) {
      return [];
    }
    return this.decode("\n");
  }
};
_LineDecoder_buffer = /* @__PURE__ */ new WeakMap(), _LineDecoder_carriageReturnIndex = /* @__PURE__ */ new WeakMap();
LineDecoder.NEWLINE_CHARS = /* @__PURE__ */ new Set(["\n", "\r"]);
LineDecoder.NEWLINE_REGEXP = /\r\n|[\n\r]/g;
function findNewlineIndex(buffer, startIndex) {
  const newline = 10;
  const carriage = 13;
  for (let i = startIndex ?? 0; i < buffer.length; i++) {
    if (buffer[i] === newline) {
      return { preceding: i, index: i + 1, carriage: false };
    }
    if (buffer[i] === carriage) {
      return { preceding: i, index: i + 1, carriage: true };
    }
  }
  return null;
}
function findDoubleNewlineIndex(buffer) {
  const newline = 10;
  const carriage = 13;
  for (let i = 0; i < buffer.length - 1; i++) {
    if (buffer[i] === newline && buffer[i + 1] === newline) {
      return i + 2;
    }
    if (buffer[i] === carriage && buffer[i + 1] === carriage) {
      return i + 2;
    }
    if (buffer[i] === carriage && buffer[i + 1] === newline && i + 3 < buffer.length && buffer[i + 2] === carriage && buffer[i + 3] === newline) {
      return i + 4;
    }
  }
  return -1;
}

// node_modules/openai/internal/utils/log.mjs
var levelNumbers = {
  off: 0,
  error: 200,
  warn: 300,
  info: 400,
  debug: 500
};
var parseLogLevel = (maybeLevel, sourceName, client) => {
  if (!maybeLevel) {
    return void 0;
  }
  if (hasOwn(levelNumbers, maybeLevel)) {
    return maybeLevel;
  }
  loggerFor(client).warn(`${sourceName} was set to ${JSON.stringify(maybeLevel)}, expected one of ${JSON.stringify(Object.keys(levelNumbers))}`);
  return void 0;
};
function noop() {
}
function makeLogFn(fnLevel, logger, logLevel) {
  if (!logger || levelNumbers[fnLevel] > levelNumbers[logLevel]) {
    return noop;
  } else {
    return logger[fnLevel].bind(logger);
  }
}
var noopLogger = {
  error: noop,
  warn: noop,
  info: noop,
  debug: noop
};
var cachedLoggers = /* @__PURE__ */ new WeakMap();
function loggerFor(client) {
  const logger = client.logger;
  const logLevel = client.logLevel ?? "off";
  if (!logger) {
    return noopLogger;
  }
  const cachedLogger = cachedLoggers.get(logger);
  if (cachedLogger && cachedLogger[0] === logLevel) {
    return cachedLogger[1];
  }
  const levelLogger = {
    error: makeLogFn("error", logger, logLevel),
    warn: makeLogFn("warn", logger, logLevel),
    info: makeLogFn("info", logger, logLevel),
    debug: makeLogFn("debug", logger, logLevel)
  };
  cachedLoggers.set(logger, [logLevel, levelLogger]);
  return levelLogger;
}
var formatRequestDetails = (details) => {
  if (details.options) {
    details.options = { ...details.options };
    delete details.options["headers"];
  }
  if (details.headers) {
    details.headers = Object.fromEntries((details.headers instanceof Headers ? [...details.headers] : Object.entries(details.headers)).map(([name, value]) => [
      name,
      name.toLowerCase() === "authorization" || name.toLowerCase() === "cookie" || name.toLowerCase() === "set-cookie" ? "***" : value
    ]));
  }
  if ("retryOfRequestLogID" in details) {
    if (details.retryOfRequestLogID) {
      details.retryOf = details.retryOfRequestLogID;
    }
    delete details.retryOfRequestLogID;
  }
  return details;
};

// node_modules/openai/core/streaming.mjs
var _Stream_client;
var Stream = class _Stream {
  constructor(iterator, controller, client) {
    this.iterator = iterator;
    _Stream_client.set(this, void 0);
    this.controller = controller;
    __classPrivateFieldSet(this, _Stream_client, client, "f");
  }
  static fromSSEResponse(response, controller, client, synthesizeEventData) {
    let consumed = false;
    const logger = client ? loggerFor(client) : console;
    async function* iterator() {
      if (consumed) {
        throw new OpenAIError("Cannot iterate over a consumed stream, use `.tee()` to split the stream.");
      }
      consumed = true;
      let done = false;
      try {
        for await (const sse of _iterSSEMessages(response, controller)) {
          if (done)
            continue;
          if (sse.data.startsWith("[DONE]")) {
            done = true;
            continue;
          }
          if (sse.event === null || !sse.event.startsWith("thread.")) {
            let data;
            try {
              data = JSON.parse(sse.data);
            } catch (e) {
              logger.error(`Could not parse message into JSON:`, sse.data);
              logger.error(`From chunk:`, sse.raw);
              throw e;
            }
            if (data && data.error) {
              throw new APIError(void 0, data.error, void 0, response.headers);
            }
            yield synthesizeEventData ? { event: sse.event, data } : data;
          } else {
            let data;
            try {
              data = JSON.parse(sse.data);
            } catch (e) {
              console.error(`Could not parse message into JSON:`, sse.data);
              console.error(`From chunk:`, sse.raw);
              throw e;
            }
            if (sse.event == "error") {
              throw new APIError(void 0, data.error, data.message, void 0);
            }
            yield { event: sse.event, data };
          }
        }
        done = true;
      } catch (e) {
        if (isAbortError(e))
          return;
        throw e;
      } finally {
        if (!done)
          controller.abort();
      }
    }
    return new _Stream(iterator, controller, client);
  }
  /**
   * Generates a Stream from a newline-separated ReadableStream
   * where each item is a JSON value.
   */
  static fromReadableStream(readableStream, controller, client) {
    let consumed = false;
    async function* iterLines() {
      const lineDecoder = new LineDecoder();
      const iter = ReadableStreamToAsyncIterable(readableStream);
      for await (const chunk of iter) {
        for (const line of lineDecoder.decode(chunk)) {
          yield line;
        }
      }
      for (const line of lineDecoder.flush()) {
        yield line;
      }
    }
    async function* iterator() {
      if (consumed) {
        throw new OpenAIError("Cannot iterate over a consumed stream, use `.tee()` to split the stream.");
      }
      consumed = true;
      let done = false;
      try {
        for await (const line of iterLines()) {
          if (done)
            continue;
          if (line)
            yield JSON.parse(line);
        }
        done = true;
      } catch (e) {
        if (isAbortError(e))
          return;
        throw e;
      } finally {
        if (!done)
          controller.abort();
      }
    }
    return new _Stream(iterator, controller, client);
  }
  [(_Stream_client = /* @__PURE__ */ new WeakMap(), Symbol.asyncIterator)]() {
    return this.iterator();
  }
  /**
   * Splits the stream into two streams which can be
   * independently read from at different speeds.
   */
  tee() {
    const left = [];
    const right = [];
    const iterator = this.iterator();
    const teeIterator = (queue) => {
      return {
        next: () => {
          if (queue.length === 0) {
            const result = iterator.next();
            left.push(result);
            right.push(result);
          }
          return queue.shift();
        }
      };
    };
    return [
      new _Stream(() => teeIterator(left), this.controller, __classPrivateFieldGet(this, _Stream_client, "f")),
      new _Stream(() => teeIterator(right), this.controller, __classPrivateFieldGet(this, _Stream_client, "f"))
    ];
  }
  /**
   * Converts this stream to a newline-separated ReadableStream of
   * JSON stringified values in the stream
   * which can be turned back into a Stream with `Stream.fromReadableStream()`.
   */
  toReadableStream() {
    const self = this;
    let iter;
    return makeReadableStream({
      async start() {
        iter = self[Symbol.asyncIterator]();
      },
      async pull(ctrl) {
        try {
          const { value, done } = await iter.next();
          if (done)
            return ctrl.close();
          const bytes = encodeUTF8(JSON.stringify(value) + "\n");
          ctrl.enqueue(bytes);
        } catch (err) {
          ctrl.error(err);
        }
      },
      async cancel() {
        await iter.return?.();
      }
    });
  }
};
async function* _iterSSEMessages(response, controller) {
  if (!response.body) {
    controller.abort();
    if (typeof globalThis.navigator !== "undefined" && globalThis.navigator.product === "ReactNative") {
      throw new OpenAIError(`The default react-native fetch implementation does not support streaming. Please use expo/fetch: https://docs.expo.dev/versions/latest/sdk/expo/#expofetch-api`);
    }
    throw new OpenAIError(`Attempted to iterate over a response with no body`);
  }
  const sseDecoder = new SSEDecoder();
  const lineDecoder = new LineDecoder();
  const iter = ReadableStreamToAsyncIterable(response.body);
  for await (const sseChunk of iterSSEChunks(iter)) {
    for (const line of lineDecoder.decode(sseChunk)) {
      const sse = sseDecoder.decode(line);
      if (sse)
        yield sse;
    }
  }
  for (const line of lineDecoder.flush()) {
    const sse = sseDecoder.decode(line);
    if (sse)
      yield sse;
  }
}
async function* iterSSEChunks(iterator) {
  let data = new Uint8Array();
  for await (const chunk of iterator) {
    if (chunk == null) {
      continue;
    }
    const binaryChunk = chunk instanceof ArrayBuffer ? new Uint8Array(chunk) : typeof chunk === "string" ? encodeUTF8(chunk) : chunk;
    let newData = new Uint8Array(data.length + binaryChunk.length);
    newData.set(data);
    newData.set(binaryChunk, data.length);
    data = newData;
    let patternIndex;
    while ((patternIndex = findDoubleNewlineIndex(data)) !== -1) {
      yield data.slice(0, patternIndex);
      data = data.slice(patternIndex);
    }
  }
  if (data.length > 0) {
    yield data;
  }
}
var SSEDecoder = class {
  constructor() {
    this.event = null;
    this.data = [];
    this.chunks = [];
  }
  decode(line) {
    if (line.endsWith("\r")) {
      line = line.substring(0, line.length - 1);
    }
    if (!line) {
      if (!this.event && !this.data.length)
        return null;
      const sse = {
        event: this.event,
        data: this.data.join("\n"),
        raw: this.chunks
      };
      this.event = null;
      this.data = [];
      this.chunks = [];
      return sse;
    }
    this.chunks.push(line);
    if (line.startsWith(":")) {
      return null;
    }
    let [fieldname, _, value] = partition(line, ":");
    if (value.startsWith(" ")) {
      value = value.substring(1);
    }
    if (fieldname === "event") {
      this.event = value;
    } else if (fieldname === "data") {
      this.data.push(value);
    }
    return null;
  }
};
function partition(str2, delimiter) {
  const index = str2.indexOf(delimiter);
  if (index !== -1) {
    return [str2.substring(0, index), delimiter, str2.substring(index + delimiter.length)];
  }
  return [str2, "", ""];
}

// node_modules/openai/internal/parse.mjs
async function defaultParseResponse(client, props) {
  const { response, requestLogID, retryOfRequestLogID, startTime } = props;
  const body = await (async () => {
    if (props.options.stream) {
      loggerFor(client).debug("response", response.status, response.url, response.headers, response.body);
      if (props.options.__streamClass) {
        return props.options.__streamClass.fromSSEResponse(response, props.controller, client, props.options.__synthesizeEventData);
      }
      return Stream.fromSSEResponse(response, props.controller, client, props.options.__synthesizeEventData);
    }
    if (response.status === 204) {
      return null;
    }
    if (props.options.__binaryResponse) {
      return response;
    }
    const contentType = response.headers.get("content-type");
    const mediaType = contentType?.split(";")[0]?.trim();
    const isJSON = mediaType?.includes("application/json") || mediaType?.endsWith("+json");
    if (isJSON) {
      const contentLength = response.headers.get("content-length");
      if (contentLength === "0") {
        return void 0;
      }
      const json = await response.json();
      return addRequestID(json, response);
    }
    const text = await response.text();
    return text;
  })();
  loggerFor(client).debug(`[${requestLogID}] response parsed`, formatRequestDetails({
    retryOfRequestLogID,
    url: response.url,
    status: response.status,
    body,
    durationMs: Date.now() - startTime
  }));
  return body;
}
function addRequestID(value, response) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  return Object.defineProperty(value, "_request_id", {
    value: response.headers.get("x-request-id"),
    enumerable: false
  });
}

// node_modules/openai/core/api-promise.mjs
var _APIPromise_client;
var APIPromise = class _APIPromise extends Promise {
  constructor(client, responsePromise, parseResponse2 = defaultParseResponse) {
    super((resolve) => {
      resolve(null);
    });
    this.responsePromise = responsePromise;
    this.parseResponse = parseResponse2;
    _APIPromise_client.set(this, void 0);
    __classPrivateFieldSet(this, _APIPromise_client, client, "f");
  }
  _thenUnwrap(transform) {
    return new _APIPromise(__classPrivateFieldGet(this, _APIPromise_client, "f"), this.responsePromise, async (client, props) => addRequestID(transform(await this.parseResponse(client, props), props), props.response));
  }
  /**
   * Gets the raw `Response` instance instead of parsing the response
   * data.
   *
   * If you want to parse the response body but still get the `Response`
   * instance, you can use {@link withResponse()}.
   *
   * 👋 Getting the wrong TypeScript type for `Response`?
   * Try setting `"moduleResolution": "NodeNext"` or add `"lib": ["DOM"]`
   * to your `tsconfig.json`.
   */
  asResponse() {
    return this.responsePromise.then((p) => p.response);
  }
  /**
   * Gets the parsed response data, the raw `Response` instance and the ID of the request,
   * returned via the X-Request-ID header which is useful for debugging requests and reporting
   * issues to OpenAI.
   *
   * If you just want to get the raw `Response` instance without parsing it,
   * you can use {@link asResponse()}.
   *
   * 👋 Getting the wrong TypeScript type for `Response`?
   * Try setting `"moduleResolution": "NodeNext"` or add `"lib": ["DOM"]`
   * to your `tsconfig.json`.
   */
  async withResponse() {
    const [data, response] = await Promise.all([this.parse(), this.asResponse()]);
    return { data, response, request_id: response.headers.get("x-request-id") };
  }
  parse() {
    if (!this.parsedPromise) {
      this.parsedPromise = this.responsePromise.then((data) => this.parseResponse(__classPrivateFieldGet(this, _APIPromise_client, "f"), data));
    }
    return this.parsedPromise;
  }
  then(onfulfilled, onrejected) {
    return this.parse().then(onfulfilled, onrejected);
  }
  catch(onrejected) {
    return this.parse().catch(onrejected);
  }
  finally(onfinally) {
    return this.parse().finally(onfinally);
  }
};
_APIPromise_client = /* @__PURE__ */ new WeakMap();

// node_modules/openai/core/pagination.mjs
var _AbstractPage_client;
var AbstractPage = class {
  constructor(client, response, body, options) {
    _AbstractPage_client.set(this, void 0);
    __classPrivateFieldSet(this, _AbstractPage_client, client, "f");
    this.options = options;
    this.response = response;
    this.body = body;
  }
  hasNextPage() {
    const items = this.getPaginatedItems();
    if (!items.length)
      return false;
    return this.nextPageRequestOptions() != null;
  }
  async getNextPage() {
    const nextOptions = this.nextPageRequestOptions();
    if (!nextOptions) {
      throw new OpenAIError("No next page expected; please check `.hasNextPage()` before calling `.getNextPage()`.");
    }
    return await __classPrivateFieldGet(this, _AbstractPage_client, "f").requestAPIList(this.constructor, nextOptions);
  }
  async *iterPages() {
    let page = this;
    yield page;
    while (page.hasNextPage()) {
      page = await page.getNextPage();
      yield page;
    }
  }
  async *[(_AbstractPage_client = /* @__PURE__ */ new WeakMap(), Symbol.asyncIterator)]() {
    for await (const page of this.iterPages()) {
      for (const item of page.getPaginatedItems()) {
        yield item;
      }
    }
  }
};
var PagePromise = class extends APIPromise {
  constructor(client, request, Page2) {
    super(client, request, async (client2, props) => new Page2(client2, props.response, await defaultParseResponse(client2, props), props.options));
  }
  /**
   * Allow auto-paginating iteration on an unawaited list call, eg:
   *
   *    for await (const item of client.items.list()) {
   *      console.log(item)
   *    }
   */
  async *[Symbol.asyncIterator]() {
    const page = await this;
    for await (const item of page) {
      yield item;
    }
  }
};
var Page = class extends AbstractPage {
  constructor(client, response, body, options) {
    super(client, response, body, options);
    this.data = body.data || [];
    this.object = body.object;
  }
  getPaginatedItems() {
    return this.data ?? [];
  }
  nextPageRequestOptions() {
    return null;
  }
};
var CursorPage = class extends AbstractPage {
  constructor(client, response, body, options) {
    super(client, response, body, options);
    this.data = body.data || [];
    this.has_more = body.has_more || false;
  }
  getPaginatedItems() {
    return this.data ?? [];
  }
  hasNextPage() {
    if (this.has_more === false) {
      return false;
    }
    return super.hasNextPage();
  }
  nextPageRequestOptions() {
    const data = this.getPaginatedItems();
    const id = data[data.length - 1]?.id;
    if (!id) {
      return null;
    }
    return {
      ...this.options,
      query: {
        ...maybeObj(this.options.query),
        after: id
      }
    };
  }
};
var ConversationCursorPage = class extends AbstractPage {
  constructor(client, response, body, options) {
    super(client, response, body, options);
    this.data = body.data || [];
    this.has_more = body.has_more || false;
    this.last_id = body.last_id || "";
  }
  getPaginatedItems() {
    return this.data ?? [];
  }
  hasNextPage() {
    if (this.has_more === false) {
      return false;
    }
    return super.hasNextPage();
  }
  nextPageRequestOptions() {
    const cursor = this.last_id;
    if (!cursor) {
      return null;
    }
    return {
      ...this.options,
      query: {
        ...maybeObj(this.options.query),
        after: cursor
      }
    };
  }
};

// node_modules/openai/auth/workload-identity-auth.mjs
var SUBJECT_TOKEN_TYPES = {
  jwt: "urn:ietf:params:oauth:token-type:jwt",
  id: "urn:ietf:params:oauth:token-type:id_token"
};
var TOKEN_EXCHANGE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:token-exchange";
var WorkloadIdentityAuth = class {
  constructor(config, fetch2) {
    this.cachedToken = null;
    this.refreshPromise = null;
    this.tokenExchangeUrl = "https://auth.openai.com/oauth/token";
    this.config = config;
    this.fetch = fetch2 ?? getDefaultFetch();
  }
  async getToken() {
    if (!this.cachedToken || this.isTokenExpired(this.cachedToken)) {
      if (this.refreshPromise) {
        return await this.refreshPromise;
      }
      this.refreshPromise = this.refreshToken();
      try {
        const token = await this.refreshPromise;
        return token;
      } finally {
        this.refreshPromise = null;
      }
    }
    if (this.needsRefresh(this.cachedToken) && !this.refreshPromise) {
      this.refreshPromise = this.refreshToken().finally(() => {
        this.refreshPromise = null;
      });
    }
    return this.cachedToken.token;
  }
  async refreshToken() {
    const subjectToken = await this.config.provider.getToken();
    const response = await this.fetch(this.tokenExchangeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
        client_id: this.config.clientId,
        subject_token: subjectToken,
        subject_token_type: SUBJECT_TOKEN_TYPES[this.config.provider.tokenType],
        identity_provider_id: this.config.identityProviderId,
        service_account_id: this.config.serviceAccountId
      })
    });
    if (!response.ok) {
      const errorText = await response.text();
      let body = void 0;
      try {
        body = JSON.parse(errorText);
      } catch {
      }
      if (response.status === 400 || response.status === 401 || response.status === 403) {
        throw new OAuthError(response.status, body, response.headers);
      }
      throw APIError.generate(response.status, body, `Token exchange failed with status ${response.status}`, response.headers);
    }
    const tokenResponse = await response.json();
    const expiresIn = tokenResponse.expires_in || 3600;
    const expiresAt = Date.now() + expiresIn * 1e3;
    this.cachedToken = {
      token: tokenResponse.access_token,
      expiresAt
    };
    return tokenResponse.access_token;
  }
  isTokenExpired(cachedToken) {
    return Date.now() >= cachedToken.expiresAt;
  }
  needsRefresh(cachedToken) {
    const bufferSeconds = this.config.refreshBufferSeconds ?? 1200;
    const bufferMs = bufferSeconds * 1e3;
    return Date.now() >= cachedToken.expiresAt - bufferMs;
  }
  invalidateToken() {
    this.cachedToken = null;
    this.refreshPromise = null;
  }
};

// node_modules/openai/internal/uploads.mjs
var checkFileSupport = () => {
  if (typeof File === "undefined") {
    const { process: process2 } = globalThis;
    const isOldNode = typeof process2?.versions?.node === "string" && parseInt(process2.versions.node.split(".")) < 20;
    throw new Error("`File` is not defined as a global, which is required for file uploads." + (isOldNode ? " Update to Node 20 LTS or newer, or set `globalThis.File` to `import('node:buffer').File`." : ""));
  }
};
function makeFile(fileBits, fileName, options) {
  checkFileSupport();
  return new File(fileBits, fileName ?? "unknown_file", options);
}
function getName(value) {
  return (typeof value === "object" && value !== null && ("name" in value && value.name && String(value.name) || "url" in value && value.url && String(value.url) || "filename" in value && value.filename && String(value.filename) || "path" in value && value.path && String(value.path)) || "").split(/[\\/]/).pop() || void 0;
}
var isAsyncIterable = (value) => value != null && typeof value === "object" && typeof value[Symbol.asyncIterator] === "function";
var maybeMultipartFormRequestOptions = async (opts, fetch2) => {
  if (!hasUploadableValue(opts.body))
    return opts;
  return { ...opts, body: await createForm(opts.body, fetch2) };
};
var multipartFormRequestOptions = async (opts, fetch2) => {
  return { ...opts, body: await createForm(opts.body, fetch2) };
};
var supportsFormDataMap = /* @__PURE__ */ new WeakMap();
function supportsFormData(fetchObject) {
  const fetch2 = typeof fetchObject === "function" ? fetchObject : fetchObject.fetch;
  const cached = supportsFormDataMap.get(fetch2);
  if (cached)
    return cached;
  const promise = (async () => {
    try {
      const FetchResponse = "Response" in fetch2 ? fetch2.Response : (await fetch2("data:,")).constructor;
      const data = new FormData();
      if (data.toString() === await new FetchResponse(data).text()) {
        return false;
      }
      return true;
    } catch {
      return true;
    }
  })();
  supportsFormDataMap.set(fetch2, promise);
  return promise;
}
var createForm = async (body, fetch2) => {
  if (!await supportsFormData(fetch2)) {
    throw new TypeError("The provided fetch function does not support file uploads with the current global FormData class.");
  }
  const form = new FormData();
  await Promise.all(Object.entries(body || {}).map(([key, value]) => addFormValue(form, key, value)));
  return form;
};
var isNamedBlob = (value) => value instanceof Blob && "name" in value;
var isUploadable = (value) => typeof value === "object" && value !== null && (value instanceof Response || isAsyncIterable(value) || isNamedBlob(value));
var hasUploadableValue = (value) => {
  if (isUploadable(value))
    return true;
  if (Array.isArray(value))
    return value.some(hasUploadableValue);
  if (value && typeof value === "object") {
    for (const k in value) {
      if (hasUploadableValue(value[k]))
        return true;
    }
  }
  return false;
};
var addFormValue = async (form, key, value) => {
  if (value === void 0)
    return;
  if (value == null) {
    throw new TypeError(`Received null for "${key}"; to pass null in FormData, you must use the string 'null'`);
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    form.append(key, String(value));
  } else if (value instanceof Response) {
    form.append(key, makeFile([await value.blob()], getName(value)));
  } else if (isAsyncIterable(value)) {
    form.append(key, makeFile([await new Response(ReadableStreamFrom(value)).blob()], getName(value)));
  } else if (isNamedBlob(value)) {
    form.append(key, value, getName(value));
  } else if (Array.isArray(value)) {
    await Promise.all(value.map((entry) => addFormValue(form, key + "[]", entry)));
  } else if (typeof value === "object") {
    await Promise.all(Object.entries(value).map(([name, prop]) => addFormValue(form, `${key}[${name}]`, prop)));
  } else {
    throw new TypeError(`Invalid value given to form, expected a string, number, boolean, object, Array, File or Blob but got ${value} instead`);
  }
};

// node_modules/openai/internal/to-file.mjs
var isBlobLike = (value) => value != null && typeof value === "object" && typeof value.size === "number" && typeof value.type === "string" && typeof value.text === "function" && typeof value.slice === "function" && typeof value.arrayBuffer === "function";
var isFileLike = (value) => value != null && typeof value === "object" && typeof value.name === "string" && typeof value.lastModified === "number" && isBlobLike(value);
var isResponseLike = (value) => value != null && typeof value === "object" && typeof value.url === "string" && typeof value.blob === "function";
async function toFile(value, name, options) {
  checkFileSupport();
  value = await value;
  if (isFileLike(value)) {
    if (value instanceof File) {
      return value;
    }
    return makeFile([await value.arrayBuffer()], value.name);
  }
  if (isResponseLike(value)) {
    const blob = await value.blob();
    name || (name = new URL(value.url).pathname.split(/[\\/]/).pop());
    return makeFile(await getBytes(blob), name, options);
  }
  const parts = await getBytes(value);
  name || (name = getName(value));
  if (!options?.type) {
    const type = parts.find((part) => typeof part === "object" && "type" in part && part.type);
    if (typeof type === "string") {
      options = { ...options, type };
    }
  }
  return makeFile(parts, name, options);
}
async function getBytes(value) {
  let parts = [];
  if (typeof value === "string" || ArrayBuffer.isView(value) || // includes Uint8Array, Buffer, etc.
  value instanceof ArrayBuffer) {
    parts.push(value);
  } else if (isBlobLike(value)) {
    parts.push(value instanceof Blob ? value : await value.arrayBuffer());
  } else if (isAsyncIterable(value)) {
    for await (const chunk of value) {
      parts.push(...await getBytes(chunk));
    }
  } else {
    const constructor = value?.constructor?.name;
    throw new Error(`Unexpected data type: ${typeof value}${constructor ? `; constructor: ${constructor}` : ""}${propsForError(value)}`);
  }
  return parts;
}
function propsForError(value) {
  if (typeof value !== "object" || value === null)
    return "";
  const props = Object.getOwnPropertyNames(value);
  return `; props: [${props.map((p) => `"${p}"`).join(", ")}]`;
}

// node_modules/openai/core/resource.mjs
var APIResource = class {
  constructor(client) {
    this._client = client;
  }
};

// node_modules/openai/internal/utils/path.mjs
function encodeURIPath(str2) {
  return str2.replace(/[^A-Za-z0-9\-._~!$&'()*+,;=:@]+/g, encodeURIComponent);
}
var EMPTY = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.create(null));
var createPathTagFunction = (pathEncoder = encodeURIPath) => function path2(statics, ...params) {
  if (statics.length === 1)
    return statics[0];
  let postPath = false;
  const invalidSegments = [];
  const path3 = statics.reduce((previousValue, currentValue, index) => {
    if (/[?#]/.test(currentValue)) {
      postPath = true;
    }
    const value = params[index];
    let encoded = (postPath ? encodeURIComponent : pathEncoder)("" + value);
    if (index !== params.length && (value == null || typeof value === "object" && // handle values from other realms
    value.toString === Object.getPrototypeOf(Object.getPrototypeOf(value.hasOwnProperty ?? EMPTY) ?? EMPTY)?.toString)) {
      encoded = value + "";
      invalidSegments.push({
        start: previousValue.length + currentValue.length,
        length: encoded.length,
        error: `Value of type ${Object.prototype.toString.call(value).slice(8, -1)} is not a valid path parameter`
      });
    }
    return previousValue + currentValue + (index === params.length ? "" : encoded);
  }, "");
  const pathOnly = path3.split(/[?#]/, 1)[0];
  const invalidSegmentPattern = /(?<=^|\/)(?:\.|%2e){1,2}(?=\/|$)/gi;
  let match;
  while ((match = invalidSegmentPattern.exec(pathOnly)) !== null) {
    invalidSegments.push({
      start: match.index,
      length: match[0].length,
      error: `Value "${match[0]}" can't be safely passed as a path parameter`
    });
  }
  invalidSegments.sort((a, b) => a.start - b.start);
  if (invalidSegments.length > 0) {
    let lastEnd = 0;
    const underline = invalidSegments.reduce((acc, segment) => {
      const spaces = " ".repeat(segment.start - lastEnd);
      const arrows = "^".repeat(segment.length);
      lastEnd = segment.start + segment.length;
      return acc + spaces + arrows;
    }, "");
    throw new OpenAIError(`Path parameters result in path with invalid segments:
${invalidSegments.map((e) => e.error).join("\n")}
${path3}
${underline}`);
  }
  return path3;
};
var path = /* @__PURE__ */ createPathTagFunction(encodeURIPath);

// node_modules/openai/resources/chat/completions/messages.mjs
var Messages = class extends APIResource {
  /**
   * Get the messages in a stored chat completion. Only Chat Completions that have
   * been created with the `store` parameter set to `true` will be returned.
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const chatCompletionStoreMessage of client.chat.completions.messages.list(
   *   'completion_id',
   * )) {
   *   // ...
   * }
   * ```
   */
  list(completionID, query = {}, options) {
    return this._client.getAPIList(path`/chat/completions/${completionID}/messages`, CursorPage, { query, ...options });
  }
};

// node_modules/openai/lib/parser.mjs
function isChatCompletionFunctionTool(tool) {
  return tool !== void 0 && "function" in tool && tool.function !== void 0;
}
function isAutoParsableResponseFormat(response_format) {
  return response_format?.["$brand"] === "auto-parseable-response-format";
}
function isAutoParsableTool(tool) {
  return tool?.["$brand"] === "auto-parseable-tool";
}
function maybeParseChatCompletion(completion, params) {
  if (!params || !hasAutoParseableInput(params)) {
    return {
      ...completion,
      choices: completion.choices.map((choice) => {
        assertToolCallsAreChatCompletionFunctionToolCalls(choice.message.tool_calls);
        return {
          ...choice,
          message: {
            ...choice.message,
            parsed: null,
            ...choice.message.tool_calls ? {
              tool_calls: choice.message.tool_calls
            } : void 0
          }
        };
      })
    };
  }
  return parseChatCompletion(completion, params);
}
function parseChatCompletion(completion, params) {
  const choices = completion.choices.map((choice) => {
    if (choice.finish_reason === "length") {
      throw new LengthFinishReasonError();
    }
    if (choice.finish_reason === "content_filter") {
      throw new ContentFilterFinishReasonError();
    }
    assertToolCallsAreChatCompletionFunctionToolCalls(choice.message.tool_calls);
    return {
      ...choice,
      message: {
        ...choice.message,
        ...choice.message.tool_calls ? {
          tool_calls: choice.message.tool_calls?.map((toolCall) => parseToolCall(params, toolCall)) ?? void 0
        } : void 0,
        parsed: choice.message.content && !choice.message.refusal ? parseResponseFormat(params, choice.message.content) : null
      }
    };
  });
  return { ...completion, choices };
}
function parseResponseFormat(params, content) {
  if (params.response_format?.type !== "json_schema") {
    return null;
  }
  if (params.response_format?.type === "json_schema") {
    if ("$parseRaw" in params.response_format) {
      const response_format = params.response_format;
      return response_format.$parseRaw(content);
    }
    return JSON.parse(content);
  }
  return null;
}
function parseToolCall(params, toolCall) {
  const inputTool = params.tools?.find((inputTool2) => isChatCompletionFunctionTool(inputTool2) && inputTool2.function?.name === toolCall.function.name);
  return {
    ...toolCall,
    function: {
      ...toolCall.function,
      parsed_arguments: isAutoParsableTool(inputTool) ? inputTool.$parseRaw(toolCall.function.arguments) : inputTool?.function.strict ? JSON.parse(toolCall.function.arguments) : null
    }
  };
}
function shouldParseToolCall(params, toolCall) {
  if (!params || !("tools" in params) || !params.tools) {
    return false;
  }
  const inputTool = params.tools?.find((inputTool2) => isChatCompletionFunctionTool(inputTool2) && inputTool2.function?.name === toolCall.function.name);
  return isChatCompletionFunctionTool(inputTool) && (isAutoParsableTool(inputTool) || inputTool?.function.strict || false);
}
function hasAutoParseableInput(params) {
  if (isAutoParsableResponseFormat(params.response_format)) {
    return true;
  }
  return params.tools?.some((t) => isAutoParsableTool(t) || t.type === "function" && t.function.strict === true) ?? false;
}
function assertToolCallsAreChatCompletionFunctionToolCalls(toolCalls) {
  for (const toolCall of toolCalls || []) {
    if (toolCall.type !== "function") {
      throw new OpenAIError(`Currently only \`function\` tool calls are supported; Received \`${toolCall.type}\``);
    }
  }
}
function validateInputTools(tools) {
  for (const tool of tools ?? []) {
    if (tool.type !== "function") {
      throw new OpenAIError(`Currently only \`function\` tool types support auto-parsing; Received \`${tool.type}\``);
    }
    if (tool.function.strict !== true) {
      throw new OpenAIError(`The \`${tool.function.name}\` tool is not marked with \`strict: true\`. Only strict function tools can be auto-parsed`);
    }
  }
}

// node_modules/openai/lib/chatCompletionUtils.mjs
var isAssistantMessage = (message) => {
  return message?.role === "assistant";
};
var isToolMessage = (message) => {
  return message?.role === "tool";
};

// node_modules/openai/lib/EventStream.mjs
var _EventStream_instances;
var _EventStream_connectedPromise;
var _EventStream_resolveConnectedPromise;
var _EventStream_rejectConnectedPromise;
var _EventStream_endPromise;
var _EventStream_resolveEndPromise;
var _EventStream_rejectEndPromise;
var _EventStream_listeners;
var _EventStream_ended;
var _EventStream_errored;
var _EventStream_aborted;
var _EventStream_catchingPromiseCreated;
var _EventStream_handleError;
var EventStream = class {
  constructor() {
    _EventStream_instances.add(this);
    this.controller = new AbortController();
    _EventStream_connectedPromise.set(this, void 0);
    _EventStream_resolveConnectedPromise.set(this, () => {
    });
    _EventStream_rejectConnectedPromise.set(this, () => {
    });
    _EventStream_endPromise.set(this, void 0);
    _EventStream_resolveEndPromise.set(this, () => {
    });
    _EventStream_rejectEndPromise.set(this, () => {
    });
    _EventStream_listeners.set(this, {});
    _EventStream_ended.set(this, false);
    _EventStream_errored.set(this, false);
    _EventStream_aborted.set(this, false);
    _EventStream_catchingPromiseCreated.set(this, false);
    __classPrivateFieldSet(this, _EventStream_connectedPromise, new Promise((resolve, reject) => {
      __classPrivateFieldSet(this, _EventStream_resolveConnectedPromise, resolve, "f");
      __classPrivateFieldSet(this, _EventStream_rejectConnectedPromise, reject, "f");
    }), "f");
    __classPrivateFieldSet(this, _EventStream_endPromise, new Promise((resolve, reject) => {
      __classPrivateFieldSet(this, _EventStream_resolveEndPromise, resolve, "f");
      __classPrivateFieldSet(this, _EventStream_rejectEndPromise, reject, "f");
    }), "f");
    __classPrivateFieldGet(this, _EventStream_connectedPromise, "f").catch(() => {
    });
    __classPrivateFieldGet(this, _EventStream_endPromise, "f").catch(() => {
    });
  }
  _run(executor) {
    setTimeout(() => {
      executor().then(() => {
        this._emitFinal();
        this._emit("end");
      }, __classPrivateFieldGet(this, _EventStream_instances, "m", _EventStream_handleError).bind(this));
    }, 0);
  }
  _connected() {
    if (this.ended)
      return;
    __classPrivateFieldGet(this, _EventStream_resolveConnectedPromise, "f").call(this);
    this._emit("connect");
  }
  get ended() {
    return __classPrivateFieldGet(this, _EventStream_ended, "f");
  }
  get errored() {
    return __classPrivateFieldGet(this, _EventStream_errored, "f");
  }
  get aborted() {
    return __classPrivateFieldGet(this, _EventStream_aborted, "f");
  }
  abort() {
    this.controller.abort();
  }
  /**
   * Adds the listener function to the end of the listeners array for the event.
   * No checks are made to see if the listener has already been added. Multiple calls passing
   * the same combination of event and listener will result in the listener being added, and
   * called, multiple times.
   * @returns this ChatCompletionStream, so that calls can be chained
   */
  on(event, listener) {
    const listeners = __classPrivateFieldGet(this, _EventStream_listeners, "f")[event] || (__classPrivateFieldGet(this, _EventStream_listeners, "f")[event] = []);
    listeners.push({ listener });
    return this;
  }
  /**
   * Removes the specified listener from the listener array for the event.
   * off() will remove, at most, one instance of a listener from the listener array. If any single
   * listener has been added multiple times to the listener array for the specified event, then
   * off() must be called multiple times to remove each instance.
   * @returns this ChatCompletionStream, so that calls can be chained
   */
  off(event, listener) {
    const listeners = __classPrivateFieldGet(this, _EventStream_listeners, "f")[event];
    if (!listeners)
      return this;
    const index = listeners.findIndex((l) => l.listener === listener);
    if (index >= 0)
      listeners.splice(index, 1);
    return this;
  }
  /**
   * Adds a one-time listener function for the event. The next time the event is triggered,
   * this listener is removed and then invoked.
   * @returns this ChatCompletionStream, so that calls can be chained
   */
  once(event, listener) {
    const listeners = __classPrivateFieldGet(this, _EventStream_listeners, "f")[event] || (__classPrivateFieldGet(this, _EventStream_listeners, "f")[event] = []);
    listeners.push({ listener, once: true });
    return this;
  }
  /**
   * This is similar to `.once()`, but returns a Promise that resolves the next time
   * the event is triggered, instead of calling a listener callback.
   * @returns a Promise that resolves the next time given event is triggered,
   * or rejects if an error is emitted.  (If you request the 'error' event,
   * returns a promise that resolves with the error).
   *
   * Example:
   *
   *   const message = await stream.emitted('message') // rejects if the stream errors
   */
  emitted(event) {
    return new Promise((resolve, reject) => {
      __classPrivateFieldSet(this, _EventStream_catchingPromiseCreated, true, "f");
      if (event !== "error")
        this.once("error", reject);
      this.once(event, resolve);
    });
  }
  async done() {
    __classPrivateFieldSet(this, _EventStream_catchingPromiseCreated, true, "f");
    await __classPrivateFieldGet(this, _EventStream_endPromise, "f");
  }
  _emit(event, ...args) {
    if (__classPrivateFieldGet(this, _EventStream_ended, "f")) {
      return;
    }
    if (event === "end") {
      __classPrivateFieldSet(this, _EventStream_ended, true, "f");
      __classPrivateFieldGet(this, _EventStream_resolveEndPromise, "f").call(this);
    }
    const listeners = __classPrivateFieldGet(this, _EventStream_listeners, "f")[event];
    if (listeners) {
      __classPrivateFieldGet(this, _EventStream_listeners, "f")[event] = listeners.filter((l) => !l.once);
      listeners.forEach(({ listener }) => listener(...args));
    }
    if (event === "abort") {
      const error = args[0];
      if (!__classPrivateFieldGet(this, _EventStream_catchingPromiseCreated, "f") && !listeners?.length) {
        Promise.reject(error);
      }
      __classPrivateFieldGet(this, _EventStream_rejectConnectedPromise, "f").call(this, error);
      __classPrivateFieldGet(this, _EventStream_rejectEndPromise, "f").call(this, error);
      this._emit("end");
      return;
    }
    if (event === "error") {
      const error = args[0];
      if (!__classPrivateFieldGet(this, _EventStream_catchingPromiseCreated, "f") && !listeners?.length) {
        Promise.reject(error);
      }
      __classPrivateFieldGet(this, _EventStream_rejectConnectedPromise, "f").call(this, error);
      __classPrivateFieldGet(this, _EventStream_rejectEndPromise, "f").call(this, error);
      this._emit("end");
    }
  }
  _emitFinal() {
  }
};
_EventStream_connectedPromise = /* @__PURE__ */ new WeakMap(), _EventStream_resolveConnectedPromise = /* @__PURE__ */ new WeakMap(), _EventStream_rejectConnectedPromise = /* @__PURE__ */ new WeakMap(), _EventStream_endPromise = /* @__PURE__ */ new WeakMap(), _EventStream_resolveEndPromise = /* @__PURE__ */ new WeakMap(), _EventStream_rejectEndPromise = /* @__PURE__ */ new WeakMap(), _EventStream_listeners = /* @__PURE__ */ new WeakMap(), _EventStream_ended = /* @__PURE__ */ new WeakMap(), _EventStream_errored = /* @__PURE__ */ new WeakMap(), _EventStream_aborted = /* @__PURE__ */ new WeakMap(), _EventStream_catchingPromiseCreated = /* @__PURE__ */ new WeakMap(), _EventStream_instances = /* @__PURE__ */ new WeakSet(), _EventStream_handleError = function _EventStream_handleError2(error) {
  __classPrivateFieldSet(this, _EventStream_errored, true, "f");
  if (error instanceof Error && error.name === "AbortError") {
    error = new APIUserAbortError();
  }
  if (error instanceof APIUserAbortError) {
    __classPrivateFieldSet(this, _EventStream_aborted, true, "f");
    return this._emit("abort", error);
  }
  if (error instanceof OpenAIError) {
    return this._emit("error", error);
  }
  if (error instanceof Error) {
    const openAIError = new OpenAIError(error.message);
    openAIError.cause = error;
    return this._emit("error", openAIError);
  }
  return this._emit("error", new OpenAIError(String(error)));
};

// node_modules/openai/lib/RunnableFunction.mjs
function isRunnableFunctionWithParse(fn) {
  return typeof fn.parse === "function";
}

// node_modules/openai/lib/AbstractChatCompletionRunner.mjs
var _AbstractChatCompletionRunner_instances;
var _AbstractChatCompletionRunner_getFinalContent;
var _AbstractChatCompletionRunner_getFinalMessage;
var _AbstractChatCompletionRunner_getFinalFunctionToolCall;
var _AbstractChatCompletionRunner_getFinalFunctionToolCallResult;
var _AbstractChatCompletionRunner_calculateTotalUsage;
var _AbstractChatCompletionRunner_validateParams;
var _AbstractChatCompletionRunner_stringifyFunctionCallResult;
var DEFAULT_MAX_CHAT_COMPLETIONS = 10;
var AbstractChatCompletionRunner = class extends EventStream {
  constructor() {
    super(...arguments);
    _AbstractChatCompletionRunner_instances.add(this);
    this._chatCompletions = [];
    this.messages = [];
  }
  _addChatCompletion(chatCompletion) {
    this._chatCompletions.push(chatCompletion);
    this._emit("chatCompletion", chatCompletion);
    const message = chatCompletion.choices[0]?.message;
    if (message)
      this._addMessage(message);
    return chatCompletion;
  }
  _addMessage(message, emit = true) {
    if (!("content" in message))
      message.content = null;
    this.messages.push(message);
    if (emit) {
      this._emit("message", message);
      if (isToolMessage(message) && message.content) {
        this._emit("functionToolCallResult", message.content);
      } else if (isAssistantMessage(message) && message.tool_calls) {
        for (const tool_call of message.tool_calls) {
          if (tool_call.type === "function") {
            this._emit("functionToolCall", tool_call.function);
          }
        }
      }
    }
  }
  /**
   * @returns a promise that resolves with the final ChatCompletion, or rejects
   * if an error occurred or the stream ended prematurely without producing a ChatCompletion.
   */
  async finalChatCompletion() {
    await this.done();
    const completion = this._chatCompletions[this._chatCompletions.length - 1];
    if (!completion)
      throw new OpenAIError("stream ended without producing a ChatCompletion");
    return completion;
  }
  /**
   * @returns a promise that resolves with the content of the final ChatCompletionMessage, or rejects
   * if an error occurred or the stream ended prematurely without producing a ChatCompletionMessage.
   */
  async finalContent() {
    await this.done();
    return __classPrivateFieldGet(this, _AbstractChatCompletionRunner_instances, "m", _AbstractChatCompletionRunner_getFinalContent).call(this);
  }
  /**
   * @returns a promise that resolves with the the final assistant ChatCompletionMessage response,
   * or rejects if an error occurred or the stream ended prematurely without producing a ChatCompletionMessage.
   */
  async finalMessage() {
    await this.done();
    return __classPrivateFieldGet(this, _AbstractChatCompletionRunner_instances, "m", _AbstractChatCompletionRunner_getFinalMessage).call(this);
  }
  /**
   * @returns a promise that resolves with the content of the final FunctionCall, or rejects
   * if an error occurred or the stream ended prematurely without producing a ChatCompletionMessage.
   */
  async finalFunctionToolCall() {
    await this.done();
    return __classPrivateFieldGet(this, _AbstractChatCompletionRunner_instances, "m", _AbstractChatCompletionRunner_getFinalFunctionToolCall).call(this);
  }
  async finalFunctionToolCallResult() {
    await this.done();
    return __classPrivateFieldGet(this, _AbstractChatCompletionRunner_instances, "m", _AbstractChatCompletionRunner_getFinalFunctionToolCallResult).call(this);
  }
  async totalUsage() {
    await this.done();
    return __classPrivateFieldGet(this, _AbstractChatCompletionRunner_instances, "m", _AbstractChatCompletionRunner_calculateTotalUsage).call(this);
  }
  allChatCompletions() {
    return [...this._chatCompletions];
  }
  _emitFinal() {
    const completion = this._chatCompletions[this._chatCompletions.length - 1];
    if (completion)
      this._emit("finalChatCompletion", completion);
    const finalMessage = __classPrivateFieldGet(this, _AbstractChatCompletionRunner_instances, "m", _AbstractChatCompletionRunner_getFinalMessage).call(this);
    if (finalMessage)
      this._emit("finalMessage", finalMessage);
    const finalContent = __classPrivateFieldGet(this, _AbstractChatCompletionRunner_instances, "m", _AbstractChatCompletionRunner_getFinalContent).call(this);
    if (finalContent)
      this._emit("finalContent", finalContent);
    const finalFunctionCall = __classPrivateFieldGet(this, _AbstractChatCompletionRunner_instances, "m", _AbstractChatCompletionRunner_getFinalFunctionToolCall).call(this);
    if (finalFunctionCall)
      this._emit("finalFunctionToolCall", finalFunctionCall);
    const finalFunctionCallResult = __classPrivateFieldGet(this, _AbstractChatCompletionRunner_instances, "m", _AbstractChatCompletionRunner_getFinalFunctionToolCallResult).call(this);
    if (finalFunctionCallResult != null)
      this._emit("finalFunctionToolCallResult", finalFunctionCallResult);
    if (this._chatCompletions.some((c) => c.usage)) {
      this._emit("totalUsage", __classPrivateFieldGet(this, _AbstractChatCompletionRunner_instances, "m", _AbstractChatCompletionRunner_calculateTotalUsage).call(this));
    }
  }
  async _createChatCompletion(client, params, options) {
    const signal = options?.signal;
    if (signal) {
      if (signal.aborted)
        this.controller.abort();
      signal.addEventListener("abort", () => this.controller.abort());
    }
    __classPrivateFieldGet(this, _AbstractChatCompletionRunner_instances, "m", _AbstractChatCompletionRunner_validateParams).call(this, params);
    const chatCompletion = await client.chat.completions.create({ ...params, stream: false }, { ...options, signal: this.controller.signal });
    this._connected();
    return this._addChatCompletion(parseChatCompletion(chatCompletion, params));
  }
  async _runChatCompletion(client, params, options) {
    for (const message of params.messages) {
      this._addMessage(message, false);
    }
    return await this._createChatCompletion(client, params, options);
  }
  async _runTools(client, params, options) {
    const role = "tool";
    const { tool_choice = "auto", stream, ...restParams } = params;
    const singleFunctionToCall = typeof tool_choice !== "string" && tool_choice.type === "function" && tool_choice?.function?.name;
    const { maxChatCompletions = DEFAULT_MAX_CHAT_COMPLETIONS } = options || {};
    const inputTools = params.tools.map((tool) => {
      if (isAutoParsableTool(tool)) {
        if (!tool.$callback) {
          throw new OpenAIError("Tool given to `.runTools()` that does not have an associated function");
        }
        return {
          type: "function",
          function: {
            function: tool.$callback,
            name: tool.function.name,
            description: tool.function.description || "",
            parameters: tool.function.parameters,
            parse: tool.$parseRaw,
            strict: true
          }
        };
      }
      return tool;
    });
    const functionsByName = {};
    for (const f of inputTools) {
      if (f.type === "function") {
        functionsByName[f.function.name || f.function.function.name] = f.function;
      }
    }
    const tools = "tools" in params ? inputTools.map((t) => t.type === "function" ? {
      type: "function",
      function: {
        name: t.function.name || t.function.function.name,
        parameters: t.function.parameters,
        description: t.function.description,
        strict: t.function.strict
      }
    } : t) : void 0;
    for (const message of params.messages) {
      this._addMessage(message, false);
    }
    for (let i = 0; i < maxChatCompletions; ++i) {
      const chatCompletion = await this._createChatCompletion(client, {
        ...restParams,
        tool_choice,
        tools,
        messages: [...this.messages]
      }, options);
      const message = chatCompletion.choices[0]?.message;
      if (!message) {
        throw new OpenAIError(`missing message in ChatCompletion response`);
      }
      if (!message.tool_calls?.length) {
        return;
      }
      for (const tool_call of message.tool_calls) {
        if (tool_call.type !== "function")
          continue;
        const tool_call_id = tool_call.id;
        const { name, arguments: args } = tool_call.function;
        const fn = functionsByName[name];
        if (!fn) {
          const content2 = `Invalid tool_call: ${JSON.stringify(name)}. Available options are: ${Object.keys(functionsByName).map((name2) => JSON.stringify(name2)).join(", ")}. Please try again`;
          this._addMessage({ role, tool_call_id, content: content2 });
          continue;
        } else if (singleFunctionToCall && singleFunctionToCall !== name) {
          const content2 = `Invalid tool_call: ${JSON.stringify(name)}. ${JSON.stringify(singleFunctionToCall)} requested. Please try again`;
          this._addMessage({ role, tool_call_id, content: content2 });
          continue;
        }
        let parsed;
        try {
          parsed = isRunnableFunctionWithParse(fn) ? await fn.parse(args) : args;
        } catch (error) {
          const content2 = error instanceof Error ? error.message : String(error);
          this._addMessage({ role, tool_call_id, content: content2 });
          continue;
        }
        const rawContent = await fn.function(parsed, this);
        const content = __classPrivateFieldGet(this, _AbstractChatCompletionRunner_instances, "m", _AbstractChatCompletionRunner_stringifyFunctionCallResult).call(this, rawContent);
        this._addMessage({ role, tool_call_id, content });
        if (singleFunctionToCall) {
          return;
        }
      }
    }
    return;
  }
};
_AbstractChatCompletionRunner_instances = /* @__PURE__ */ new WeakSet(), _AbstractChatCompletionRunner_getFinalContent = function _AbstractChatCompletionRunner_getFinalContent2() {
  return __classPrivateFieldGet(this, _AbstractChatCompletionRunner_instances, "m", _AbstractChatCompletionRunner_getFinalMessage).call(this).content ?? null;
}, _AbstractChatCompletionRunner_getFinalMessage = function _AbstractChatCompletionRunner_getFinalMessage2() {
  let i = this.messages.length;
  while (i-- > 0) {
    const message = this.messages[i];
    if (isAssistantMessage(message)) {
      const ret = {
        ...message,
        content: message.content ?? null,
        refusal: message.refusal ?? null
      };
      return ret;
    }
  }
  throw new OpenAIError("stream ended without producing a ChatCompletionMessage with role=assistant");
}, _AbstractChatCompletionRunner_getFinalFunctionToolCall = function _AbstractChatCompletionRunner_getFinalFunctionToolCall2() {
  for (let i = this.messages.length - 1; i >= 0; i--) {
    const message = this.messages[i];
    if (isAssistantMessage(message) && message?.tool_calls?.length) {
      return message.tool_calls.filter((x) => x.type === "function").at(-1)?.function;
    }
  }
  return;
}, _AbstractChatCompletionRunner_getFinalFunctionToolCallResult = function _AbstractChatCompletionRunner_getFinalFunctionToolCallResult2() {
  for (let i = this.messages.length - 1; i >= 0; i--) {
    const message = this.messages[i];
    if (isToolMessage(message) && message.content != null && typeof message.content === "string" && this.messages.some((x) => x.role === "assistant" && x.tool_calls?.some((y) => y.type === "function" && y.id === message.tool_call_id))) {
      return message.content;
    }
  }
  return;
}, _AbstractChatCompletionRunner_calculateTotalUsage = function _AbstractChatCompletionRunner_calculateTotalUsage2() {
  const total = {
    completion_tokens: 0,
    prompt_tokens: 0,
    total_tokens: 0
  };
  for (const { usage } of this._chatCompletions) {
    if (usage) {
      total.completion_tokens += usage.completion_tokens;
      total.prompt_tokens += usage.prompt_tokens;
      total.total_tokens += usage.total_tokens;
    }
  }
  return total;
}, _AbstractChatCompletionRunner_validateParams = function _AbstractChatCompletionRunner_validateParams2(params) {
  if (params.n != null && params.n > 1) {
    throw new OpenAIError("ChatCompletion convenience helpers only support n=1 at this time. To use n>1, please use chat.completions.create() directly.");
  }
}, _AbstractChatCompletionRunner_stringifyFunctionCallResult = function _AbstractChatCompletionRunner_stringifyFunctionCallResult2(rawContent) {
  return typeof rawContent === "string" ? rawContent : rawContent === void 0 ? "undefined" : JSON.stringify(rawContent);
};

// node_modules/openai/lib/ChatCompletionRunner.mjs
var ChatCompletionRunner = class _ChatCompletionRunner extends AbstractChatCompletionRunner {
  static runTools(client, params, options) {
    const runner = new _ChatCompletionRunner();
    const opts = {
      ...options,
      headers: { ...options?.headers, "X-Stainless-Helper-Method": "runTools" }
    };
    runner._run(() => runner._runTools(client, params, opts));
    return runner;
  }
  _addMessage(message, emit = true) {
    super._addMessage(message, emit);
    if (isAssistantMessage(message) && message.content) {
      this._emit("content", message.content);
    }
  }
};

// node_modules/openai/_vendor/partial-json-parser/parser.mjs
var STR = 1;
var NUM = 2;
var ARR = 4;
var OBJ = 8;
var NULL = 16;
var BOOL = 32;
var NAN = 64;
var INFINITY = 128;
var MINUS_INFINITY = 256;
var INF = INFINITY | MINUS_INFINITY;
var SPECIAL = NULL | BOOL | INF | NAN;
var ATOM = STR | NUM | SPECIAL;
var COLLECTION = ARR | OBJ;
var ALL = ATOM | COLLECTION;
var Allow = {
  STR,
  NUM,
  ARR,
  OBJ,
  NULL,
  BOOL,
  NAN,
  INFINITY,
  MINUS_INFINITY,
  INF,
  SPECIAL,
  ATOM,
  COLLECTION,
  ALL
};
var PartialJSON = class extends Error {
};
var MalformedJSON = class extends Error {
};
function parseJSON(jsonString, allowPartial = Allow.ALL) {
  if (typeof jsonString !== "string") {
    throw new TypeError(`expecting str, got ${typeof jsonString}`);
  }
  if (!jsonString.trim()) {
    throw new Error(`${jsonString} is empty`);
  }
  return _parseJSON(jsonString.trim(), allowPartial);
}
var _parseJSON = (jsonString, allow) => {
  const length = jsonString.length;
  let index = 0;
  const markPartialJSON = (msg) => {
    throw new PartialJSON(`${msg} at position ${index}`);
  };
  const throwMalformedError = (msg) => {
    throw new MalformedJSON(`${msg} at position ${index}`);
  };
  const parseAny = () => {
    skipBlank();
    if (index >= length)
      markPartialJSON("Unexpected end of input");
    if (jsonString[index] === '"')
      return parseStr();
    if (jsonString[index] === "{")
      return parseObj();
    if (jsonString[index] === "[")
      return parseArr();
    if (jsonString.substring(index, index + 4) === "null" || Allow.NULL & allow && length - index < 4 && "null".startsWith(jsonString.substring(index))) {
      index += 4;
      return null;
    }
    if (jsonString.substring(index, index + 4) === "true" || Allow.BOOL & allow && length - index < 4 && "true".startsWith(jsonString.substring(index))) {
      index += 4;
      return true;
    }
    if (jsonString.substring(index, index + 5) === "false" || Allow.BOOL & allow && length - index < 5 && "false".startsWith(jsonString.substring(index))) {
      index += 5;
      return false;
    }
    if (jsonString.substring(index, index + 8) === "Infinity" || Allow.INFINITY & allow && length - index < 8 && "Infinity".startsWith(jsonString.substring(index))) {
      index += 8;
      return Infinity;
    }
    if (jsonString.substring(index, index + 9) === "-Infinity" || Allow.MINUS_INFINITY & allow && 1 < length - index && length - index < 9 && "-Infinity".startsWith(jsonString.substring(index))) {
      index += 9;
      return -Infinity;
    }
    if (jsonString.substring(index, index + 3) === "NaN" || Allow.NAN & allow && length - index < 3 && "NaN".startsWith(jsonString.substring(index))) {
      index += 3;
      return NaN;
    }
    return parseNum();
  };
  const parseStr = () => {
    const start = index;
    let escape2 = false;
    index++;
    while (index < length && (jsonString[index] !== '"' || escape2 && jsonString[index - 1] === "\\")) {
      escape2 = jsonString[index] === "\\" ? !escape2 : false;
      index++;
    }
    if (jsonString.charAt(index) == '"') {
      try {
        return JSON.parse(jsonString.substring(start, ++index - Number(escape2)));
      } catch (e) {
        throwMalformedError(String(e));
      }
    } else if (Allow.STR & allow) {
      try {
        return JSON.parse(jsonString.substring(start, index - Number(escape2)) + '"');
      } catch (e) {
        return JSON.parse(jsonString.substring(start, jsonString.lastIndexOf("\\")) + '"');
      }
    }
    markPartialJSON("Unterminated string literal");
  };
  const parseObj = () => {
    index++;
    skipBlank();
    const obj = {};
    try {
      while (jsonString[index] !== "}") {
        skipBlank();
        if (index >= length && Allow.OBJ & allow)
          return obj;
        const key = parseStr();
        skipBlank();
        index++;
        try {
          const value = parseAny();
          Object.defineProperty(obj, key, { value, writable: true, enumerable: true, configurable: true });
        } catch (e) {
          if (Allow.OBJ & allow)
            return obj;
          else
            throw e;
        }
        skipBlank();
        if (jsonString[index] === ",")
          index++;
      }
    } catch (e) {
      if (Allow.OBJ & allow)
        return obj;
      else
        markPartialJSON("Expected '}' at end of object");
    }
    index++;
    return obj;
  };
  const parseArr = () => {
    index++;
    const arr = [];
    try {
      while (jsonString[index] !== "]") {
        arr.push(parseAny());
        skipBlank();
        if (jsonString[index] === ",") {
          index++;
        }
      }
    } catch (e) {
      if (Allow.ARR & allow) {
        return arr;
      }
      markPartialJSON("Expected ']' at end of array");
    }
    index++;
    return arr;
  };
  const parseNum = () => {
    if (index === 0) {
      if (jsonString === "-" && Allow.NUM & allow)
        markPartialJSON("Not sure what '-' is");
      try {
        return JSON.parse(jsonString);
      } catch (e) {
        if (Allow.NUM & allow) {
          try {
            if ("." === jsonString[jsonString.length - 1])
              return JSON.parse(jsonString.substring(0, jsonString.lastIndexOf(".")));
            return JSON.parse(jsonString.substring(0, jsonString.lastIndexOf("e")));
          } catch (e2) {
          }
        }
        throwMalformedError(String(e));
      }
    }
    const start = index;
    if (jsonString[index] === "-")
      index++;
    while (jsonString[index] && !",]}".includes(jsonString[index]))
      index++;
    if (index == length && !(Allow.NUM & allow))
      markPartialJSON("Unterminated number literal");
    try {
      return JSON.parse(jsonString.substring(start, index));
    } catch (e) {
      if (jsonString.substring(start, index) === "-" && Allow.NUM & allow)
        markPartialJSON("Not sure what '-' is");
      try {
        return JSON.parse(jsonString.substring(start, jsonString.lastIndexOf("e")));
      } catch (e2) {
        throwMalformedError(String(e2));
      }
    }
  };
  const skipBlank = () => {
    while (index < length && " \n\r	".includes(jsonString[index])) {
      index++;
    }
  };
  return parseAny();
};
var partialParse = (input) => parseJSON(input, Allow.ALL ^ Allow.NUM);

// node_modules/openai/lib/ChatCompletionStream.mjs
var _ChatCompletionStream_instances;
var _ChatCompletionStream_params;
var _ChatCompletionStream_choiceEventStates;
var _ChatCompletionStream_currentChatCompletionSnapshot;
var _ChatCompletionStream_beginRequest;
var _ChatCompletionStream_getChoiceEventState;
var _ChatCompletionStream_addChunk;
var _ChatCompletionStream_emitToolCallDoneEvent;
var _ChatCompletionStream_emitContentDoneEvents;
var _ChatCompletionStream_endRequest;
var _ChatCompletionStream_getAutoParseableResponseFormat;
var _ChatCompletionStream_accumulateChatCompletion;
var ChatCompletionStream = class _ChatCompletionStream extends AbstractChatCompletionRunner {
  constructor(params) {
    super();
    _ChatCompletionStream_instances.add(this);
    _ChatCompletionStream_params.set(this, void 0);
    _ChatCompletionStream_choiceEventStates.set(this, void 0);
    _ChatCompletionStream_currentChatCompletionSnapshot.set(this, void 0);
    __classPrivateFieldSet(this, _ChatCompletionStream_params, params, "f");
    __classPrivateFieldSet(this, _ChatCompletionStream_choiceEventStates, [], "f");
  }
  get currentChatCompletionSnapshot() {
    return __classPrivateFieldGet(this, _ChatCompletionStream_currentChatCompletionSnapshot, "f");
  }
  /**
   * Intended for use on the frontend, consuming a stream produced with
   * `.toReadableStream()` on the backend.
   *
   * Note that messages sent to the model do not appear in `.on('message')`
   * in this context.
   */
  static fromReadableStream(stream) {
    const runner = new _ChatCompletionStream(null);
    runner._run(() => runner._fromReadableStream(stream));
    return runner;
  }
  static createChatCompletion(client, params, options) {
    const runner = new _ChatCompletionStream(params);
    runner._run(() => runner._runChatCompletion(client, { ...params, stream: true }, { ...options, headers: { ...options?.headers, "X-Stainless-Helper-Method": "stream" } }));
    return runner;
  }
  async _createChatCompletion(client, params, options) {
    super._createChatCompletion;
    const signal = options?.signal;
    if (signal) {
      if (signal.aborted)
        this.controller.abort();
      signal.addEventListener("abort", () => this.controller.abort());
    }
    __classPrivateFieldGet(this, _ChatCompletionStream_instances, "m", _ChatCompletionStream_beginRequest).call(this);
    const stream = await client.chat.completions.create({ ...params, stream: true }, { ...options, signal: this.controller.signal });
    this._connected();
    for await (const chunk of stream) {
      __classPrivateFieldGet(this, _ChatCompletionStream_instances, "m", _ChatCompletionStream_addChunk).call(this, chunk);
    }
    if (stream.controller.signal?.aborted) {
      throw new APIUserAbortError();
    }
    return this._addChatCompletion(__classPrivateFieldGet(this, _ChatCompletionStream_instances, "m", _ChatCompletionStream_endRequest).call(this));
  }
  async _fromReadableStream(readableStream, options) {
    const signal = options?.signal;
    if (signal) {
      if (signal.aborted)
        this.controller.abort();
      signal.addEventListener("abort", () => this.controller.abort());
    }
    __classPrivateFieldGet(this, _ChatCompletionStream_instances, "m", _ChatCompletionStream_beginRequest).call(this);
    this._connected();
    const stream = Stream.fromReadableStream(readableStream, this.controller);
    let chatId;
    for await (const chunk of stream) {
      if (chatId && chatId !== chunk.id) {
        this._addChatCompletion(__classPrivateFieldGet(this, _ChatCompletionStream_instances, "m", _ChatCompletionStream_endRequest).call(this));
      }
      __classPrivateFieldGet(this, _ChatCompletionStream_instances, "m", _ChatCompletionStream_addChunk).call(this, chunk);
      chatId = chunk.id;
    }
    if (stream.controller.signal?.aborted) {
      throw new APIUserAbortError();
    }
    return this._addChatCompletion(__classPrivateFieldGet(this, _ChatCompletionStream_instances, "m", _ChatCompletionStream_endRequest).call(this));
  }
  [(_ChatCompletionStream_params = /* @__PURE__ */ new WeakMap(), _ChatCompletionStream_choiceEventStates = /* @__PURE__ */ new WeakMap(), _ChatCompletionStream_currentChatCompletionSnapshot = /* @__PURE__ */ new WeakMap(), _ChatCompletionStream_instances = /* @__PURE__ */ new WeakSet(), _ChatCompletionStream_beginRequest = function _ChatCompletionStream_beginRequest2() {
    if (this.ended)
      return;
    __classPrivateFieldSet(this, _ChatCompletionStream_currentChatCompletionSnapshot, void 0, "f");
  }, _ChatCompletionStream_getChoiceEventState = function _ChatCompletionStream_getChoiceEventState2(choice) {
    let state = __classPrivateFieldGet(this, _ChatCompletionStream_choiceEventStates, "f")[choice.index];
    if (state) {
      return state;
    }
    state = {
      content_done: false,
      refusal_done: false,
      logprobs_content_done: false,
      logprobs_refusal_done: false,
      done_tool_calls: /* @__PURE__ */ new Set(),
      current_tool_call_index: null
    };
    __classPrivateFieldGet(this, _ChatCompletionStream_choiceEventStates, "f")[choice.index] = state;
    return state;
  }, _ChatCompletionStream_addChunk = function _ChatCompletionStream_addChunk2(chunk) {
    if (this.ended)
      return;
    const completion = __classPrivateFieldGet(this, _ChatCompletionStream_instances, "m", _ChatCompletionStream_accumulateChatCompletion).call(this, chunk);
    this._emit("chunk", chunk, completion);
    for (const choice of chunk.choices) {
      const choiceSnapshot = completion.choices[choice.index];
      if (choice.delta.content != null && choiceSnapshot.message?.role === "assistant" && choiceSnapshot.message?.content) {
        this._emit("content", choice.delta.content, choiceSnapshot.message.content);
        this._emit("content.delta", {
          delta: choice.delta.content,
          snapshot: choiceSnapshot.message.content,
          parsed: choiceSnapshot.message.parsed
        });
      }
      if (choice.delta.refusal != null && choiceSnapshot.message?.role === "assistant" && choiceSnapshot.message?.refusal) {
        this._emit("refusal.delta", {
          delta: choice.delta.refusal,
          snapshot: choiceSnapshot.message.refusal
        });
      }
      if (choice.logprobs?.content != null && choiceSnapshot.message?.role === "assistant") {
        this._emit("logprobs.content.delta", {
          content: choice.logprobs?.content,
          snapshot: choiceSnapshot.logprobs?.content ?? []
        });
      }
      if (choice.logprobs?.refusal != null && choiceSnapshot.message?.role === "assistant") {
        this._emit("logprobs.refusal.delta", {
          refusal: choice.logprobs?.refusal,
          snapshot: choiceSnapshot.logprobs?.refusal ?? []
        });
      }
      const state = __classPrivateFieldGet(this, _ChatCompletionStream_instances, "m", _ChatCompletionStream_getChoiceEventState).call(this, choiceSnapshot);
      if (choiceSnapshot.finish_reason) {
        __classPrivateFieldGet(this, _ChatCompletionStream_instances, "m", _ChatCompletionStream_emitContentDoneEvents).call(this, choiceSnapshot);
        if (state.current_tool_call_index != null) {
          __classPrivateFieldGet(this, _ChatCompletionStream_instances, "m", _ChatCompletionStream_emitToolCallDoneEvent).call(this, choiceSnapshot, state.current_tool_call_index);
        }
      }
      for (const toolCall of choice.delta.tool_calls ?? []) {
        if (state.current_tool_call_index !== toolCall.index) {
          __classPrivateFieldGet(this, _ChatCompletionStream_instances, "m", _ChatCompletionStream_emitContentDoneEvents).call(this, choiceSnapshot);
          if (state.current_tool_call_index != null) {
            __classPrivateFieldGet(this, _ChatCompletionStream_instances, "m", _ChatCompletionStream_emitToolCallDoneEvent).call(this, choiceSnapshot, state.current_tool_call_index);
          }
        }
        state.current_tool_call_index = toolCall.index;
      }
      for (const toolCallDelta of choice.delta.tool_calls ?? []) {
        const toolCallSnapshot = choiceSnapshot.message.tool_calls?.[toolCallDelta.index];
        if (!toolCallSnapshot?.type) {
          continue;
        }
        if (toolCallSnapshot?.type === "function") {
          this._emit("tool_calls.function.arguments.delta", {
            name: toolCallSnapshot.function?.name,
            index: toolCallDelta.index,
            arguments: toolCallSnapshot.function.arguments,
            parsed_arguments: toolCallSnapshot.function.parsed_arguments,
            arguments_delta: toolCallDelta.function?.arguments ?? ""
          });
        } else {
          assertNever(toolCallSnapshot?.type);
        }
      }
    }
  }, _ChatCompletionStream_emitToolCallDoneEvent = function _ChatCompletionStream_emitToolCallDoneEvent2(choiceSnapshot, toolCallIndex) {
    const state = __classPrivateFieldGet(this, _ChatCompletionStream_instances, "m", _ChatCompletionStream_getChoiceEventState).call(this, choiceSnapshot);
    if (state.done_tool_calls.has(toolCallIndex)) {
      return;
    }
    const toolCallSnapshot = choiceSnapshot.message.tool_calls?.[toolCallIndex];
    if (!toolCallSnapshot) {
      throw new Error("no tool call snapshot");
    }
    if (!toolCallSnapshot.type) {
      throw new Error("tool call snapshot missing `type`");
    }
    if (toolCallSnapshot.type === "function") {
      const inputTool = __classPrivateFieldGet(this, _ChatCompletionStream_params, "f")?.tools?.find((tool) => isChatCompletionFunctionTool(tool) && tool.function.name === toolCallSnapshot.function.name);
      this._emit("tool_calls.function.arguments.done", {
        name: toolCallSnapshot.function.name,
        index: toolCallIndex,
        arguments: toolCallSnapshot.function.arguments,
        parsed_arguments: isAutoParsableTool(inputTool) ? inputTool.$parseRaw(toolCallSnapshot.function.arguments) : inputTool?.function.strict ? JSON.parse(toolCallSnapshot.function.arguments) : null
      });
    } else {
      assertNever(toolCallSnapshot.type);
    }
  }, _ChatCompletionStream_emitContentDoneEvents = function _ChatCompletionStream_emitContentDoneEvents2(choiceSnapshot) {
    const state = __classPrivateFieldGet(this, _ChatCompletionStream_instances, "m", _ChatCompletionStream_getChoiceEventState).call(this, choiceSnapshot);
    if (choiceSnapshot.message.content && !state.content_done) {
      state.content_done = true;
      const responseFormat = __classPrivateFieldGet(this, _ChatCompletionStream_instances, "m", _ChatCompletionStream_getAutoParseableResponseFormat).call(this);
      this._emit("content.done", {
        content: choiceSnapshot.message.content,
        parsed: responseFormat ? responseFormat.$parseRaw(choiceSnapshot.message.content) : null
      });
    }
    if (choiceSnapshot.message.refusal && !state.refusal_done) {
      state.refusal_done = true;
      this._emit("refusal.done", { refusal: choiceSnapshot.message.refusal });
    }
    if (choiceSnapshot.logprobs?.content && !state.logprobs_content_done) {
      state.logprobs_content_done = true;
      this._emit("logprobs.content.done", { content: choiceSnapshot.logprobs.content });
    }
    if (choiceSnapshot.logprobs?.refusal && !state.logprobs_refusal_done) {
      state.logprobs_refusal_done = true;
      this._emit("logprobs.refusal.done", { refusal: choiceSnapshot.logprobs.refusal });
    }
  }, _ChatCompletionStream_endRequest = function _ChatCompletionStream_endRequest2() {
    if (this.ended) {
      throw new OpenAIError(`stream has ended, this shouldn't happen`);
    }
    const snapshot = __classPrivateFieldGet(this, _ChatCompletionStream_currentChatCompletionSnapshot, "f");
    if (!snapshot) {
      throw new OpenAIError(`request ended without sending any chunks`);
    }
    __classPrivateFieldSet(this, _ChatCompletionStream_currentChatCompletionSnapshot, void 0, "f");
    __classPrivateFieldSet(this, _ChatCompletionStream_choiceEventStates, [], "f");
    return finalizeChatCompletion(snapshot, __classPrivateFieldGet(this, _ChatCompletionStream_params, "f"));
  }, _ChatCompletionStream_getAutoParseableResponseFormat = function _ChatCompletionStream_getAutoParseableResponseFormat2() {
    const responseFormat = __classPrivateFieldGet(this, _ChatCompletionStream_params, "f")?.response_format;
    if (isAutoParsableResponseFormat(responseFormat)) {
      return responseFormat;
    }
    return null;
  }, _ChatCompletionStream_accumulateChatCompletion = function _ChatCompletionStream_accumulateChatCompletion2(chunk) {
    var _a3, _b, _c, _d;
    let snapshot = __classPrivateFieldGet(this, _ChatCompletionStream_currentChatCompletionSnapshot, "f");
    const { choices, ...rest } = chunk;
    if (!snapshot) {
      snapshot = __classPrivateFieldSet(this, _ChatCompletionStream_currentChatCompletionSnapshot, {
        ...rest,
        choices: []
      }, "f");
    } else {
      Object.assign(snapshot, rest);
    }
    for (const { delta, finish_reason, index, logprobs = null, ...other } of chunk.choices) {
      let choice = snapshot.choices[index];
      if (!choice) {
        choice = snapshot.choices[index] = { finish_reason, index, message: {}, logprobs, ...other };
      }
      if (logprobs) {
        if (!choice.logprobs) {
          choice.logprobs = Object.assign({}, logprobs);
        } else {
          const { content: content2, refusal: refusal2, ...rest3 } = logprobs;
          assertIsEmpty(rest3);
          Object.assign(choice.logprobs, rest3);
          if (content2) {
            (_a3 = choice.logprobs).content ?? (_a3.content = []);
            choice.logprobs.content.push(...content2);
          }
          if (refusal2) {
            (_b = choice.logprobs).refusal ?? (_b.refusal = []);
            choice.logprobs.refusal.push(...refusal2);
          }
        }
      }
      if (finish_reason) {
        choice.finish_reason = finish_reason;
        if (__classPrivateFieldGet(this, _ChatCompletionStream_params, "f") && hasAutoParseableInput(__classPrivateFieldGet(this, _ChatCompletionStream_params, "f"))) {
          if (finish_reason === "length") {
            throw new LengthFinishReasonError();
          }
          if (finish_reason === "content_filter") {
            throw new ContentFilterFinishReasonError();
          }
        }
      }
      Object.assign(choice, other);
      if (!delta)
        continue;
      const { content, refusal, function_call, role, tool_calls, ...rest2 } = delta;
      assertIsEmpty(rest2);
      Object.assign(choice.message, rest2);
      if (refusal) {
        choice.message.refusal = (choice.message.refusal || "") + refusal;
      }
      if (role)
        choice.message.role = role;
      if (function_call) {
        if (!choice.message.function_call) {
          choice.message.function_call = function_call;
        } else {
          if (function_call.name)
            choice.message.function_call.name = function_call.name;
          if (function_call.arguments) {
            (_c = choice.message.function_call).arguments ?? (_c.arguments = "");
            choice.message.function_call.arguments += function_call.arguments;
          }
        }
      }
      if (content) {
        choice.message.content = (choice.message.content || "") + content;
        if (!choice.message.refusal && __classPrivateFieldGet(this, _ChatCompletionStream_instances, "m", _ChatCompletionStream_getAutoParseableResponseFormat).call(this)) {
          choice.message.parsed = partialParse(choice.message.content);
        }
      }
      if (tool_calls) {
        if (!choice.message.tool_calls)
          choice.message.tool_calls = [];
        for (const { index: index2, id, type, function: fn, ...rest3 } of tool_calls) {
          const tool_call = (_d = choice.message.tool_calls)[index2] ?? (_d[index2] = {});
          Object.assign(tool_call, rest3);
          if (id)
            tool_call.id = id;
          if (type)
            tool_call.type = type;
          if (fn)
            tool_call.function ?? (tool_call.function = { name: fn.name ?? "", arguments: "" });
          if (fn?.name)
            tool_call.function.name = fn.name;
          if (fn?.arguments) {
            tool_call.function.arguments += fn.arguments;
            if (shouldParseToolCall(__classPrivateFieldGet(this, _ChatCompletionStream_params, "f"), tool_call)) {
              tool_call.function.parsed_arguments = partialParse(tool_call.function.arguments);
            }
          }
        }
      }
    }
    return snapshot;
  }, Symbol.asyncIterator)]() {
    const pushQueue = [];
    const readQueue = [];
    let done = false;
    this.on("chunk", (chunk) => {
      const reader = readQueue.shift();
      if (reader) {
        reader.resolve(chunk);
      } else {
        pushQueue.push(chunk);
      }
    });
    this.on("end", () => {
      done = true;
      for (const reader of readQueue) {
        reader.resolve(void 0);
      }
      readQueue.length = 0;
    });
    this.on("abort", (err) => {
      done = true;
      for (const reader of readQueue) {
        reader.reject(err);
      }
      readQueue.length = 0;
    });
    this.on("error", (err) => {
      done = true;
      for (const reader of readQueue) {
        reader.reject(err);
      }
      readQueue.length = 0;
    });
    return {
      next: async () => {
        if (!pushQueue.length) {
          if (done) {
            return { value: void 0, done: true };
          }
          return new Promise((resolve, reject) => readQueue.push({ resolve, reject })).then((chunk2) => chunk2 ? { value: chunk2, done: false } : { value: void 0, done: true });
        }
        const chunk = pushQueue.shift();
        return { value: chunk, done: false };
      },
      return: async () => {
        this.abort();
        return { value: void 0, done: true };
      }
    };
  }
  toReadableStream() {
    const stream = new Stream(this[Symbol.asyncIterator].bind(this), this.controller);
    return stream.toReadableStream();
  }
};
function finalizeChatCompletion(snapshot, params) {
  const { id, choices, created, model, system_fingerprint, ...rest } = snapshot;
  const completion = {
    ...rest,
    id,
    choices: choices.map(({ message, finish_reason, index, logprobs, ...choiceRest }) => {
      if (!finish_reason) {
        throw new OpenAIError(`missing finish_reason for choice ${index}`);
      }
      const { content = null, function_call, tool_calls, ...messageRest } = message;
      const role = message.role;
      if (!role) {
        throw new OpenAIError(`missing role for choice ${index}`);
      }
      if (function_call) {
        const { arguments: args, name } = function_call;
        if (args == null) {
          throw new OpenAIError(`missing function_call.arguments for choice ${index}`);
        }
        if (!name) {
          throw new OpenAIError(`missing function_call.name for choice ${index}`);
        }
        return {
          ...choiceRest,
          message: {
            content,
            function_call: { arguments: args, name },
            role,
            refusal: message.refusal ?? null
          },
          finish_reason,
          index,
          logprobs
        };
      }
      if (tool_calls) {
        return {
          ...choiceRest,
          index,
          finish_reason,
          logprobs,
          message: {
            ...messageRest,
            role,
            content,
            refusal: message.refusal ?? null,
            tool_calls: tool_calls.map((tool_call, i) => {
              const { function: fn, type, id: id2, ...toolRest } = tool_call;
              const { arguments: args, name, ...fnRest } = fn || {};
              if (id2 == null) {
                throw new OpenAIError(`missing choices[${index}].tool_calls[${i}].id
${str(snapshot)}`);
              }
              if (type == null) {
                throw new OpenAIError(`missing choices[${index}].tool_calls[${i}].type
${str(snapshot)}`);
              }
              if (name == null) {
                throw new OpenAIError(`missing choices[${index}].tool_calls[${i}].function.name
${str(snapshot)}`);
              }
              if (args == null) {
                throw new OpenAIError(`missing choices[${index}].tool_calls[${i}].function.arguments
${str(snapshot)}`);
              }
              return { ...toolRest, id: id2, type, function: { ...fnRest, name, arguments: args } };
            })
          }
        };
      }
      return {
        ...choiceRest,
        message: { ...messageRest, content, role, refusal: message.refusal ?? null },
        finish_reason,
        index,
        logprobs
      };
    }),
    created,
    model,
    object: "chat.completion",
    ...system_fingerprint ? { system_fingerprint } : {}
  };
  return maybeParseChatCompletion(completion, params);
}
function str(x) {
  return JSON.stringify(x);
}
function assertIsEmpty(obj) {
  return;
}
function assertNever(_x) {
}

// node_modules/openai/lib/ChatCompletionStreamingRunner.mjs
var ChatCompletionStreamingRunner = class _ChatCompletionStreamingRunner extends ChatCompletionStream {
  static fromReadableStream(stream) {
    const runner = new _ChatCompletionStreamingRunner(null);
    runner._run(() => runner._fromReadableStream(stream));
    return runner;
  }
  static runTools(client, params, options) {
    const runner = new _ChatCompletionStreamingRunner(
      // @ts-expect-error TODO these types are incompatible
      params
    );
    const opts = {
      ...options,
      headers: { ...options?.headers, "X-Stainless-Helper-Method": "runTools" }
    };
    runner._run(() => runner._runTools(client, params, opts));
    return runner;
  }
};

// node_modules/openai/resources/chat/completions/completions.mjs
var Completions = class extends APIResource {
  constructor() {
    super(...arguments);
    this.messages = new Messages(this._client);
  }
  create(body, options) {
    return this._client.post("/chat/completions", { body, ...options, stream: body.stream ?? false });
  }
  /**
   * Get a stored chat completion. Only Chat Completions that have been created with
   * the `store` parameter set to `true` will be returned.
   *
   * @example
   * ```ts
   * const chatCompletion =
   *   await client.chat.completions.retrieve('completion_id');
   * ```
   */
  retrieve(completionID, options) {
    return this._client.get(path`/chat/completions/${completionID}`, options);
  }
  /**
   * Modify a stored chat completion. Only Chat Completions that have been created
   * with the `store` parameter set to `true` can be modified. Currently, the only
   * supported modification is to update the `metadata` field.
   *
   * @example
   * ```ts
   * const chatCompletion = await client.chat.completions.update(
   *   'completion_id',
   *   { metadata: { foo: 'string' } },
   * );
   * ```
   */
  update(completionID, body, options) {
    return this._client.post(path`/chat/completions/${completionID}`, { body, ...options });
  }
  /**
   * List stored Chat Completions. Only Chat Completions that have been stored with
   * the `store` parameter set to `true` will be returned.
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const chatCompletion of client.chat.completions.list()) {
   *   // ...
   * }
   * ```
   */
  list(query = {}, options) {
    return this._client.getAPIList("/chat/completions", CursorPage, { query, ...options });
  }
  /**
   * Delete a stored chat completion. Only Chat Completions that have been created
   * with the `store` parameter set to `true` can be deleted.
   *
   * @example
   * ```ts
   * const chatCompletionDeleted =
   *   await client.chat.completions.delete('completion_id');
   * ```
   */
  delete(completionID, options) {
    return this._client.delete(path`/chat/completions/${completionID}`, options);
  }
  parse(body, options) {
    validateInputTools(body.tools);
    return this._client.chat.completions.create(body, {
      ...options,
      headers: {
        ...options?.headers,
        "X-Stainless-Helper-Method": "chat.completions.parse"
      }
    })._thenUnwrap((completion) => parseChatCompletion(completion, body));
  }
  runTools(body, options) {
    if (body.stream) {
      return ChatCompletionStreamingRunner.runTools(this._client, body, options);
    }
    return ChatCompletionRunner.runTools(this._client, body, options);
  }
  /**
   * Creates a chat completion stream
   */
  stream(body, options) {
    return ChatCompletionStream.createChatCompletion(this._client, body, options);
  }
};
Completions.Messages = Messages;

// node_modules/openai/resources/chat/chat.mjs
var Chat = class extends APIResource {
  constructor() {
    super(...arguments);
    this.completions = new Completions(this._client);
  }
};
Chat.Completions = Completions;

// node_modules/openai/internal/headers.mjs
var brand_privateNullableHeaders = /* @__PURE__ */ Symbol("brand.privateNullableHeaders");
function* iterateHeaders(headers) {
  if (!headers)
    return;
  if (brand_privateNullableHeaders in headers) {
    const { values, nulls } = headers;
    yield* values.entries();
    for (const name of nulls) {
      yield [name, null];
    }
    return;
  }
  let shouldClear = false;
  let iter;
  if (headers instanceof Headers) {
    iter = headers.entries();
  } else if (isReadonlyArray(headers)) {
    iter = headers;
  } else {
    shouldClear = true;
    iter = Object.entries(headers ?? {});
  }
  for (let row of iter) {
    const name = row[0];
    if (typeof name !== "string")
      throw new TypeError("expected header name to be a string");
    const values = isReadonlyArray(row[1]) ? row[1] : [row[1]];
    let didClear = false;
    for (const value of values) {
      if (value === void 0)
        continue;
      if (shouldClear && !didClear) {
        didClear = true;
        yield [name, null];
      }
      yield [name, value];
    }
  }
}
var buildHeaders = (newHeaders) => {
  const targetHeaders = new Headers();
  const nullHeaders = /* @__PURE__ */ new Set();
  for (const headers of newHeaders) {
    const seenHeaders = /* @__PURE__ */ new Set();
    for (const [name, value] of iterateHeaders(headers)) {
      const lowerName = name.toLowerCase();
      if (!seenHeaders.has(lowerName)) {
        targetHeaders.delete(name);
        seenHeaders.add(lowerName);
      }
      if (value === null) {
        targetHeaders.delete(name);
        nullHeaders.add(lowerName);
      } else {
        targetHeaders.append(name, value);
        nullHeaders.delete(lowerName);
      }
    }
  }
  return { [brand_privateNullableHeaders]: true, values: targetHeaders, nulls: nullHeaders };
};

// node_modules/openai/resources/audio/speech.mjs
var Speech = class extends APIResource {
  /**
   * Generates audio from the input text.
   *
   * Returns the audio file content, or a stream of audio events.
   *
   * @example
   * ```ts
   * const speech = await client.audio.speech.create({
   *   input: 'input',
   *   model: 'string',
   *   voice: 'string',
   * });
   *
   * const content = await speech.blob();
   * console.log(content);
   * ```
   */
  create(body, options) {
    return this._client.post("/audio/speech", {
      body,
      ...options,
      headers: buildHeaders([{ Accept: "application/octet-stream" }, options?.headers]),
      __binaryResponse: true
    });
  }
};

// node_modules/openai/resources/audio/transcriptions.mjs
var Transcriptions = class extends APIResource {
  create(body, options) {
    return this._client.post("/audio/transcriptions", multipartFormRequestOptions({
      body,
      ...options,
      stream: body.stream ?? false,
      __metadata: { model: body.model }
    }, this._client));
  }
};

// node_modules/openai/resources/audio/translations.mjs
var Translations = class extends APIResource {
  create(body, options) {
    return this._client.post("/audio/translations", multipartFormRequestOptions({ body, ...options, __metadata: { model: body.model } }, this._client));
  }
};

// node_modules/openai/resources/audio/audio.mjs
var Audio = class extends APIResource {
  constructor() {
    super(...arguments);
    this.transcriptions = new Transcriptions(this._client);
    this.translations = new Translations(this._client);
    this.speech = new Speech(this._client);
  }
};
Audio.Transcriptions = Transcriptions;
Audio.Translations = Translations;
Audio.Speech = Speech;

// node_modules/openai/resources/batches.mjs
var Batches = class extends APIResource {
  /**
   * Creates and executes a batch from an uploaded file of requests
   */
  create(body, options) {
    return this._client.post("/batches", { body, ...options });
  }
  /**
   * Retrieves a batch.
   */
  retrieve(batchID, options) {
    return this._client.get(path`/batches/${batchID}`, options);
  }
  /**
   * List your organization's batches.
   */
  list(query = {}, options) {
    return this._client.getAPIList("/batches", CursorPage, { query, ...options });
  }
  /**
   * Cancels an in-progress batch. The batch will be in status `cancelling` for up to
   * 10 minutes, before changing to `cancelled`, where it will have partial results
   * (if any) available in the output file.
   */
  cancel(batchID, options) {
    return this._client.post(path`/batches/${batchID}/cancel`, options);
  }
};

// node_modules/openai/resources/beta/assistants.mjs
var Assistants = class extends APIResource {
  /**
   * Create an assistant with a model and instructions.
   *
   * @deprecated
   */
  create(body, options) {
    return this._client.post("/assistants", {
      body,
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers])
    });
  }
  /**
   * Retrieves an assistant.
   *
   * @deprecated
   */
  retrieve(assistantID, options) {
    return this._client.get(path`/assistants/${assistantID}`, {
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers])
    });
  }
  /**
   * Modifies an assistant.
   *
   * @deprecated
   */
  update(assistantID, body, options) {
    return this._client.post(path`/assistants/${assistantID}`, {
      body,
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers])
    });
  }
  /**
   * Returns a list of assistants.
   *
   * @deprecated
   */
  list(query = {}, options) {
    return this._client.getAPIList("/assistants", CursorPage, {
      query,
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers])
    });
  }
  /**
   * Delete an assistant.
   *
   * @deprecated
   */
  delete(assistantID, options) {
    return this._client.delete(path`/assistants/${assistantID}`, {
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers])
    });
  }
};

// node_modules/openai/resources/beta/realtime/sessions.mjs
var Sessions = class extends APIResource {
  /**
   * Create an ephemeral API token for use in client-side applications with the
   * Realtime API. Can be configured with the same session parameters as the
   * `session.update` client event.
   *
   * It responds with a session object, plus a `client_secret` key which contains a
   * usable ephemeral API token that can be used to authenticate browser clients for
   * the Realtime API.
   *
   * @example
   * ```ts
   * const session =
   *   await client.beta.realtime.sessions.create();
   * ```
   */
  create(body, options) {
    return this._client.post("/realtime/sessions", {
      body,
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers])
    });
  }
};

// node_modules/openai/resources/beta/realtime/transcription-sessions.mjs
var TranscriptionSessions = class extends APIResource {
  /**
   * Create an ephemeral API token for use in client-side applications with the
   * Realtime API specifically for realtime transcriptions. Can be configured with
   * the same session parameters as the `transcription_session.update` client event.
   *
   * It responds with a session object, plus a `client_secret` key which contains a
   * usable ephemeral API token that can be used to authenticate browser clients for
   * the Realtime API.
   *
   * @example
   * ```ts
   * const transcriptionSession =
   *   await client.beta.realtime.transcriptionSessions.create();
   * ```
   */
  create(body, options) {
    return this._client.post("/realtime/transcription_sessions", {
      body,
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers])
    });
  }
};

// node_modules/openai/resources/beta/realtime/realtime.mjs
var Realtime = class extends APIResource {
  constructor() {
    super(...arguments);
    this.sessions = new Sessions(this._client);
    this.transcriptionSessions = new TranscriptionSessions(this._client);
  }
};
Realtime.Sessions = Sessions;
Realtime.TranscriptionSessions = TranscriptionSessions;

// node_modules/openai/resources/beta/chatkit/sessions.mjs
var Sessions2 = class extends APIResource {
  /**
   * Create a ChatKit session.
   *
   * @example
   * ```ts
   * const chatSession =
   *   await client.beta.chatkit.sessions.create({
   *     user: 'x',
   *     workflow: { id: 'id' },
   *   });
   * ```
   */
  create(body, options) {
    return this._client.post("/chatkit/sessions", {
      body,
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "chatkit_beta=v1" }, options?.headers])
    });
  }
  /**
   * Cancel an active ChatKit session and return its most recent metadata.
   *
   * Cancelling prevents new requests from using the issued client secret.
   *
   * @example
   * ```ts
   * const chatSession =
   *   await client.beta.chatkit.sessions.cancel('cksess_123');
   * ```
   */
  cancel(sessionID, options) {
    return this._client.post(path`/chatkit/sessions/${sessionID}/cancel`, {
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "chatkit_beta=v1" }, options?.headers])
    });
  }
};

// node_modules/openai/resources/beta/chatkit/threads.mjs
var Threads = class extends APIResource {
  /**
   * Retrieve a ChatKit thread by its identifier.
   *
   * @example
   * ```ts
   * const chatkitThread =
   *   await client.beta.chatkit.threads.retrieve('cthr_123');
   * ```
   */
  retrieve(threadID, options) {
    return this._client.get(path`/chatkit/threads/${threadID}`, {
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "chatkit_beta=v1" }, options?.headers])
    });
  }
  /**
   * List ChatKit threads with optional pagination and user filters.
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const chatkitThread of client.beta.chatkit.threads.list()) {
   *   // ...
   * }
   * ```
   */
  list(query = {}, options) {
    return this._client.getAPIList("/chatkit/threads", ConversationCursorPage, {
      query,
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "chatkit_beta=v1" }, options?.headers])
    });
  }
  /**
   * Delete a ChatKit thread along with its items and stored attachments.
   *
   * @example
   * ```ts
   * const thread = await client.beta.chatkit.threads.delete(
   *   'cthr_123',
   * );
   * ```
   */
  delete(threadID, options) {
    return this._client.delete(path`/chatkit/threads/${threadID}`, {
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "chatkit_beta=v1" }, options?.headers])
    });
  }
  /**
   * List items that belong to a ChatKit thread.
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const thread of client.beta.chatkit.threads.listItems(
   *   'cthr_123',
   * )) {
   *   // ...
   * }
   * ```
   */
  listItems(threadID, query = {}, options) {
    return this._client.getAPIList(path`/chatkit/threads/${threadID}/items`, ConversationCursorPage, { query, ...options, headers: buildHeaders([{ "OpenAI-Beta": "chatkit_beta=v1" }, options?.headers]) });
  }
};

// node_modules/openai/resources/beta/chatkit/chatkit.mjs
var ChatKit = class extends APIResource {
  constructor() {
    super(...arguments);
    this.sessions = new Sessions2(this._client);
    this.threads = new Threads(this._client);
  }
};
ChatKit.Sessions = Sessions2;
ChatKit.Threads = Threads;

// node_modules/openai/resources/beta/threads/messages.mjs
var Messages2 = class extends APIResource {
  /**
   * Create a message.
   *
   * @deprecated The Assistants API is deprecated in favor of the Responses API
   */
  create(threadID, body, options) {
    return this._client.post(path`/threads/${threadID}/messages`, {
      body,
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers])
    });
  }
  /**
   * Retrieve a message.
   *
   * @deprecated The Assistants API is deprecated in favor of the Responses API
   */
  retrieve(messageID, params, options) {
    const { thread_id } = params;
    return this._client.get(path`/threads/${thread_id}/messages/${messageID}`, {
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers])
    });
  }
  /**
   * Modifies a message.
   *
   * @deprecated The Assistants API is deprecated in favor of the Responses API
   */
  update(messageID, params, options) {
    const { thread_id, ...body } = params;
    return this._client.post(path`/threads/${thread_id}/messages/${messageID}`, {
      body,
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers])
    });
  }
  /**
   * Returns a list of messages for a given thread.
   *
   * @deprecated The Assistants API is deprecated in favor of the Responses API
   */
  list(threadID, query = {}, options) {
    return this._client.getAPIList(path`/threads/${threadID}/messages`, CursorPage, {
      query,
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers])
    });
  }
  /**
   * Deletes a message.
   *
   * @deprecated The Assistants API is deprecated in favor of the Responses API
   */
  delete(messageID, params, options) {
    const { thread_id } = params;
    return this._client.delete(path`/threads/${thread_id}/messages/${messageID}`, {
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers])
    });
  }
};

// node_modules/openai/resources/beta/threads/runs/steps.mjs
var Steps = class extends APIResource {
  /**
   * Retrieves a run step.
   *
   * @deprecated The Assistants API is deprecated in favor of the Responses API
   */
  retrieve(stepID, params, options) {
    const { thread_id, run_id, ...query } = params;
    return this._client.get(path`/threads/${thread_id}/runs/${run_id}/steps/${stepID}`, {
      query,
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers])
    });
  }
  /**
   * Returns a list of run steps belonging to a run.
   *
   * @deprecated The Assistants API is deprecated in favor of the Responses API
   */
  list(runID, params, options) {
    const { thread_id, ...query } = params;
    return this._client.getAPIList(path`/threads/${thread_id}/runs/${runID}/steps`, CursorPage, {
      query,
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers])
    });
  }
};

// node_modules/openai/internal/utils/base64.mjs
var toFloat32Array = (base64Str) => {
  if (typeof Buffer !== "undefined") {
    const buf = Buffer.from(base64Str, "base64");
    return Array.from(new Float32Array(buf.buffer, buf.byteOffset, buf.length / Float32Array.BYTES_PER_ELEMENT));
  } else {
    const binaryStr = atob(base64Str);
    const len = binaryStr.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    return Array.from(new Float32Array(bytes.buffer));
  }
};

// node_modules/openai/internal/utils/env.mjs
var readEnv = (env) => {
  if (typeof globalThis.process !== "undefined") {
    return globalThis.process.env?.[env]?.trim() ?? void 0;
  }
  if (typeof globalThis.Deno !== "undefined") {
    return globalThis.Deno.env?.get?.(env)?.trim();
  }
  return void 0;
};

// node_modules/openai/lib/AssistantStream.mjs
var _AssistantStream_instances;
var _a;
var _AssistantStream_events;
var _AssistantStream_runStepSnapshots;
var _AssistantStream_messageSnapshots;
var _AssistantStream_messageSnapshot;
var _AssistantStream_finalRun;
var _AssistantStream_currentContentIndex;
var _AssistantStream_currentContent;
var _AssistantStream_currentToolCallIndex;
var _AssistantStream_currentToolCall;
var _AssistantStream_currentEvent;
var _AssistantStream_currentRunSnapshot;
var _AssistantStream_currentRunStepSnapshot;
var _AssistantStream_addEvent;
var _AssistantStream_endRequest;
var _AssistantStream_handleMessage;
var _AssistantStream_handleRunStep;
var _AssistantStream_handleEvent;
var _AssistantStream_accumulateRunStep;
var _AssistantStream_accumulateMessage;
var _AssistantStream_accumulateContent;
var _AssistantStream_handleRun;
var AssistantStream = class extends EventStream {
  constructor() {
    super(...arguments);
    _AssistantStream_instances.add(this);
    _AssistantStream_events.set(this, []);
    _AssistantStream_runStepSnapshots.set(this, {});
    _AssistantStream_messageSnapshots.set(this, {});
    _AssistantStream_messageSnapshot.set(this, void 0);
    _AssistantStream_finalRun.set(this, void 0);
    _AssistantStream_currentContentIndex.set(this, void 0);
    _AssistantStream_currentContent.set(this, void 0);
    _AssistantStream_currentToolCallIndex.set(this, void 0);
    _AssistantStream_currentToolCall.set(this, void 0);
    _AssistantStream_currentEvent.set(this, void 0);
    _AssistantStream_currentRunSnapshot.set(this, void 0);
    _AssistantStream_currentRunStepSnapshot.set(this, void 0);
  }
  [(_AssistantStream_events = /* @__PURE__ */ new WeakMap(), _AssistantStream_runStepSnapshots = /* @__PURE__ */ new WeakMap(), _AssistantStream_messageSnapshots = /* @__PURE__ */ new WeakMap(), _AssistantStream_messageSnapshot = /* @__PURE__ */ new WeakMap(), _AssistantStream_finalRun = /* @__PURE__ */ new WeakMap(), _AssistantStream_currentContentIndex = /* @__PURE__ */ new WeakMap(), _AssistantStream_currentContent = /* @__PURE__ */ new WeakMap(), _AssistantStream_currentToolCallIndex = /* @__PURE__ */ new WeakMap(), _AssistantStream_currentToolCall = /* @__PURE__ */ new WeakMap(), _AssistantStream_currentEvent = /* @__PURE__ */ new WeakMap(), _AssistantStream_currentRunSnapshot = /* @__PURE__ */ new WeakMap(), _AssistantStream_currentRunStepSnapshot = /* @__PURE__ */ new WeakMap(), _AssistantStream_instances = /* @__PURE__ */ new WeakSet(), Symbol.asyncIterator)]() {
    const pushQueue = [];
    const readQueue = [];
    let done = false;
    this.on("event", (event) => {
      const reader = readQueue.shift();
      if (reader) {
        reader.resolve(event);
      } else {
        pushQueue.push(event);
      }
    });
    this.on("end", () => {
      done = true;
      for (const reader of readQueue) {
        reader.resolve(void 0);
      }
      readQueue.length = 0;
    });
    this.on("abort", (err) => {
      done = true;
      for (const reader of readQueue) {
        reader.reject(err);
      }
      readQueue.length = 0;
    });
    this.on("error", (err) => {
      done = true;
      for (const reader of readQueue) {
        reader.reject(err);
      }
      readQueue.length = 0;
    });
    return {
      next: async () => {
        if (!pushQueue.length) {
          if (done) {
            return { value: void 0, done: true };
          }
          return new Promise((resolve, reject) => readQueue.push({ resolve, reject })).then((chunk2) => chunk2 ? { value: chunk2, done: false } : { value: void 0, done: true });
        }
        const chunk = pushQueue.shift();
        return { value: chunk, done: false };
      },
      return: async () => {
        this.abort();
        return { value: void 0, done: true };
      }
    };
  }
  static fromReadableStream(stream) {
    const runner = new _a();
    runner._run(() => runner._fromReadableStream(stream));
    return runner;
  }
  async _fromReadableStream(readableStream, options) {
    const signal = options?.signal;
    if (signal) {
      if (signal.aborted)
        this.controller.abort();
      signal.addEventListener("abort", () => this.controller.abort());
    }
    this._connected();
    const stream = Stream.fromReadableStream(readableStream, this.controller);
    for await (const event of stream) {
      __classPrivateFieldGet(this, _AssistantStream_instances, "m", _AssistantStream_addEvent).call(this, event);
    }
    if (stream.controller.signal?.aborted) {
      throw new APIUserAbortError();
    }
    return this._addRun(__classPrivateFieldGet(this, _AssistantStream_instances, "m", _AssistantStream_endRequest).call(this));
  }
  toReadableStream() {
    const stream = new Stream(this[Symbol.asyncIterator].bind(this), this.controller);
    return stream.toReadableStream();
  }
  static createToolAssistantStream(runId, runs, params, options) {
    const runner = new _a();
    runner._run(() => runner._runToolAssistantStream(runId, runs, params, {
      ...options,
      headers: { ...options?.headers, "X-Stainless-Helper-Method": "stream" }
    }));
    return runner;
  }
  async _createToolAssistantStream(run, runId, params, options) {
    const signal = options?.signal;
    if (signal) {
      if (signal.aborted)
        this.controller.abort();
      signal.addEventListener("abort", () => this.controller.abort());
    }
    const body = { ...params, stream: true };
    const stream = await run.submitToolOutputs(runId, body, {
      ...options,
      signal: this.controller.signal
    });
    this._connected();
    for await (const event of stream) {
      __classPrivateFieldGet(this, _AssistantStream_instances, "m", _AssistantStream_addEvent).call(this, event);
    }
    if (stream.controller.signal?.aborted) {
      throw new APIUserAbortError();
    }
    return this._addRun(__classPrivateFieldGet(this, _AssistantStream_instances, "m", _AssistantStream_endRequest).call(this));
  }
  static createThreadAssistantStream(params, thread, options) {
    const runner = new _a();
    runner._run(() => runner._threadAssistantStream(params, thread, {
      ...options,
      headers: { ...options?.headers, "X-Stainless-Helper-Method": "stream" }
    }));
    return runner;
  }
  static createAssistantStream(threadId, runs, params, options) {
    const runner = new _a();
    runner._run(() => runner._runAssistantStream(threadId, runs, params, {
      ...options,
      headers: { ...options?.headers, "X-Stainless-Helper-Method": "stream" }
    }));
    return runner;
  }
  currentEvent() {
    return __classPrivateFieldGet(this, _AssistantStream_currentEvent, "f");
  }
  currentRun() {
    return __classPrivateFieldGet(this, _AssistantStream_currentRunSnapshot, "f");
  }
  currentMessageSnapshot() {
    return __classPrivateFieldGet(this, _AssistantStream_messageSnapshot, "f");
  }
  currentRunStepSnapshot() {
    return __classPrivateFieldGet(this, _AssistantStream_currentRunStepSnapshot, "f");
  }
  async finalRunSteps() {
    await this.done();
    return Object.values(__classPrivateFieldGet(this, _AssistantStream_runStepSnapshots, "f"));
  }
  async finalMessages() {
    await this.done();
    return Object.values(__classPrivateFieldGet(this, _AssistantStream_messageSnapshots, "f"));
  }
  async finalRun() {
    await this.done();
    if (!__classPrivateFieldGet(this, _AssistantStream_finalRun, "f"))
      throw Error("Final run was not received.");
    return __classPrivateFieldGet(this, _AssistantStream_finalRun, "f");
  }
  async _createThreadAssistantStream(thread, params, options) {
    const signal = options?.signal;
    if (signal) {
      if (signal.aborted)
        this.controller.abort();
      signal.addEventListener("abort", () => this.controller.abort());
    }
    const body = { ...params, stream: true };
    const stream = await thread.createAndRun(body, { ...options, signal: this.controller.signal });
    this._connected();
    for await (const event of stream) {
      __classPrivateFieldGet(this, _AssistantStream_instances, "m", _AssistantStream_addEvent).call(this, event);
    }
    if (stream.controller.signal?.aborted) {
      throw new APIUserAbortError();
    }
    return this._addRun(__classPrivateFieldGet(this, _AssistantStream_instances, "m", _AssistantStream_endRequest).call(this));
  }
  async _createAssistantStream(run, threadId, params, options) {
    const signal = options?.signal;
    if (signal) {
      if (signal.aborted)
        this.controller.abort();
      signal.addEventListener("abort", () => this.controller.abort());
    }
    const body = { ...params, stream: true };
    const stream = await run.create(threadId, body, { ...options, signal: this.controller.signal });
    this._connected();
    for await (const event of stream) {
      __classPrivateFieldGet(this, _AssistantStream_instances, "m", _AssistantStream_addEvent).call(this, event);
    }
    if (stream.controller.signal?.aborted) {
      throw new APIUserAbortError();
    }
    return this._addRun(__classPrivateFieldGet(this, _AssistantStream_instances, "m", _AssistantStream_endRequest).call(this));
  }
  static accumulateDelta(acc, delta) {
    for (const [key, deltaValue] of Object.entries(delta)) {
      if (!acc.hasOwnProperty(key)) {
        acc[key] = deltaValue;
        continue;
      }
      let accValue = acc[key];
      if (accValue === null || accValue === void 0) {
        acc[key] = deltaValue;
        continue;
      }
      if (key === "index" || key === "type") {
        acc[key] = deltaValue;
        continue;
      }
      if (typeof accValue === "string" && typeof deltaValue === "string") {
        accValue += deltaValue;
      } else if (typeof accValue === "number" && typeof deltaValue === "number") {
        accValue += deltaValue;
      } else if (isObj(accValue) && isObj(deltaValue)) {
        accValue = this.accumulateDelta(accValue, deltaValue);
      } else if (Array.isArray(accValue) && Array.isArray(deltaValue)) {
        if (accValue.every((x) => typeof x === "string" || typeof x === "number")) {
          accValue.push(...deltaValue);
          continue;
        }
        for (const deltaEntry of deltaValue) {
          if (!isObj(deltaEntry)) {
            throw new Error(`Expected array delta entry to be an object but got: ${deltaEntry}`);
          }
          const index = deltaEntry["index"];
          if (index == null) {
            console.error(deltaEntry);
            throw new Error("Expected array delta entry to have an `index` property");
          }
          if (typeof index !== "number") {
            throw new Error(`Expected array delta entry \`index\` property to be a number but got ${index}`);
          }
          const accEntry = accValue[index];
          if (accEntry == null) {
            accValue.push(deltaEntry);
          } else {
            accValue[index] = this.accumulateDelta(accEntry, deltaEntry);
          }
        }
        continue;
      } else {
        throw Error(`Unhandled record type: ${key}, deltaValue: ${deltaValue}, accValue: ${accValue}`);
      }
      acc[key] = accValue;
    }
    return acc;
  }
  _addRun(run) {
    return run;
  }
  async _threadAssistantStream(params, thread, options) {
    return await this._createThreadAssistantStream(thread, params, options);
  }
  async _runAssistantStream(threadId, runs, params, options) {
    return await this._createAssistantStream(runs, threadId, params, options);
  }
  async _runToolAssistantStream(runId, runs, params, options) {
    return await this._createToolAssistantStream(runs, runId, params, options);
  }
};
_a = AssistantStream, _AssistantStream_addEvent = function _AssistantStream_addEvent2(event) {
  if (this.ended)
    return;
  __classPrivateFieldSet(this, _AssistantStream_currentEvent, event, "f");
  __classPrivateFieldGet(this, _AssistantStream_instances, "m", _AssistantStream_handleEvent).call(this, event);
  switch (event.event) {
    case "thread.created":
      break;
    case "thread.run.created":
    case "thread.run.queued":
    case "thread.run.in_progress":
    case "thread.run.requires_action":
    case "thread.run.completed":
    case "thread.run.incomplete":
    case "thread.run.failed":
    case "thread.run.cancelling":
    case "thread.run.cancelled":
    case "thread.run.expired":
      __classPrivateFieldGet(this, _AssistantStream_instances, "m", _AssistantStream_handleRun).call(this, event);
      break;
    case "thread.run.step.created":
    case "thread.run.step.in_progress":
    case "thread.run.step.delta":
    case "thread.run.step.completed":
    case "thread.run.step.failed":
    case "thread.run.step.cancelled":
    case "thread.run.step.expired":
      __classPrivateFieldGet(this, _AssistantStream_instances, "m", _AssistantStream_handleRunStep).call(this, event);
      break;
    case "thread.message.created":
    case "thread.message.in_progress":
    case "thread.message.delta":
    case "thread.message.completed":
    case "thread.message.incomplete":
      __classPrivateFieldGet(this, _AssistantStream_instances, "m", _AssistantStream_handleMessage).call(this, event);
      break;
    case "error":
      throw new Error("Encountered an error event in event processing - errors should be processed earlier");
    default:
      assertNever2(event);
  }
}, _AssistantStream_endRequest = function _AssistantStream_endRequest2() {
  if (this.ended) {
    throw new OpenAIError(`stream has ended, this shouldn't happen`);
  }
  if (!__classPrivateFieldGet(this, _AssistantStream_finalRun, "f"))
    throw Error("Final run has not been received");
  return __classPrivateFieldGet(this, _AssistantStream_finalRun, "f");
}, _AssistantStream_handleMessage = function _AssistantStream_handleMessage2(event) {
  const [accumulatedMessage, newContent] = __classPrivateFieldGet(this, _AssistantStream_instances, "m", _AssistantStream_accumulateMessage).call(this, event, __classPrivateFieldGet(this, _AssistantStream_messageSnapshot, "f"));
  __classPrivateFieldSet(this, _AssistantStream_messageSnapshot, accumulatedMessage, "f");
  __classPrivateFieldGet(this, _AssistantStream_messageSnapshots, "f")[accumulatedMessage.id] = accumulatedMessage;
  for (const content of newContent) {
    const snapshotContent = accumulatedMessage.content[content.index];
    if (snapshotContent?.type == "text") {
      this._emit("textCreated", snapshotContent.text);
    }
  }
  switch (event.event) {
    case "thread.message.created":
      this._emit("messageCreated", event.data);
      break;
    case "thread.message.in_progress":
      break;
    case "thread.message.delta":
      this._emit("messageDelta", event.data.delta, accumulatedMessage);
      if (event.data.delta.content) {
        for (const content of event.data.delta.content) {
          if (content.type == "text" && content.text) {
            let textDelta = content.text;
            let snapshot = accumulatedMessage.content[content.index];
            if (snapshot && snapshot.type == "text") {
              this._emit("textDelta", textDelta, snapshot.text);
            } else {
              throw Error("The snapshot associated with this text delta is not text or missing");
            }
          }
          if (content.index != __classPrivateFieldGet(this, _AssistantStream_currentContentIndex, "f")) {
            if (__classPrivateFieldGet(this, _AssistantStream_currentContent, "f")) {
              switch (__classPrivateFieldGet(this, _AssistantStream_currentContent, "f").type) {
                case "text":
                  this._emit("textDone", __classPrivateFieldGet(this, _AssistantStream_currentContent, "f").text, __classPrivateFieldGet(this, _AssistantStream_messageSnapshot, "f"));
                  break;
                case "image_file":
                  this._emit("imageFileDone", __classPrivateFieldGet(this, _AssistantStream_currentContent, "f").image_file, __classPrivateFieldGet(this, _AssistantStream_messageSnapshot, "f"));
                  break;
              }
            }
            __classPrivateFieldSet(this, _AssistantStream_currentContentIndex, content.index, "f");
          }
          __classPrivateFieldSet(this, _AssistantStream_currentContent, accumulatedMessage.content[content.index], "f");
        }
      }
      break;
    case "thread.message.completed":
    case "thread.message.incomplete":
      if (__classPrivateFieldGet(this, _AssistantStream_currentContentIndex, "f") !== void 0) {
        const currentContent = event.data.content[__classPrivateFieldGet(this, _AssistantStream_currentContentIndex, "f")];
        if (currentContent) {
          switch (currentContent.type) {
            case "image_file":
              this._emit("imageFileDone", currentContent.image_file, __classPrivateFieldGet(this, _AssistantStream_messageSnapshot, "f"));
              break;
            case "text":
              this._emit("textDone", currentContent.text, __classPrivateFieldGet(this, _AssistantStream_messageSnapshot, "f"));
              break;
          }
        }
      }
      if (__classPrivateFieldGet(this, _AssistantStream_messageSnapshot, "f")) {
        this._emit("messageDone", event.data);
      }
      __classPrivateFieldSet(this, _AssistantStream_messageSnapshot, void 0, "f");
  }
}, _AssistantStream_handleRunStep = function _AssistantStream_handleRunStep2(event) {
  const accumulatedRunStep = __classPrivateFieldGet(this, _AssistantStream_instances, "m", _AssistantStream_accumulateRunStep).call(this, event);
  __classPrivateFieldSet(this, _AssistantStream_currentRunStepSnapshot, accumulatedRunStep, "f");
  switch (event.event) {
    case "thread.run.step.created":
      this._emit("runStepCreated", event.data);
      break;
    case "thread.run.step.delta":
      const delta = event.data.delta;
      if (delta.step_details && delta.step_details.type == "tool_calls" && delta.step_details.tool_calls && accumulatedRunStep.step_details.type == "tool_calls") {
        for (const toolCall of delta.step_details.tool_calls) {
          if (toolCall.index == __classPrivateFieldGet(this, _AssistantStream_currentToolCallIndex, "f")) {
            this._emit("toolCallDelta", toolCall, accumulatedRunStep.step_details.tool_calls[toolCall.index]);
          } else {
            if (__classPrivateFieldGet(this, _AssistantStream_currentToolCall, "f")) {
              this._emit("toolCallDone", __classPrivateFieldGet(this, _AssistantStream_currentToolCall, "f"));
            }
            __classPrivateFieldSet(this, _AssistantStream_currentToolCallIndex, toolCall.index, "f");
            __classPrivateFieldSet(this, _AssistantStream_currentToolCall, accumulatedRunStep.step_details.tool_calls[toolCall.index], "f");
            if (__classPrivateFieldGet(this, _AssistantStream_currentToolCall, "f"))
              this._emit("toolCallCreated", __classPrivateFieldGet(this, _AssistantStream_currentToolCall, "f"));
          }
        }
      }
      this._emit("runStepDelta", event.data.delta, accumulatedRunStep);
      break;
    case "thread.run.step.completed":
    case "thread.run.step.failed":
    case "thread.run.step.cancelled":
    case "thread.run.step.expired":
      __classPrivateFieldSet(this, _AssistantStream_currentRunStepSnapshot, void 0, "f");
      const details = event.data.step_details;
      if (details.type == "tool_calls") {
        if (__classPrivateFieldGet(this, _AssistantStream_currentToolCall, "f")) {
          this._emit("toolCallDone", __classPrivateFieldGet(this, _AssistantStream_currentToolCall, "f"));
          __classPrivateFieldSet(this, _AssistantStream_currentToolCall, void 0, "f");
        }
      }
      this._emit("runStepDone", event.data, accumulatedRunStep);
      break;
    case "thread.run.step.in_progress":
      break;
  }
}, _AssistantStream_handleEvent = function _AssistantStream_handleEvent2(event) {
  __classPrivateFieldGet(this, _AssistantStream_events, "f").push(event);
  this._emit("event", event);
}, _AssistantStream_accumulateRunStep = function _AssistantStream_accumulateRunStep2(event) {
  switch (event.event) {
    case "thread.run.step.created":
      __classPrivateFieldGet(this, _AssistantStream_runStepSnapshots, "f")[event.data.id] = event.data;
      return event.data;
    case "thread.run.step.delta":
      let snapshot = __classPrivateFieldGet(this, _AssistantStream_runStepSnapshots, "f")[event.data.id];
      if (!snapshot) {
        throw Error("Received a RunStepDelta before creation of a snapshot");
      }
      let data = event.data;
      if (data.delta) {
        const accumulated = _a.accumulateDelta(snapshot, data.delta);
        __classPrivateFieldGet(this, _AssistantStream_runStepSnapshots, "f")[event.data.id] = accumulated;
      }
      return __classPrivateFieldGet(this, _AssistantStream_runStepSnapshots, "f")[event.data.id];
    case "thread.run.step.completed":
    case "thread.run.step.failed":
    case "thread.run.step.cancelled":
    case "thread.run.step.expired":
    case "thread.run.step.in_progress":
      __classPrivateFieldGet(this, _AssistantStream_runStepSnapshots, "f")[event.data.id] = event.data;
      break;
  }
  if (__classPrivateFieldGet(this, _AssistantStream_runStepSnapshots, "f")[event.data.id])
    return __classPrivateFieldGet(this, _AssistantStream_runStepSnapshots, "f")[event.data.id];
  throw new Error("No snapshot available");
}, _AssistantStream_accumulateMessage = function _AssistantStream_accumulateMessage2(event, snapshot) {
  let newContent = [];
  switch (event.event) {
    case "thread.message.created":
      return [event.data, newContent];
    case "thread.message.delta":
      if (!snapshot) {
        throw Error("Received a delta with no existing snapshot (there should be one from message creation)");
      }
      let data = event.data;
      if (data.delta.content) {
        for (const contentElement of data.delta.content) {
          if (contentElement.index in snapshot.content) {
            let currentContent = snapshot.content[contentElement.index];
            snapshot.content[contentElement.index] = __classPrivateFieldGet(this, _AssistantStream_instances, "m", _AssistantStream_accumulateContent).call(this, contentElement, currentContent);
          } else {
            snapshot.content[contentElement.index] = contentElement;
            newContent.push(contentElement);
          }
        }
      }
      return [snapshot, newContent];
    case "thread.message.in_progress":
    case "thread.message.completed":
    case "thread.message.incomplete":
      if (snapshot) {
        return [snapshot, newContent];
      } else {
        throw Error("Received thread message event with no existing snapshot");
      }
  }
  throw Error("Tried to accumulate a non-message event");
}, _AssistantStream_accumulateContent = function _AssistantStream_accumulateContent2(contentElement, currentContent) {
  return _a.accumulateDelta(currentContent, contentElement);
}, _AssistantStream_handleRun = function _AssistantStream_handleRun2(event) {
  __classPrivateFieldSet(this, _AssistantStream_currentRunSnapshot, event.data, "f");
  switch (event.event) {
    case "thread.run.created":
      break;
    case "thread.run.queued":
      break;
    case "thread.run.in_progress":
      break;
    case "thread.run.requires_action":
    case "thread.run.cancelled":
    case "thread.run.failed":
    case "thread.run.completed":
    case "thread.run.expired":
    case "thread.run.incomplete":
      __classPrivateFieldSet(this, _AssistantStream_finalRun, event.data, "f");
      if (__classPrivateFieldGet(this, _AssistantStream_currentToolCall, "f")) {
        this._emit("toolCallDone", __classPrivateFieldGet(this, _AssistantStream_currentToolCall, "f"));
        __classPrivateFieldSet(this, _AssistantStream_currentToolCall, void 0, "f");
      }
      break;
    case "thread.run.cancelling":
      break;
  }
};
function assertNever2(_x) {
}

// node_modules/openai/resources/beta/threads/runs/runs.mjs
var Runs = class extends APIResource {
  constructor() {
    super(...arguments);
    this.steps = new Steps(this._client);
  }
  create(threadID, params, options) {
    const { include, ...body } = params;
    return this._client.post(path`/threads/${threadID}/runs`, {
      query: { include },
      body,
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers]),
      stream: params.stream ?? false,
      __synthesizeEventData: true
    });
  }
  /**
   * Retrieves a run.
   *
   * @deprecated The Assistants API is deprecated in favor of the Responses API
   */
  retrieve(runID, params, options) {
    const { thread_id } = params;
    return this._client.get(path`/threads/${thread_id}/runs/${runID}`, {
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers])
    });
  }
  /**
   * Modifies a run.
   *
   * @deprecated The Assistants API is deprecated in favor of the Responses API
   */
  update(runID, params, options) {
    const { thread_id, ...body } = params;
    return this._client.post(path`/threads/${thread_id}/runs/${runID}`, {
      body,
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers])
    });
  }
  /**
   * Returns a list of runs belonging to a thread.
   *
   * @deprecated The Assistants API is deprecated in favor of the Responses API
   */
  list(threadID, query = {}, options) {
    return this._client.getAPIList(path`/threads/${threadID}/runs`, CursorPage, {
      query,
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers])
    });
  }
  /**
   * Cancels a run that is `in_progress`.
   *
   * @deprecated The Assistants API is deprecated in favor of the Responses API
   */
  cancel(runID, params, options) {
    const { thread_id } = params;
    return this._client.post(path`/threads/${thread_id}/runs/${runID}/cancel`, {
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers])
    });
  }
  /**
   * A helper to create a run an poll for a terminal state. More information on Run
   * lifecycles can be found here:
   * https://platform.openai.com/docs/assistants/how-it-works/runs-and-run-steps
   */
  async createAndPoll(threadId, body, options) {
    const run = await this.create(threadId, body, options);
    return await this.poll(run.id, { thread_id: threadId }, options);
  }
  /**
   * Create a Run stream
   *
   * @deprecated use `stream` instead
   */
  createAndStream(threadId, body, options) {
    return AssistantStream.createAssistantStream(threadId, this._client.beta.threads.runs, body, options);
  }
  /**
   * A helper to poll a run status until it reaches a terminal state. More
   * information on Run lifecycles can be found here:
   * https://platform.openai.com/docs/assistants/how-it-works/runs-and-run-steps
   */
  async poll(runId, params, options) {
    const headers = buildHeaders([
      options?.headers,
      {
        "X-Stainless-Poll-Helper": "true",
        "X-Stainless-Custom-Poll-Interval": options?.pollIntervalMs?.toString() ?? void 0
      }
    ]);
    while (true) {
      const { data: run, response } = await this.retrieve(runId, params, {
        ...options,
        headers: { ...options?.headers, ...headers }
      }).withResponse();
      switch (run.status) {
        case "queued":
        case "in_progress":
        case "cancelling":
          let sleepInterval = 5e3;
          if (options?.pollIntervalMs) {
            sleepInterval = options.pollIntervalMs;
          } else {
            const headerInterval = response.headers.get("openai-poll-after-ms");
            if (headerInterval) {
              const headerIntervalMs = parseInt(headerInterval);
              if (!isNaN(headerIntervalMs)) {
                sleepInterval = headerIntervalMs;
              }
            }
          }
          await sleep(sleepInterval);
          break;
        case "requires_action":
        case "incomplete":
        case "cancelled":
        case "completed":
        case "failed":
        case "expired":
          return run;
      }
    }
  }
  /**
   * Create a Run stream
   */
  stream(threadId, body, options) {
    return AssistantStream.createAssistantStream(threadId, this._client.beta.threads.runs, body, options);
  }
  submitToolOutputs(runID, params, options) {
    const { thread_id, ...body } = params;
    return this._client.post(path`/threads/${thread_id}/runs/${runID}/submit_tool_outputs`, {
      body,
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers]),
      stream: params.stream ?? false,
      __synthesizeEventData: true
    });
  }
  /**
   * A helper to submit a tool output to a run and poll for a terminal run state.
   * More information on Run lifecycles can be found here:
   * https://platform.openai.com/docs/assistants/how-it-works/runs-and-run-steps
   */
  async submitToolOutputsAndPoll(runId, params, options) {
    const run = await this.submitToolOutputs(runId, params, options);
    return await this.poll(run.id, params, options);
  }
  /**
   * Submit the tool outputs from a previous run and stream the run to a terminal
   * state. More information on Run lifecycles can be found here:
   * https://platform.openai.com/docs/assistants/how-it-works/runs-and-run-steps
   */
  submitToolOutputsStream(runId, params, options) {
    return AssistantStream.createToolAssistantStream(runId, this._client.beta.threads.runs, params, options);
  }
};
Runs.Steps = Steps;

// node_modules/openai/resources/beta/threads/threads.mjs
var Threads2 = class extends APIResource {
  constructor() {
    super(...arguments);
    this.runs = new Runs(this._client);
    this.messages = new Messages2(this._client);
  }
  /**
   * Create a thread.
   *
   * @deprecated The Assistants API is deprecated in favor of the Responses API
   */
  create(body = {}, options) {
    return this._client.post("/threads", {
      body,
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers])
    });
  }
  /**
   * Retrieves a thread.
   *
   * @deprecated The Assistants API is deprecated in favor of the Responses API
   */
  retrieve(threadID, options) {
    return this._client.get(path`/threads/${threadID}`, {
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers])
    });
  }
  /**
   * Modifies a thread.
   *
   * @deprecated The Assistants API is deprecated in favor of the Responses API
   */
  update(threadID, body, options) {
    return this._client.post(path`/threads/${threadID}`, {
      body,
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers])
    });
  }
  /**
   * Delete a thread.
   *
   * @deprecated The Assistants API is deprecated in favor of the Responses API
   */
  delete(threadID, options) {
    return this._client.delete(path`/threads/${threadID}`, {
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers])
    });
  }
  createAndRun(body, options) {
    return this._client.post("/threads/runs", {
      body,
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers]),
      stream: body.stream ?? false,
      __synthesizeEventData: true
    });
  }
  /**
   * A helper to create a thread, start a run and then poll for a terminal state.
   * More information on Run lifecycles can be found here:
   * https://platform.openai.com/docs/assistants/how-it-works/runs-and-run-steps
   */
  async createAndRunPoll(body, options) {
    const run = await this.createAndRun(body, options);
    return await this.runs.poll(run.id, { thread_id: run.thread_id }, options);
  }
  /**
   * Create a thread and stream the run back
   */
  createAndRunStream(body, options) {
    return AssistantStream.createThreadAssistantStream(body, this._client.beta.threads, options);
  }
};
Threads2.Runs = Runs;
Threads2.Messages = Messages2;

// node_modules/openai/resources/beta/beta.mjs
var Beta = class extends APIResource {
  constructor() {
    super(...arguments);
    this.realtime = new Realtime(this._client);
    this.chatkit = new ChatKit(this._client);
    this.assistants = new Assistants(this._client);
    this.threads = new Threads2(this._client);
  }
};
Beta.Realtime = Realtime;
Beta.ChatKit = ChatKit;
Beta.Assistants = Assistants;
Beta.Threads = Threads2;

// node_modules/openai/resources/completions.mjs
var Completions2 = class extends APIResource {
  create(body, options) {
    return this._client.post("/completions", { body, ...options, stream: body.stream ?? false });
  }
};

// node_modules/openai/resources/containers/files/content.mjs
var Content = class extends APIResource {
  /**
   * Retrieve Container File Content
   */
  retrieve(fileID, params, options) {
    const { container_id } = params;
    return this._client.get(path`/containers/${container_id}/files/${fileID}/content`, {
      ...options,
      headers: buildHeaders([{ Accept: "application/binary" }, options?.headers]),
      __binaryResponse: true
    });
  }
};

// node_modules/openai/resources/containers/files/files.mjs
var Files = class extends APIResource {
  constructor() {
    super(...arguments);
    this.content = new Content(this._client);
  }
  /**
   * Create a Container File
   *
   * You can send either a multipart/form-data request with the raw file content, or
   * a JSON request with a file ID.
   */
  create(containerID, body, options) {
    return this._client.post(path`/containers/${containerID}/files`, maybeMultipartFormRequestOptions({ body, ...options }, this._client));
  }
  /**
   * Retrieve Container File
   */
  retrieve(fileID, params, options) {
    const { container_id } = params;
    return this._client.get(path`/containers/${container_id}/files/${fileID}`, options);
  }
  /**
   * List Container files
   */
  list(containerID, query = {}, options) {
    return this._client.getAPIList(path`/containers/${containerID}/files`, CursorPage, {
      query,
      ...options
    });
  }
  /**
   * Delete Container File
   */
  delete(fileID, params, options) {
    const { container_id } = params;
    return this._client.delete(path`/containers/${container_id}/files/${fileID}`, {
      ...options,
      headers: buildHeaders([{ Accept: "*/*" }, options?.headers])
    });
  }
};
Files.Content = Content;

// node_modules/openai/resources/containers/containers.mjs
var Containers = class extends APIResource {
  constructor() {
    super(...arguments);
    this.files = new Files(this._client);
  }
  /**
   * Create Container
   */
  create(body, options) {
    return this._client.post("/containers", { body, ...options });
  }
  /**
   * Retrieve Container
   */
  retrieve(containerID, options) {
    return this._client.get(path`/containers/${containerID}`, options);
  }
  /**
   * List Containers
   */
  list(query = {}, options) {
    return this._client.getAPIList("/containers", CursorPage, { query, ...options });
  }
  /**
   * Delete Container
   */
  delete(containerID, options) {
    return this._client.delete(path`/containers/${containerID}`, {
      ...options,
      headers: buildHeaders([{ Accept: "*/*" }, options?.headers])
    });
  }
};
Containers.Files = Files;

// node_modules/openai/resources/conversations/items.mjs
var Items = class extends APIResource {
  /**
   * Create items in a conversation with the given ID.
   */
  create(conversationID, params, options) {
    const { include, ...body } = params;
    return this._client.post(path`/conversations/${conversationID}/items`, {
      query: { include },
      body,
      ...options
    });
  }
  /**
   * Get a single item from a conversation with the given IDs.
   */
  retrieve(itemID, params, options) {
    const { conversation_id, ...query } = params;
    return this._client.get(path`/conversations/${conversation_id}/items/${itemID}`, { query, ...options });
  }
  /**
   * List all items for a conversation with the given ID.
   */
  list(conversationID, query = {}, options) {
    return this._client.getAPIList(path`/conversations/${conversationID}/items`, ConversationCursorPage, { query, ...options });
  }
  /**
   * Delete an item from a conversation with the given IDs.
   */
  delete(itemID, params, options) {
    const { conversation_id } = params;
    return this._client.delete(path`/conversations/${conversation_id}/items/${itemID}`, options);
  }
};

// node_modules/openai/resources/conversations/conversations.mjs
var Conversations = class extends APIResource {
  constructor() {
    super(...arguments);
    this.items = new Items(this._client);
  }
  /**
   * Create a conversation.
   */
  create(body = {}, options) {
    return this._client.post("/conversations", { body, ...options });
  }
  /**
   * Get a conversation
   */
  retrieve(conversationID, options) {
    return this._client.get(path`/conversations/${conversationID}`, options);
  }
  /**
   * Update a conversation
   */
  update(conversationID, body, options) {
    return this._client.post(path`/conversations/${conversationID}`, { body, ...options });
  }
  /**
   * Delete a conversation. Items in the conversation will not be deleted.
   */
  delete(conversationID, options) {
    return this._client.delete(path`/conversations/${conversationID}`, options);
  }
};
Conversations.Items = Items;

// node_modules/openai/resources/embeddings.mjs
var Embeddings = class extends APIResource {
  /**
   * Creates an embedding vector representing the input text.
   *
   * @example
   * ```ts
   * const createEmbeddingResponse =
   *   await client.embeddings.create({
   *     input: 'The quick brown fox jumped over the lazy dog',
   *     model: 'text-embedding-3-small',
   *   });
   * ```
   */
  create(body, options) {
    const hasUserProvidedEncodingFormat = !!body.encoding_format;
    let encoding_format = hasUserProvidedEncodingFormat ? body.encoding_format : "base64";
    if (hasUserProvidedEncodingFormat) {
      loggerFor(this._client).debug("embeddings/user defined encoding_format:", body.encoding_format);
    }
    const response = this._client.post("/embeddings", {
      body: {
        ...body,
        encoding_format
      },
      ...options
    });
    if (hasUserProvidedEncodingFormat) {
      return response;
    }
    loggerFor(this._client).debug("embeddings/decoding base64 embeddings from base64");
    return response._thenUnwrap((response2) => {
      if (response2 && response2.data) {
        response2.data.forEach((embeddingBase64Obj) => {
          const embeddingBase64Str = embeddingBase64Obj.embedding;
          embeddingBase64Obj.embedding = toFloat32Array(embeddingBase64Str);
        });
      }
      return response2;
    });
  }
};

// node_modules/openai/resources/evals/runs/output-items.mjs
var OutputItems = class extends APIResource {
  /**
   * Get an evaluation run output item by ID.
   */
  retrieve(outputItemID, params, options) {
    const { eval_id, run_id } = params;
    return this._client.get(path`/evals/${eval_id}/runs/${run_id}/output_items/${outputItemID}`, options);
  }
  /**
   * Get a list of output items for an evaluation run.
   */
  list(runID, params, options) {
    const { eval_id, ...query } = params;
    return this._client.getAPIList(path`/evals/${eval_id}/runs/${runID}/output_items`, CursorPage, { query, ...options });
  }
};

// node_modules/openai/resources/evals/runs/runs.mjs
var Runs2 = class extends APIResource {
  constructor() {
    super(...arguments);
    this.outputItems = new OutputItems(this._client);
  }
  /**
   * Kicks off a new run for a given evaluation, specifying the data source, and what
   * model configuration to use to test. The datasource will be validated against the
   * schema specified in the config of the evaluation.
   */
  create(evalID, body, options) {
    return this._client.post(path`/evals/${evalID}/runs`, { body, ...options });
  }
  /**
   * Get an evaluation run by ID.
   */
  retrieve(runID, params, options) {
    const { eval_id } = params;
    return this._client.get(path`/evals/${eval_id}/runs/${runID}`, options);
  }
  /**
   * Get a list of runs for an evaluation.
   */
  list(evalID, query = {}, options) {
    return this._client.getAPIList(path`/evals/${evalID}/runs`, CursorPage, {
      query,
      ...options
    });
  }
  /**
   * Delete an eval run.
   */
  delete(runID, params, options) {
    const { eval_id } = params;
    return this._client.delete(path`/evals/${eval_id}/runs/${runID}`, options);
  }
  /**
   * Cancel an ongoing evaluation run.
   */
  cancel(runID, params, options) {
    const { eval_id } = params;
    return this._client.post(path`/evals/${eval_id}/runs/${runID}`, options);
  }
};
Runs2.OutputItems = OutputItems;

// node_modules/openai/resources/evals/evals.mjs
var Evals = class extends APIResource {
  constructor() {
    super(...arguments);
    this.runs = new Runs2(this._client);
  }
  /**
   * Create the structure of an evaluation that can be used to test a model's
   * performance. An evaluation is a set of testing criteria and the config for a
   * data source, which dictates the schema of the data used in the evaluation. After
   * creating an evaluation, you can run it on different models and model parameters.
   * We support several types of graders and datasources. For more information, see
   * the [Evals guide](https://platform.openai.com/docs/guides/evals).
   */
  create(body, options) {
    return this._client.post("/evals", { body, ...options });
  }
  /**
   * Get an evaluation by ID.
   */
  retrieve(evalID, options) {
    return this._client.get(path`/evals/${evalID}`, options);
  }
  /**
   * Update certain properties of an evaluation.
   */
  update(evalID, body, options) {
    return this._client.post(path`/evals/${evalID}`, { body, ...options });
  }
  /**
   * List evaluations for a project.
   */
  list(query = {}, options) {
    return this._client.getAPIList("/evals", CursorPage, { query, ...options });
  }
  /**
   * Delete an evaluation.
   */
  delete(evalID, options) {
    return this._client.delete(path`/evals/${evalID}`, options);
  }
};
Evals.Runs = Runs2;

// node_modules/openai/resources/files.mjs
var Files2 = class extends APIResource {
  /**
   * Upload a file that can be used across various endpoints. Individual files can be
   * up to 512 MB, and each project can store up to 2.5 TB of files in total. There
   * is no organization-wide storage limit.
   *
   * - The Assistants API supports files up to 2 million tokens and of specific file
   *   types. See the
   *   [Assistants Tools guide](https://platform.openai.com/docs/assistants/tools)
   *   for details.
   * - The Fine-tuning API only supports `.jsonl` files. The input also has certain
   *   required formats for fine-tuning
   *   [chat](https://platform.openai.com/docs/api-reference/fine-tuning/chat-input)
   *   or
   *   [completions](https://platform.openai.com/docs/api-reference/fine-tuning/completions-input)
   *   models.
   * - The Batch API only supports `.jsonl` files up to 200 MB in size. The input
   *   also has a specific required
   *   [format](https://platform.openai.com/docs/api-reference/batch/request-input).
   *
   * Please [contact us](https://help.openai.com/) if you need to increase these
   * storage limits.
   */
  create(body, options) {
    return this._client.post("/files", multipartFormRequestOptions({ body, ...options }, this._client));
  }
  /**
   * Returns information about a specific file.
   */
  retrieve(fileID, options) {
    return this._client.get(path`/files/${fileID}`, options);
  }
  /**
   * Returns a list of files.
   */
  list(query = {}, options) {
    return this._client.getAPIList("/files", CursorPage, { query, ...options });
  }
  /**
   * Delete a file and remove it from all vector stores.
   */
  delete(fileID, options) {
    return this._client.delete(path`/files/${fileID}`, options);
  }
  /**
   * Returns the contents of the specified file.
   */
  content(fileID, options) {
    return this._client.get(path`/files/${fileID}/content`, {
      ...options,
      headers: buildHeaders([{ Accept: "application/binary" }, options?.headers]),
      __binaryResponse: true
    });
  }
  /**
   * Waits for the given file to be processed, default timeout is 30 mins.
   */
  async waitForProcessing(id, { pollInterval = 5e3, maxWait = 30 * 60 * 1e3 } = {}) {
    const TERMINAL_STATES = /* @__PURE__ */ new Set(["processed", "error", "deleted"]);
    const start = Date.now();
    let file = await this.retrieve(id);
    while (!file.status || !TERMINAL_STATES.has(file.status)) {
      await sleep(pollInterval);
      file = await this.retrieve(id);
      if (Date.now() - start > maxWait) {
        throw new APIConnectionTimeoutError({
          message: `Giving up on waiting for file ${id} to finish processing after ${maxWait} milliseconds.`
        });
      }
    }
    return file;
  }
};

// node_modules/openai/resources/fine-tuning/methods.mjs
var Methods = class extends APIResource {
};

// node_modules/openai/resources/fine-tuning/alpha/graders.mjs
var Graders = class extends APIResource {
  /**
   * Run a grader.
   *
   * @example
   * ```ts
   * const response = await client.fineTuning.alpha.graders.run({
   *   grader: {
   *     input: 'input',
   *     name: 'name',
   *     operation: 'eq',
   *     reference: 'reference',
   *     type: 'string_check',
   *   },
   *   model_sample: 'model_sample',
   * });
   * ```
   */
  run(body, options) {
    return this._client.post("/fine_tuning/alpha/graders/run", { body, ...options });
  }
  /**
   * Validate a grader.
   *
   * @example
   * ```ts
   * const response =
   *   await client.fineTuning.alpha.graders.validate({
   *     grader: {
   *       input: 'input',
   *       name: 'name',
   *       operation: 'eq',
   *       reference: 'reference',
   *       type: 'string_check',
   *     },
   *   });
   * ```
   */
  validate(body, options) {
    return this._client.post("/fine_tuning/alpha/graders/validate", { body, ...options });
  }
};

// node_modules/openai/resources/fine-tuning/alpha/alpha.mjs
var Alpha = class extends APIResource {
  constructor() {
    super(...arguments);
    this.graders = new Graders(this._client);
  }
};
Alpha.Graders = Graders;

// node_modules/openai/resources/fine-tuning/checkpoints/permissions.mjs
var Permissions = class extends APIResource {
  /**
   * **NOTE:** Calling this endpoint requires an [admin API key](../admin-api-keys).
   *
   * This enables organization owners to share fine-tuned models with other projects
   * in their organization.
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const permissionCreateResponse of client.fineTuning.checkpoints.permissions.create(
   *   'ft:gpt-4o-mini-2024-07-18:org:weather:B7R9VjQd',
   *   { project_ids: ['string'] },
   * )) {
   *   // ...
   * }
   * ```
   */
  create(fineTunedModelCheckpoint, body, options) {
    return this._client.getAPIList(path`/fine_tuning/checkpoints/${fineTunedModelCheckpoint}/permissions`, Page, { body, method: "post", ...options });
  }
  /**
   * **NOTE:** This endpoint requires an [admin API key](../admin-api-keys).
   *
   * Organization owners can use this endpoint to view all permissions for a
   * fine-tuned model checkpoint.
   *
   * @deprecated Retrieve is deprecated. Please swap to the paginated list method instead.
   */
  retrieve(fineTunedModelCheckpoint, query = {}, options) {
    return this._client.get(path`/fine_tuning/checkpoints/${fineTunedModelCheckpoint}/permissions`, {
      query,
      ...options
    });
  }
  /**
   * **NOTE:** This endpoint requires an [admin API key](../admin-api-keys).
   *
   * Organization owners can use this endpoint to view all permissions for a
   * fine-tuned model checkpoint.
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const permissionListResponse of client.fineTuning.checkpoints.permissions.list(
   *   'ft-AF1WoRqd3aJAHsqc9NY7iL8F',
   * )) {
   *   // ...
   * }
   * ```
   */
  list(fineTunedModelCheckpoint, query = {}, options) {
    return this._client.getAPIList(path`/fine_tuning/checkpoints/${fineTunedModelCheckpoint}/permissions`, ConversationCursorPage, { query, ...options });
  }
  /**
   * **NOTE:** This endpoint requires an [admin API key](../admin-api-keys).
   *
   * Organization owners can use this endpoint to delete a permission for a
   * fine-tuned model checkpoint.
   *
   * @example
   * ```ts
   * const permission =
   *   await client.fineTuning.checkpoints.permissions.delete(
   *     'cp_zc4Q7MP6XxulcVzj4MZdwsAB',
   *     {
   *       fine_tuned_model_checkpoint:
   *         'ft:gpt-4o-mini-2024-07-18:org:weather:B7R9VjQd',
   *     },
   *   );
   * ```
   */
  delete(permissionID, params, options) {
    const { fine_tuned_model_checkpoint } = params;
    return this._client.delete(path`/fine_tuning/checkpoints/${fine_tuned_model_checkpoint}/permissions/${permissionID}`, options);
  }
};

// node_modules/openai/resources/fine-tuning/checkpoints/checkpoints.mjs
var Checkpoints = class extends APIResource {
  constructor() {
    super(...arguments);
    this.permissions = new Permissions(this._client);
  }
};
Checkpoints.Permissions = Permissions;

// node_modules/openai/resources/fine-tuning/jobs/checkpoints.mjs
var Checkpoints2 = class extends APIResource {
  /**
   * List checkpoints for a fine-tuning job.
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const fineTuningJobCheckpoint of client.fineTuning.jobs.checkpoints.list(
   *   'ft-AF1WoRqd3aJAHsqc9NY7iL8F',
   * )) {
   *   // ...
   * }
   * ```
   */
  list(fineTuningJobID, query = {}, options) {
    return this._client.getAPIList(path`/fine_tuning/jobs/${fineTuningJobID}/checkpoints`, CursorPage, { query, ...options });
  }
};

// node_modules/openai/resources/fine-tuning/jobs/jobs.mjs
var Jobs = class extends APIResource {
  constructor() {
    super(...arguments);
    this.checkpoints = new Checkpoints2(this._client);
  }
  /**
   * Creates a fine-tuning job which begins the process of creating a new model from
   * a given dataset.
   *
   * Response includes details of the enqueued job including job status and the name
   * of the fine-tuned models once complete.
   *
   * [Learn more about fine-tuning](https://platform.openai.com/docs/guides/model-optimization)
   *
   * @example
   * ```ts
   * const fineTuningJob = await client.fineTuning.jobs.create({
   *   model: 'gpt-4o-mini',
   *   training_file: 'file-abc123',
   * });
   * ```
   */
  create(body, options) {
    return this._client.post("/fine_tuning/jobs", { body, ...options });
  }
  /**
   * Get info about a fine-tuning job.
   *
   * [Learn more about fine-tuning](https://platform.openai.com/docs/guides/model-optimization)
   *
   * @example
   * ```ts
   * const fineTuningJob = await client.fineTuning.jobs.retrieve(
   *   'ft-AF1WoRqd3aJAHsqc9NY7iL8F',
   * );
   * ```
   */
  retrieve(fineTuningJobID, options) {
    return this._client.get(path`/fine_tuning/jobs/${fineTuningJobID}`, options);
  }
  /**
   * List your organization's fine-tuning jobs
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const fineTuningJob of client.fineTuning.jobs.list()) {
   *   // ...
   * }
   * ```
   */
  list(query = {}, options) {
    return this._client.getAPIList("/fine_tuning/jobs", CursorPage, { query, ...options });
  }
  /**
   * Immediately cancel a fine-tune job.
   *
   * @example
   * ```ts
   * const fineTuningJob = await client.fineTuning.jobs.cancel(
   *   'ft-AF1WoRqd3aJAHsqc9NY7iL8F',
   * );
   * ```
   */
  cancel(fineTuningJobID, options) {
    return this._client.post(path`/fine_tuning/jobs/${fineTuningJobID}/cancel`, options);
  }
  /**
   * Get status updates for a fine-tuning job.
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const fineTuningJobEvent of client.fineTuning.jobs.listEvents(
   *   'ft-AF1WoRqd3aJAHsqc9NY7iL8F',
   * )) {
   *   // ...
   * }
   * ```
   */
  listEvents(fineTuningJobID, query = {}, options) {
    return this._client.getAPIList(path`/fine_tuning/jobs/${fineTuningJobID}/events`, CursorPage, { query, ...options });
  }
  /**
   * Pause a fine-tune job.
   *
   * @example
   * ```ts
   * const fineTuningJob = await client.fineTuning.jobs.pause(
   *   'ft-AF1WoRqd3aJAHsqc9NY7iL8F',
   * );
   * ```
   */
  pause(fineTuningJobID, options) {
    return this._client.post(path`/fine_tuning/jobs/${fineTuningJobID}/pause`, options);
  }
  /**
   * Resume a fine-tune job.
   *
   * @example
   * ```ts
   * const fineTuningJob = await client.fineTuning.jobs.resume(
   *   'ft-AF1WoRqd3aJAHsqc9NY7iL8F',
   * );
   * ```
   */
  resume(fineTuningJobID, options) {
    return this._client.post(path`/fine_tuning/jobs/${fineTuningJobID}/resume`, options);
  }
};
Jobs.Checkpoints = Checkpoints2;

// node_modules/openai/resources/fine-tuning/fine-tuning.mjs
var FineTuning = class extends APIResource {
  constructor() {
    super(...arguments);
    this.methods = new Methods(this._client);
    this.jobs = new Jobs(this._client);
    this.checkpoints = new Checkpoints(this._client);
    this.alpha = new Alpha(this._client);
  }
};
FineTuning.Methods = Methods;
FineTuning.Jobs = Jobs;
FineTuning.Checkpoints = Checkpoints;
FineTuning.Alpha = Alpha;

// node_modules/openai/resources/graders/grader-models.mjs
var GraderModels = class extends APIResource {
};

// node_modules/openai/resources/graders/graders.mjs
var Graders2 = class extends APIResource {
  constructor() {
    super(...arguments);
    this.graderModels = new GraderModels(this._client);
  }
};
Graders2.GraderModels = GraderModels;

// node_modules/openai/resources/images.mjs
var Images = class extends APIResource {
  /**
   * Creates a variation of a given image. This endpoint only supports `dall-e-2`.
   *
   * @example
   * ```ts
   * const imagesResponse = await client.images.createVariation({
   *   image: fs.createReadStream('otter.png'),
   * });
   * ```
   */
  createVariation(body, options) {
    return this._client.post("/images/variations", multipartFormRequestOptions({ body, ...options }, this._client));
  }
  edit(body, options) {
    return this._client.post("/images/edits", multipartFormRequestOptions({ body, ...options, stream: body.stream ?? false }, this._client));
  }
  generate(body, options) {
    return this._client.post("/images/generations", { body, ...options, stream: body.stream ?? false });
  }
};

// node_modules/openai/resources/models.mjs
var Models = class extends APIResource {
  /**
   * Retrieves a model instance, providing basic information about the model such as
   * the owner and permissioning.
   */
  retrieve(model, options) {
    return this._client.get(path`/models/${model}`, options);
  }
  /**
   * Lists the currently available models, and provides basic information about each
   * one such as the owner and availability.
   */
  list(options) {
    return this._client.getAPIList("/models", Page, options);
  }
  /**
   * Delete a fine-tuned model. You must have the Owner role in your organization to
   * delete a model.
   */
  delete(model, options) {
    return this._client.delete(path`/models/${model}`, options);
  }
};

// node_modules/openai/resources/moderations.mjs
var Moderations = class extends APIResource {
  /**
   * Classifies if text and/or image inputs are potentially harmful. Learn more in
   * the [moderation guide](https://platform.openai.com/docs/guides/moderation).
   */
  create(body, options) {
    return this._client.post("/moderations", { body, ...options });
  }
};

// node_modules/openai/resources/realtime/calls.mjs
var Calls = class extends APIResource {
  /**
   * Accept an incoming SIP call and configure the realtime session that will handle
   * it.
   *
   * @example
   * ```ts
   * await client.realtime.calls.accept('call_id', {
   *   type: 'realtime',
   * });
   * ```
   */
  accept(callID, body, options) {
    return this._client.post(path`/realtime/calls/${callID}/accept`, {
      body,
      ...options,
      headers: buildHeaders([{ Accept: "*/*" }, options?.headers])
    });
  }
  /**
   * End an active Realtime API call, whether it was initiated over SIP or WebRTC.
   *
   * @example
   * ```ts
   * await client.realtime.calls.hangup('call_id');
   * ```
   */
  hangup(callID, options) {
    return this._client.post(path`/realtime/calls/${callID}/hangup`, {
      ...options,
      headers: buildHeaders([{ Accept: "*/*" }, options?.headers])
    });
  }
  /**
   * Transfer an active SIP call to a new destination using the SIP REFER verb.
   *
   * @example
   * ```ts
   * await client.realtime.calls.refer('call_id', {
   *   target_uri: 'tel:+14155550123',
   * });
   * ```
   */
  refer(callID, body, options) {
    return this._client.post(path`/realtime/calls/${callID}/refer`, {
      body,
      ...options,
      headers: buildHeaders([{ Accept: "*/*" }, options?.headers])
    });
  }
  /**
   * Decline an incoming SIP call by returning a SIP status code to the caller.
   *
   * @example
   * ```ts
   * await client.realtime.calls.reject('call_id');
   * ```
   */
  reject(callID, body = {}, options) {
    return this._client.post(path`/realtime/calls/${callID}/reject`, {
      body,
      ...options,
      headers: buildHeaders([{ Accept: "*/*" }, options?.headers])
    });
  }
};

// node_modules/openai/resources/realtime/client-secrets.mjs
var ClientSecrets = class extends APIResource {
  /**
   * Create a Realtime client secret with an associated session configuration.
   *
   * Client secrets are short-lived tokens that can be passed to a client app, such
   * as a web frontend or mobile client, which grants access to the Realtime API
   * without leaking your main API key. You can configure a custom TTL for each
   * client secret.
   *
   * You can also attach session configuration options to the client secret, which
   * will be applied to any sessions created using that client secret, but these can
   * also be overridden by the client connection.
   *
   * [Learn more about authentication with client secrets over WebRTC](https://platform.openai.com/docs/guides/realtime-webrtc).
   *
   * Returns the created client secret and the effective session object. The client
   * secret is a string that looks like `ek_1234`.
   *
   * @example
   * ```ts
   * const clientSecret =
   *   await client.realtime.clientSecrets.create();
   * ```
   */
  create(body, options) {
    return this._client.post("/realtime/client_secrets", { body, ...options });
  }
};

// node_modules/openai/resources/realtime/realtime.mjs
var Realtime2 = class extends APIResource {
  constructor() {
    super(...arguments);
    this.clientSecrets = new ClientSecrets(this._client);
    this.calls = new Calls(this._client);
  }
};
Realtime2.ClientSecrets = ClientSecrets;
Realtime2.Calls = Calls;

// node_modules/openai/lib/ResponsesParser.mjs
function maybeParseResponse(response, params) {
  if (!params || !hasAutoParseableInput2(params)) {
    return {
      ...response,
      output_parsed: null,
      output: response.output.map((item) => {
        if (item.type === "function_call") {
          return {
            ...item,
            parsed_arguments: null
          };
        }
        if (item.type === "message") {
          return {
            ...item,
            content: item.content.map((content) => ({
              ...content,
              parsed: null
            }))
          };
        } else {
          return item;
        }
      })
    };
  }
  return parseResponse(response, params);
}
function parseResponse(response, params) {
  const output = response.output.map((item) => {
    if (item.type === "function_call") {
      return {
        ...item,
        parsed_arguments: parseToolCall2(params, item)
      };
    }
    if (item.type === "message") {
      const content = item.content.map((content2) => {
        if (content2.type === "output_text") {
          return {
            ...content2,
            parsed: parseTextFormat(params, content2.text)
          };
        }
        return content2;
      });
      return {
        ...item,
        content
      };
    }
    return item;
  });
  const parsed = Object.assign({}, response, { output });
  if (!Object.getOwnPropertyDescriptor(response, "output_text")) {
    addOutputText(parsed);
  }
  Object.defineProperty(parsed, "output_parsed", {
    enumerable: true,
    get() {
      for (const output2 of parsed.output) {
        if (output2.type !== "message") {
          continue;
        }
        for (const content of output2.content) {
          if (content.type === "output_text" && content.parsed !== null) {
            return content.parsed;
          }
        }
      }
      return null;
    }
  });
  return parsed;
}
function parseTextFormat(params, content) {
  if (params.text?.format?.type !== "json_schema") {
    return null;
  }
  if ("$parseRaw" in params.text?.format) {
    const text_format = params.text?.format;
    return text_format.$parseRaw(content);
  }
  return JSON.parse(content);
}
function hasAutoParseableInput2(params) {
  if (isAutoParsableResponseFormat(params.text?.format)) {
    return true;
  }
  return false;
}
function isAutoParsableTool2(tool) {
  return tool?.["$brand"] === "auto-parseable-tool";
}
function getInputToolByName(input_tools, name) {
  return input_tools.find((tool) => tool.type === "function" && tool.name === name);
}
function parseToolCall2(params, toolCall) {
  const inputTool = getInputToolByName(params.tools ?? [], toolCall.name);
  return {
    ...toolCall,
    ...toolCall,
    parsed_arguments: isAutoParsableTool2(inputTool) ? inputTool.$parseRaw(toolCall.arguments) : inputTool?.strict ? JSON.parse(toolCall.arguments) : null
  };
}
function addOutputText(rsp) {
  const texts = [];
  for (const output of rsp.output) {
    if (output.type !== "message") {
      continue;
    }
    for (const content of output.content) {
      if (content.type === "output_text") {
        texts.push(content.text);
      }
    }
  }
  rsp.output_text = texts.join("");
}

// node_modules/openai/lib/responses/ResponseStream.mjs
var _ResponseStream_instances;
var _ResponseStream_params;
var _ResponseStream_currentResponseSnapshot;
var _ResponseStream_finalResponse;
var _ResponseStream_beginRequest;
var _ResponseStream_addEvent;
var _ResponseStream_endRequest;
var _ResponseStream_accumulateResponse;
var ResponseStream = class _ResponseStream extends EventStream {
  constructor(params) {
    super();
    _ResponseStream_instances.add(this);
    _ResponseStream_params.set(this, void 0);
    _ResponseStream_currentResponseSnapshot.set(this, void 0);
    _ResponseStream_finalResponse.set(this, void 0);
    __classPrivateFieldSet(this, _ResponseStream_params, params, "f");
  }
  static createResponse(client, params, options) {
    const runner = new _ResponseStream(params);
    runner._run(() => runner._createOrRetrieveResponse(client, params, {
      ...options,
      headers: { ...options?.headers, "X-Stainless-Helper-Method": "stream" }
    }));
    return runner;
  }
  async _createOrRetrieveResponse(client, params, options) {
    const signal = options?.signal;
    if (signal) {
      if (signal.aborted)
        this.controller.abort();
      signal.addEventListener("abort", () => this.controller.abort());
    }
    __classPrivateFieldGet(this, _ResponseStream_instances, "m", _ResponseStream_beginRequest).call(this);
    let stream;
    let starting_after = null;
    if ("response_id" in params) {
      stream = await client.responses.retrieve(params.response_id, { stream: true }, { ...options, signal: this.controller.signal, stream: true });
      starting_after = params.starting_after ?? null;
    } else {
      stream = await client.responses.create({ ...params, stream: true }, { ...options, signal: this.controller.signal });
    }
    this._connected();
    for await (const event of stream) {
      __classPrivateFieldGet(this, _ResponseStream_instances, "m", _ResponseStream_addEvent).call(this, event, starting_after);
    }
    if (stream.controller.signal?.aborted) {
      throw new APIUserAbortError();
    }
    return __classPrivateFieldGet(this, _ResponseStream_instances, "m", _ResponseStream_endRequest).call(this);
  }
  [(_ResponseStream_params = /* @__PURE__ */ new WeakMap(), _ResponseStream_currentResponseSnapshot = /* @__PURE__ */ new WeakMap(), _ResponseStream_finalResponse = /* @__PURE__ */ new WeakMap(), _ResponseStream_instances = /* @__PURE__ */ new WeakSet(), _ResponseStream_beginRequest = function _ResponseStream_beginRequest2() {
    if (this.ended)
      return;
    __classPrivateFieldSet(this, _ResponseStream_currentResponseSnapshot, void 0, "f");
  }, _ResponseStream_addEvent = function _ResponseStream_addEvent2(event, starting_after) {
    if (this.ended)
      return;
    const maybeEmit = (name, event2) => {
      if (starting_after == null || event2.sequence_number > starting_after) {
        this._emit(name, event2);
      }
    };
    const response = __classPrivateFieldGet(this, _ResponseStream_instances, "m", _ResponseStream_accumulateResponse).call(this, event);
    maybeEmit("event", event);
    switch (event.type) {
      case "response.output_text.delta": {
        const output = response.output[event.output_index];
        if (!output) {
          throw new OpenAIError(`missing output at index ${event.output_index}`);
        }
        if (output.type === "message") {
          const content = output.content[event.content_index];
          if (!content) {
            throw new OpenAIError(`missing content at index ${event.content_index}`);
          }
          if (content.type !== "output_text") {
            throw new OpenAIError(`expected content to be 'output_text', got ${content.type}`);
          }
          maybeEmit("response.output_text.delta", {
            ...event,
            snapshot: content.text
          });
        }
        break;
      }
      case "response.function_call_arguments.delta": {
        const output = response.output[event.output_index];
        if (!output) {
          throw new OpenAIError(`missing output at index ${event.output_index}`);
        }
        if (output.type === "function_call") {
          maybeEmit("response.function_call_arguments.delta", {
            ...event,
            snapshot: output.arguments
          });
        }
        break;
      }
      default:
        maybeEmit(event.type, event);
        break;
    }
  }, _ResponseStream_endRequest = function _ResponseStream_endRequest2() {
    if (this.ended) {
      throw new OpenAIError(`stream has ended, this shouldn't happen`);
    }
    const snapshot = __classPrivateFieldGet(this, _ResponseStream_currentResponseSnapshot, "f");
    if (!snapshot) {
      throw new OpenAIError(`request ended without sending any events`);
    }
    __classPrivateFieldSet(this, _ResponseStream_currentResponseSnapshot, void 0, "f");
    const parsedResponse = finalizeResponse(snapshot, __classPrivateFieldGet(this, _ResponseStream_params, "f"));
    __classPrivateFieldSet(this, _ResponseStream_finalResponse, parsedResponse, "f");
    return parsedResponse;
  }, _ResponseStream_accumulateResponse = function _ResponseStream_accumulateResponse2(event) {
    let snapshot = __classPrivateFieldGet(this, _ResponseStream_currentResponseSnapshot, "f");
    if (!snapshot) {
      if (event.type !== "response.created") {
        throw new OpenAIError(`When snapshot hasn't been set yet, expected 'response.created' event, got ${event.type}`);
      }
      snapshot = __classPrivateFieldSet(this, _ResponseStream_currentResponseSnapshot, event.response, "f");
      return snapshot;
    }
    switch (event.type) {
      case "response.output_item.added": {
        snapshot.output.push(event.item);
        break;
      }
      case "response.content_part.added": {
        const output = snapshot.output[event.output_index];
        if (!output) {
          throw new OpenAIError(`missing output at index ${event.output_index}`);
        }
        const type = output.type;
        const part = event.part;
        if (type === "message" && part.type !== "reasoning_text") {
          output.content.push(part);
        } else if (type === "reasoning" && part.type === "reasoning_text") {
          if (!output.content) {
            output.content = [];
          }
          output.content.push(part);
        }
        break;
      }
      case "response.output_text.delta": {
        const output = snapshot.output[event.output_index];
        if (!output) {
          throw new OpenAIError(`missing output at index ${event.output_index}`);
        }
        if (output.type === "message") {
          const content = output.content[event.content_index];
          if (!content) {
            throw new OpenAIError(`missing content at index ${event.content_index}`);
          }
          if (content.type !== "output_text") {
            throw new OpenAIError(`expected content to be 'output_text', got ${content.type}`);
          }
          content.text += event.delta;
        }
        break;
      }
      case "response.function_call_arguments.delta": {
        const output = snapshot.output[event.output_index];
        if (!output) {
          throw new OpenAIError(`missing output at index ${event.output_index}`);
        }
        if (output.type === "function_call") {
          output.arguments += event.delta;
        }
        break;
      }
      case "response.reasoning_text.delta": {
        const output = snapshot.output[event.output_index];
        if (!output) {
          throw new OpenAIError(`missing output at index ${event.output_index}`);
        }
        if (output.type === "reasoning") {
          const content = output.content?.[event.content_index];
          if (!content) {
            throw new OpenAIError(`missing content at index ${event.content_index}`);
          }
          if (content.type !== "reasoning_text") {
            throw new OpenAIError(`expected content to be 'reasoning_text', got ${content.type}`);
          }
          content.text += event.delta;
        }
        break;
      }
      case "response.completed": {
        __classPrivateFieldSet(this, _ResponseStream_currentResponseSnapshot, event.response, "f");
        break;
      }
    }
    return snapshot;
  }, Symbol.asyncIterator)]() {
    const pushQueue = [];
    const readQueue = [];
    let done = false;
    this.on("event", (event) => {
      const reader = readQueue.shift();
      if (reader) {
        reader.resolve(event);
      } else {
        pushQueue.push(event);
      }
    });
    this.on("end", () => {
      done = true;
      for (const reader of readQueue) {
        reader.resolve(void 0);
      }
      readQueue.length = 0;
    });
    this.on("abort", (err) => {
      done = true;
      for (const reader of readQueue) {
        reader.reject(err);
      }
      readQueue.length = 0;
    });
    this.on("error", (err) => {
      done = true;
      for (const reader of readQueue) {
        reader.reject(err);
      }
      readQueue.length = 0;
    });
    return {
      next: async () => {
        if (!pushQueue.length) {
          if (done) {
            return { value: void 0, done: true };
          }
          return new Promise((resolve, reject) => readQueue.push({ resolve, reject })).then((event2) => event2 ? { value: event2, done: false } : { value: void 0, done: true });
        }
        const event = pushQueue.shift();
        return { value: event, done: false };
      },
      return: async () => {
        this.abort();
        return { value: void 0, done: true };
      }
    };
  }
  /**
   * @returns a promise that resolves with the final Response, or rejects
   * if an error occurred or the stream ended prematurely without producing a REsponse.
   */
  async finalResponse() {
    await this.done();
    const response = __classPrivateFieldGet(this, _ResponseStream_finalResponse, "f");
    if (!response)
      throw new OpenAIError("stream ended without producing a ChatCompletion");
    return response;
  }
};
function finalizeResponse(snapshot, params) {
  return maybeParseResponse(snapshot, params);
}

// node_modules/openai/resources/responses/input-items.mjs
var InputItems = class extends APIResource {
  /**
   * Returns a list of input items for a given response.
   *
   * @example
   * ```ts
   * // Automatically fetches more pages as needed.
   * for await (const responseItem of client.responses.inputItems.list(
   *   'response_id',
   * )) {
   *   // ...
   * }
   * ```
   */
  list(responseID, query = {}, options) {
    return this._client.getAPIList(path`/responses/${responseID}/input_items`, CursorPage, { query, ...options });
  }
};

// node_modules/openai/resources/responses/input-tokens.mjs
var InputTokens = class extends APIResource {
  /**
   * Returns input token counts of the request.
   *
   * Returns an object with `object` set to `response.input_tokens` and an
   * `input_tokens` count.
   *
   * @example
   * ```ts
   * const response = await client.responses.inputTokens.count();
   * ```
   */
  count(body = {}, options) {
    return this._client.post("/responses/input_tokens", { body, ...options });
  }
};

// node_modules/openai/resources/responses/responses.mjs
var Responses = class extends APIResource {
  constructor() {
    super(...arguments);
    this.inputItems = new InputItems(this._client);
    this.inputTokens = new InputTokens(this._client);
  }
  create(body, options) {
    return this._client.post("/responses", { body, ...options, stream: body.stream ?? false })._thenUnwrap((rsp) => {
      if ("object" in rsp && rsp.object === "response") {
        addOutputText(rsp);
      }
      return rsp;
    });
  }
  retrieve(responseID, query = {}, options) {
    return this._client.get(path`/responses/${responseID}`, {
      query,
      ...options,
      stream: query?.stream ?? false
    })._thenUnwrap((rsp) => {
      if ("object" in rsp && rsp.object === "response") {
        addOutputText(rsp);
      }
      return rsp;
    });
  }
  /**
   * Deletes a model response with the given ID.
   *
   * @example
   * ```ts
   * await client.responses.delete(
   *   'resp_677efb5139a88190b512bc3fef8e535d',
   * );
   * ```
   */
  delete(responseID, options) {
    return this._client.delete(path`/responses/${responseID}`, {
      ...options,
      headers: buildHeaders([{ Accept: "*/*" }, options?.headers])
    });
  }
  parse(body, options) {
    return this._client.responses.create(body, options)._thenUnwrap((response) => parseResponse(response, body));
  }
  /**
   * Creates a model response stream
   */
  stream(body, options) {
    return ResponseStream.createResponse(this._client, body, options);
  }
  /**
   * Cancels a model response with the given ID. Only responses created with the
   * `background` parameter set to `true` can be cancelled.
   * [Learn more](https://platform.openai.com/docs/guides/background).
   *
   * @example
   * ```ts
   * const response = await client.responses.cancel(
   *   'resp_677efb5139a88190b512bc3fef8e535d',
   * );
   * ```
   */
  cancel(responseID, options) {
    return this._client.post(path`/responses/${responseID}/cancel`, options);
  }
  /**
   * Compact a conversation. Returns a compacted response object.
   *
   * Learn when and how to compact long-running conversations in the
   * [conversation state guide](https://platform.openai.com/docs/guides/conversation-state#managing-the-context-window).
   * For ZDR-compatible compaction details, see
   * [Compaction (advanced)](https://platform.openai.com/docs/guides/conversation-state#compaction-advanced).
   *
   * @example
   * ```ts
   * const compactedResponse = await client.responses.compact({
   *   model: 'gpt-5.4',
   * });
   * ```
   */
  compact(body, options) {
    return this._client.post("/responses/compact", { body, ...options });
  }
};
Responses.InputItems = InputItems;
Responses.InputTokens = InputTokens;

// node_modules/openai/resources/skills/content.mjs
var Content2 = class extends APIResource {
  /**
   * Download a skill zip bundle by its ID.
   */
  retrieve(skillID, options) {
    return this._client.get(path`/skills/${skillID}/content`, {
      ...options,
      headers: buildHeaders([{ Accept: "application/binary" }, options?.headers]),
      __binaryResponse: true
    });
  }
};

// node_modules/openai/resources/skills/versions/content.mjs
var Content3 = class extends APIResource {
  /**
   * Download a skill version zip bundle.
   */
  retrieve(version, params, options) {
    const { skill_id } = params;
    return this._client.get(path`/skills/${skill_id}/versions/${version}/content`, {
      ...options,
      headers: buildHeaders([{ Accept: "application/binary" }, options?.headers]),
      __binaryResponse: true
    });
  }
};

// node_modules/openai/resources/skills/versions/versions.mjs
var Versions = class extends APIResource {
  constructor() {
    super(...arguments);
    this.content = new Content3(this._client);
  }
  /**
   * Create a new immutable skill version.
   */
  create(skillID, body = {}, options) {
    return this._client.post(path`/skills/${skillID}/versions`, maybeMultipartFormRequestOptions({ body, ...options }, this._client));
  }
  /**
   * Get a specific skill version.
   */
  retrieve(version, params, options) {
    const { skill_id } = params;
    return this._client.get(path`/skills/${skill_id}/versions/${version}`, options);
  }
  /**
   * List skill versions for a skill.
   */
  list(skillID, query = {}, options) {
    return this._client.getAPIList(path`/skills/${skillID}/versions`, CursorPage, {
      query,
      ...options
    });
  }
  /**
   * Delete a skill version.
   */
  delete(version, params, options) {
    const { skill_id } = params;
    return this._client.delete(path`/skills/${skill_id}/versions/${version}`, options);
  }
};
Versions.Content = Content3;

// node_modules/openai/resources/skills/skills.mjs
var Skills = class extends APIResource {
  constructor() {
    super(...arguments);
    this.content = new Content2(this._client);
    this.versions = new Versions(this._client);
  }
  /**
   * Create a new skill.
   */
  create(body = {}, options) {
    return this._client.post("/skills", maybeMultipartFormRequestOptions({ body, ...options }, this._client));
  }
  /**
   * Get a skill by its ID.
   */
  retrieve(skillID, options) {
    return this._client.get(path`/skills/${skillID}`, options);
  }
  /**
   * Update the default version pointer for a skill.
   */
  update(skillID, body, options) {
    return this._client.post(path`/skills/${skillID}`, { body, ...options });
  }
  /**
   * List all skills for the current project.
   */
  list(query = {}, options) {
    return this._client.getAPIList("/skills", CursorPage, { query, ...options });
  }
  /**
   * Delete a skill by its ID.
   */
  delete(skillID, options) {
    return this._client.delete(path`/skills/${skillID}`, options);
  }
};
Skills.Content = Content2;
Skills.Versions = Versions;

// node_modules/openai/resources/uploads/parts.mjs
var Parts = class extends APIResource {
  /**
   * Adds a
   * [Part](https://platform.openai.com/docs/api-reference/uploads/part-object) to an
   * [Upload](https://platform.openai.com/docs/api-reference/uploads/object) object.
   * A Part represents a chunk of bytes from the file you are trying to upload.
   *
   * Each Part can be at most 64 MB, and you can add Parts until you hit the Upload
   * maximum of 8 GB.
   *
   * It is possible to add multiple Parts in parallel. You can decide the intended
   * order of the Parts when you
   * [complete the Upload](https://platform.openai.com/docs/api-reference/uploads/complete).
   */
  create(uploadID, body, options) {
    return this._client.post(path`/uploads/${uploadID}/parts`, multipartFormRequestOptions({ body, ...options }, this._client));
  }
};

// node_modules/openai/resources/uploads/uploads.mjs
var Uploads = class extends APIResource {
  constructor() {
    super(...arguments);
    this.parts = new Parts(this._client);
  }
  /**
   * Creates an intermediate
   * [Upload](https://platform.openai.com/docs/api-reference/uploads/object) object
   * that you can add
   * [Parts](https://platform.openai.com/docs/api-reference/uploads/part-object) to.
   * Currently, an Upload can accept at most 8 GB in total and expires after an hour
   * after you create it.
   *
   * Once you complete the Upload, we will create a
   * [File](https://platform.openai.com/docs/api-reference/files/object) object that
   * contains all the parts you uploaded. This File is usable in the rest of our
   * platform as a regular File object.
   *
   * For certain `purpose` values, the correct `mime_type` must be specified. Please
   * refer to documentation for the
   * [supported MIME types for your use case](https://platform.openai.com/docs/assistants/tools/file-search#supported-files).
   *
   * For guidance on the proper filename extensions for each purpose, please follow
   * the documentation on
   * [creating a File](https://platform.openai.com/docs/api-reference/files/create).
   *
   * Returns the Upload object with status `pending`.
   */
  create(body, options) {
    return this._client.post("/uploads", { body, ...options });
  }
  /**
   * Cancels the Upload. No Parts may be added after an Upload is cancelled.
   *
   * Returns the Upload object with status `cancelled`.
   */
  cancel(uploadID, options) {
    return this._client.post(path`/uploads/${uploadID}/cancel`, options);
  }
  /**
   * Completes the
   * [Upload](https://platform.openai.com/docs/api-reference/uploads/object).
   *
   * Within the returned Upload object, there is a nested
   * [File](https://platform.openai.com/docs/api-reference/files/object) object that
   * is ready to use in the rest of the platform.
   *
   * You can specify the order of the Parts by passing in an ordered list of the Part
   * IDs.
   *
   * The number of bytes uploaded upon completion must match the number of bytes
   * initially specified when creating the Upload object. No Parts may be added after
   * an Upload is completed. Returns the Upload object with status `completed`,
   * including an additional `file` property containing the created usable File
   * object.
   */
  complete(uploadID, body, options) {
    return this._client.post(path`/uploads/${uploadID}/complete`, { body, ...options });
  }
};
Uploads.Parts = Parts;

// node_modules/openai/lib/Util.mjs
var allSettledWithThrow = async (promises) => {
  const results = await Promise.allSettled(promises);
  const rejected = results.filter((result) => result.status === "rejected");
  if (rejected.length) {
    for (const result of rejected) {
      console.error(result.reason);
    }
    throw new Error(`${rejected.length} promise(s) failed - see the above errors`);
  }
  const values = [];
  for (const result of results) {
    if (result.status === "fulfilled") {
      values.push(result.value);
    }
  }
  return values;
};

// node_modules/openai/resources/vector-stores/file-batches.mjs
var FileBatches = class extends APIResource {
  /**
   * Create a vector store file batch.
   */
  create(vectorStoreID, body, options) {
    return this._client.post(path`/vector_stores/${vectorStoreID}/file_batches`, {
      body,
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers])
    });
  }
  /**
   * Retrieves a vector store file batch.
   */
  retrieve(batchID, params, options) {
    const { vector_store_id } = params;
    return this._client.get(path`/vector_stores/${vector_store_id}/file_batches/${batchID}`, {
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers])
    });
  }
  /**
   * Cancel a vector store file batch. This attempts to cancel the processing of
   * files in this batch as soon as possible.
   */
  cancel(batchID, params, options) {
    const { vector_store_id } = params;
    return this._client.post(path`/vector_stores/${vector_store_id}/file_batches/${batchID}/cancel`, {
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers])
    });
  }
  /**
   * Create a vector store batch and poll until all files have been processed.
   */
  async createAndPoll(vectorStoreId, body, options) {
    const batch = await this.create(vectorStoreId, body);
    return await this.poll(vectorStoreId, batch.id, options);
  }
  /**
   * Returns a list of vector store files in a batch.
   */
  listFiles(batchID, params, options) {
    const { vector_store_id, ...query } = params;
    return this._client.getAPIList(path`/vector_stores/${vector_store_id}/file_batches/${batchID}/files`, CursorPage, { query, ...options, headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers]) });
  }
  /**
   * Wait for the given file batch to be processed.
   *
   * Note: this will return even if one of the files failed to process, you need to
   * check batch.file_counts.failed_count to handle this case.
   */
  async poll(vectorStoreID, batchID, options) {
    const headers = buildHeaders([
      options?.headers,
      {
        "X-Stainless-Poll-Helper": "true",
        "X-Stainless-Custom-Poll-Interval": options?.pollIntervalMs?.toString() ?? void 0
      }
    ]);
    while (true) {
      const { data: batch, response } = await this.retrieve(batchID, { vector_store_id: vectorStoreID }, {
        ...options,
        headers
      }).withResponse();
      switch (batch.status) {
        case "in_progress":
          let sleepInterval = 5e3;
          if (options?.pollIntervalMs) {
            sleepInterval = options.pollIntervalMs;
          } else {
            const headerInterval = response.headers.get("openai-poll-after-ms");
            if (headerInterval) {
              const headerIntervalMs = parseInt(headerInterval);
              if (!isNaN(headerIntervalMs)) {
                sleepInterval = headerIntervalMs;
              }
            }
          }
          await sleep(sleepInterval);
          break;
        case "failed":
        case "cancelled":
        case "completed":
          return batch;
      }
    }
  }
  /**
   * Uploads the given files concurrently and then creates a vector store file batch.
   *
   * The concurrency limit is configurable using the `maxConcurrency` parameter.
   */
  async uploadAndPoll(vectorStoreId, { files, fileIds = [] }, options) {
    if (files == null || files.length == 0) {
      throw new Error(`No \`files\` provided to process. If you've already uploaded files you should use \`.createAndPoll()\` instead`);
    }
    const configuredConcurrency = options?.maxConcurrency ?? 5;
    const concurrencyLimit = Math.min(configuredConcurrency, files.length);
    const client = this._client;
    const fileIterator = files.values();
    const allFileIds = [...fileIds];
    async function processFiles(iterator) {
      for (let item of iterator) {
        const fileObj = await client.files.create({ file: item, purpose: "assistants" }, options);
        allFileIds.push(fileObj.id);
      }
    }
    const workers = Array(concurrencyLimit).fill(fileIterator).map(processFiles);
    await allSettledWithThrow(workers);
    return await this.createAndPoll(vectorStoreId, {
      file_ids: allFileIds
    });
  }
};

// node_modules/openai/resources/vector-stores/files.mjs
var Files3 = class extends APIResource {
  /**
   * Create a vector store file by attaching a
   * [File](https://platform.openai.com/docs/api-reference/files) to a
   * [vector store](https://platform.openai.com/docs/api-reference/vector-stores/object).
   */
  create(vectorStoreID, body, options) {
    return this._client.post(path`/vector_stores/${vectorStoreID}/files`, {
      body,
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers])
    });
  }
  /**
   * Retrieves a vector store file.
   */
  retrieve(fileID, params, options) {
    const { vector_store_id } = params;
    return this._client.get(path`/vector_stores/${vector_store_id}/files/${fileID}`, {
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers])
    });
  }
  /**
   * Update attributes on a vector store file.
   */
  update(fileID, params, options) {
    const { vector_store_id, ...body } = params;
    return this._client.post(path`/vector_stores/${vector_store_id}/files/${fileID}`, {
      body,
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers])
    });
  }
  /**
   * Returns a list of vector store files.
   */
  list(vectorStoreID, query = {}, options) {
    return this._client.getAPIList(path`/vector_stores/${vectorStoreID}/files`, CursorPage, {
      query,
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers])
    });
  }
  /**
   * Delete a vector store file. This will remove the file from the vector store but
   * the file itself will not be deleted. To delete the file, use the
   * [delete file](https://platform.openai.com/docs/api-reference/files/delete)
   * endpoint.
   */
  delete(fileID, params, options) {
    const { vector_store_id } = params;
    return this._client.delete(path`/vector_stores/${vector_store_id}/files/${fileID}`, {
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers])
    });
  }
  /**
   * Attach a file to the given vector store and wait for it to be processed.
   */
  async createAndPoll(vectorStoreId, body, options) {
    const file = await this.create(vectorStoreId, body, options);
    return await this.poll(vectorStoreId, file.id, options);
  }
  /**
   * Wait for the vector store file to finish processing.
   *
   * Note: this will return even if the file failed to process, you need to check
   * file.last_error and file.status to handle these cases
   */
  async poll(vectorStoreID, fileID, options) {
    const headers = buildHeaders([
      options?.headers,
      {
        "X-Stainless-Poll-Helper": "true",
        "X-Stainless-Custom-Poll-Interval": options?.pollIntervalMs?.toString() ?? void 0
      }
    ]);
    while (true) {
      const fileResponse = await this.retrieve(fileID, {
        vector_store_id: vectorStoreID
      }, { ...options, headers }).withResponse();
      const file = fileResponse.data;
      switch (file.status) {
        case "in_progress":
          let sleepInterval = 5e3;
          if (options?.pollIntervalMs) {
            sleepInterval = options.pollIntervalMs;
          } else {
            const headerInterval = fileResponse.response.headers.get("openai-poll-after-ms");
            if (headerInterval) {
              const headerIntervalMs = parseInt(headerInterval);
              if (!isNaN(headerIntervalMs)) {
                sleepInterval = headerIntervalMs;
              }
            }
          }
          await sleep(sleepInterval);
          break;
        case "failed":
        case "completed":
          return file;
      }
    }
  }
  /**
   * Upload a file to the `files` API and then attach it to the given vector store.
   *
   * Note the file will be asynchronously processed (you can use the alternative
   * polling helper method to wait for processing to complete).
   */
  async upload(vectorStoreId, file, options) {
    const fileInfo = await this._client.files.create({ file, purpose: "assistants" }, options);
    return this.create(vectorStoreId, { file_id: fileInfo.id }, options);
  }
  /**
   * Add a file to a vector store and poll until processing is complete.
   */
  async uploadAndPoll(vectorStoreId, file, options) {
    const fileInfo = await this.upload(vectorStoreId, file, options);
    return await this.poll(vectorStoreId, fileInfo.id, options);
  }
  /**
   * Retrieve the parsed contents of a vector store file.
   */
  content(fileID, params, options) {
    const { vector_store_id } = params;
    return this._client.getAPIList(path`/vector_stores/${vector_store_id}/files/${fileID}/content`, Page, { ...options, headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers]) });
  }
};

// node_modules/openai/resources/vector-stores/vector-stores.mjs
var VectorStores = class extends APIResource {
  constructor() {
    super(...arguments);
    this.files = new Files3(this._client);
    this.fileBatches = new FileBatches(this._client);
  }
  /**
   * Create a vector store.
   */
  create(body, options) {
    return this._client.post("/vector_stores", {
      body,
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers])
    });
  }
  /**
   * Retrieves a vector store.
   */
  retrieve(vectorStoreID, options) {
    return this._client.get(path`/vector_stores/${vectorStoreID}`, {
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers])
    });
  }
  /**
   * Modifies a vector store.
   */
  update(vectorStoreID, body, options) {
    return this._client.post(path`/vector_stores/${vectorStoreID}`, {
      body,
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers])
    });
  }
  /**
   * Returns a list of vector stores.
   */
  list(query = {}, options) {
    return this._client.getAPIList("/vector_stores", CursorPage, {
      query,
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers])
    });
  }
  /**
   * Delete a vector store.
   */
  delete(vectorStoreID, options) {
    return this._client.delete(path`/vector_stores/${vectorStoreID}`, {
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers])
    });
  }
  /**
   * Search a vector store for relevant chunks based on a query and file attributes
   * filter.
   */
  search(vectorStoreID, body, options) {
    return this._client.getAPIList(path`/vector_stores/${vectorStoreID}/search`, Page, {
      body,
      method: "post",
      ...options,
      headers: buildHeaders([{ "OpenAI-Beta": "assistants=v2" }, options?.headers])
    });
  }
};
VectorStores.Files = Files3;
VectorStores.FileBatches = FileBatches;

// node_modules/openai/resources/videos.mjs
var Videos = class extends APIResource {
  /**
   * Create a new video generation job from a prompt and optional reference assets.
   */
  create(body, options) {
    return this._client.post("/videos", multipartFormRequestOptions({ body, ...options }, this._client));
  }
  /**
   * Fetch the latest metadata for a generated video.
   */
  retrieve(videoID, options) {
    return this._client.get(path`/videos/${videoID}`, options);
  }
  /**
   * List recently generated videos for the current project.
   */
  list(query = {}, options) {
    return this._client.getAPIList("/videos", ConversationCursorPage, { query, ...options });
  }
  /**
   * Permanently delete a completed or failed video and its stored assets.
   */
  delete(videoID, options) {
    return this._client.delete(path`/videos/${videoID}`, options);
  }
  /**
   * Create a character from an uploaded video.
   */
  createCharacter(body, options) {
    return this._client.post("/videos/characters", multipartFormRequestOptions({ body, ...options }, this._client));
  }
  /**
   * Download the generated video bytes or a derived preview asset.
   *
   * Streams the rendered video content for the specified video job.
   */
  downloadContent(videoID, query = {}, options) {
    return this._client.get(path`/videos/${videoID}/content`, {
      query,
      ...options,
      headers: buildHeaders([{ Accept: "application/binary" }, options?.headers]),
      __binaryResponse: true
    });
  }
  /**
   * Create a new video generation job by editing a source video or existing
   * generated video.
   */
  edit(body, options) {
    return this._client.post("/videos/edits", multipartFormRequestOptions({ body, ...options }, this._client));
  }
  /**
   * Create an extension of a completed video.
   */
  extend(body, options) {
    return this._client.post("/videos/extensions", multipartFormRequestOptions({ body, ...options }, this._client));
  }
  /**
   * Fetch a character.
   */
  getCharacter(characterID, options) {
    return this._client.get(path`/videos/characters/${characterID}`, options);
  }
  /**
   * Create a remix of a completed video using a refreshed prompt.
   */
  remix(videoID, body, options) {
    return this._client.post(path`/videos/${videoID}/remix`, maybeMultipartFormRequestOptions({ body, ...options }, this._client));
  }
};

// node_modules/openai/resources/webhooks/webhooks.mjs
var _Webhooks_instances;
var _Webhooks_validateSecret;
var _Webhooks_getRequiredHeader;
var Webhooks = class extends APIResource {
  constructor() {
    super(...arguments);
    _Webhooks_instances.add(this);
  }
  /**
   * Validates that the given payload was sent by OpenAI and parses the payload.
   */
  async unwrap(payload, headers, secret = this._client.webhookSecret, tolerance = 300) {
    await this.verifySignature(payload, headers, secret, tolerance);
    return JSON.parse(payload);
  }
  /**
   * Validates whether or not the webhook payload was sent by OpenAI.
   *
   * An error will be raised if the webhook payload was not sent by OpenAI.
   *
   * @param payload - The webhook payload
   * @param headers - The webhook headers
   * @param secret - The webhook secret (optional, will use client secret if not provided)
   * @param tolerance - Maximum age of the webhook in seconds (default: 300 = 5 minutes)
   */
  async verifySignature(payload, headers, secret = this._client.webhookSecret, tolerance = 300) {
    if (typeof crypto === "undefined" || typeof crypto.subtle.importKey !== "function" || typeof crypto.subtle.verify !== "function") {
      throw new Error("Webhook signature verification is only supported when the `crypto` global is defined");
    }
    __classPrivateFieldGet(this, _Webhooks_instances, "m", _Webhooks_validateSecret).call(this, secret);
    const headersObj = buildHeaders([headers]).values;
    const signatureHeader = __classPrivateFieldGet(this, _Webhooks_instances, "m", _Webhooks_getRequiredHeader).call(this, headersObj, "webhook-signature");
    const timestamp = __classPrivateFieldGet(this, _Webhooks_instances, "m", _Webhooks_getRequiredHeader).call(this, headersObj, "webhook-timestamp");
    const webhookId = __classPrivateFieldGet(this, _Webhooks_instances, "m", _Webhooks_getRequiredHeader).call(this, headersObj, "webhook-id");
    const timestampSeconds = parseInt(timestamp, 10);
    if (isNaN(timestampSeconds)) {
      throw new InvalidWebhookSignatureError("Invalid webhook timestamp format");
    }
    const nowSeconds = Math.floor(Date.now() / 1e3);
    if (nowSeconds - timestampSeconds > tolerance) {
      throw new InvalidWebhookSignatureError("Webhook timestamp is too old");
    }
    if (timestampSeconds > nowSeconds + tolerance) {
      throw new InvalidWebhookSignatureError("Webhook timestamp is too new");
    }
    const signatures = signatureHeader.split(" ").map((part) => part.startsWith("v1,") ? part.substring(3) : part);
    const decodedSecret = secret.startsWith("whsec_") ? Buffer.from(secret.replace("whsec_", ""), "base64") : Buffer.from(secret, "utf-8");
    const signedPayload = webhookId ? `${webhookId}.${timestamp}.${payload}` : `${timestamp}.${payload}`;
    const key = await crypto.subtle.importKey("raw", decodedSecret, { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    for (const signature of signatures) {
      try {
        const signatureBytes = Buffer.from(signature, "base64");
        const isValid = await crypto.subtle.verify("HMAC", key, signatureBytes, new TextEncoder().encode(signedPayload));
        if (isValid) {
          return;
        }
      } catch {
        continue;
      }
    }
    throw new InvalidWebhookSignatureError("The given webhook signature does not match the expected signature");
  }
};
_Webhooks_instances = /* @__PURE__ */ new WeakSet(), _Webhooks_validateSecret = function _Webhooks_validateSecret2(secret) {
  if (typeof secret !== "string" || secret.length === 0) {
    throw new Error(`The webhook secret must either be set using the env var, OPENAI_WEBHOOK_SECRET, on the client class, OpenAI({ webhookSecret: '123' }), or passed to this function`);
  }
}, _Webhooks_getRequiredHeader = function _Webhooks_getRequiredHeader2(headers, name) {
  if (!headers) {
    throw new Error(`Headers are required`);
  }
  const value = headers.get(name);
  if (value === null || value === void 0) {
    throw new Error(`Missing required header: ${name}`);
  }
  return value;
};

// node_modules/openai/client.mjs
var _OpenAI_instances;
var _a2;
var _OpenAI_encoder;
var _OpenAI_baseURLOverridden;
var WORKLOAD_IDENTITY_API_KEY_PLACEHOLDER = "workload-identity-auth";
var OpenAI = class {
  /**
   * API Client for interfacing with the OpenAI API.
   *
   * @param {string | undefined} [opts.apiKey=process.env['OPENAI_API_KEY'] ?? undefined]
   * @param {string | null | undefined} [opts.organization=process.env['OPENAI_ORG_ID'] ?? null]
   * @param {string | null | undefined} [opts.project=process.env['OPENAI_PROJECT_ID'] ?? null]
   * @param {string | null | undefined} [opts.webhookSecret=process.env['OPENAI_WEBHOOK_SECRET'] ?? null]
   * @param {string} [opts.baseURL=process.env['OPENAI_BASE_URL'] ?? https://api.openai.com/v1] - Override the default base URL for the API.
   * @param {number} [opts.timeout=10 minutes] - The maximum amount of time (in milliseconds) the client will wait for a response before timing out.
   * @param {MergedRequestInit} [opts.fetchOptions] - Additional `RequestInit` options to be passed to `fetch` calls.
   * @param {Fetch} [opts.fetch] - Specify a custom `fetch` function implementation.
   * @param {number} [opts.maxRetries=2] - The maximum number of times the client will retry a request.
   * @param {HeadersLike} opts.defaultHeaders - Default headers to include with every request to the API.
   * @param {Record<string, string | undefined>} opts.defaultQuery - Default query parameters to include with every request to the API.
   * @param {boolean} [opts.dangerouslyAllowBrowser=false] - By default, client-side use of this library is not allowed, as it risks exposing your secret API credentials to attackers.
   */
  constructor({ baseURL = readEnv("OPENAI_BASE_URL"), apiKey = readEnv("OPENAI_API_KEY"), organization = readEnv("OPENAI_ORG_ID") ?? null, project = readEnv("OPENAI_PROJECT_ID") ?? null, webhookSecret = readEnv("OPENAI_WEBHOOK_SECRET") ?? null, workloadIdentity, ...opts } = {}) {
    _OpenAI_instances.add(this);
    _OpenAI_encoder.set(this, void 0);
    this.completions = new Completions2(this);
    this.chat = new Chat(this);
    this.embeddings = new Embeddings(this);
    this.files = new Files2(this);
    this.images = new Images(this);
    this.audio = new Audio(this);
    this.moderations = new Moderations(this);
    this.models = new Models(this);
    this.fineTuning = new FineTuning(this);
    this.graders = new Graders2(this);
    this.vectorStores = new VectorStores(this);
    this.webhooks = new Webhooks(this);
    this.beta = new Beta(this);
    this.batches = new Batches(this);
    this.uploads = new Uploads(this);
    this.responses = new Responses(this);
    this.realtime = new Realtime2(this);
    this.conversations = new Conversations(this);
    this.evals = new Evals(this);
    this.containers = new Containers(this);
    this.skills = new Skills(this);
    this.videos = new Videos(this);
    if (workloadIdentity) {
      if (apiKey && apiKey !== WORKLOAD_IDENTITY_API_KEY_PLACEHOLDER) {
        throw new OpenAIError("The `apiKey` and `workloadIdentity` arguments are mutually exclusive; only one can be passed at a time.");
      }
      apiKey = WORKLOAD_IDENTITY_API_KEY_PLACEHOLDER;
    } else if (apiKey === void 0) {
      throw new OpenAIError("Missing credentials. Please pass an `apiKey`, `workloadIdentity`, or set the `OPENAI_API_KEY` environment variable.");
    }
    const options = {
      apiKey,
      organization,
      project,
      webhookSecret,
      workloadIdentity,
      ...opts,
      baseURL: baseURL || `https://api.openai.com/v1`
    };
    if (!options.dangerouslyAllowBrowser && isRunningInBrowser()) {
      throw new OpenAIError("It looks like you're running in a browser-like environment.\n\nThis is disabled by default, as it risks exposing your secret API credentials to attackers.\nIf you understand the risks and have appropriate mitigations in place,\nyou can set the `dangerouslyAllowBrowser` option to `true`, e.g.,\n\nnew OpenAI({ apiKey, dangerouslyAllowBrowser: true });\n\nhttps://help.openai.com/en/articles/5112595-best-practices-for-api-key-safety\n");
    }
    this.baseURL = options.baseURL;
    this.timeout = options.timeout ?? _a2.DEFAULT_TIMEOUT;
    this.logger = options.logger ?? console;
    const defaultLogLevel = "warn";
    this.logLevel = defaultLogLevel;
    this.logLevel = parseLogLevel(options.logLevel, "ClientOptions.logLevel", this) ?? parseLogLevel(readEnv("OPENAI_LOG"), "process.env['OPENAI_LOG']", this) ?? defaultLogLevel;
    this.fetchOptions = options.fetchOptions;
    this.maxRetries = options.maxRetries ?? 2;
    this.fetch = options.fetch ?? getDefaultFetch();
    __classPrivateFieldSet(this, _OpenAI_encoder, FallbackEncoder, "f");
    this._options = options;
    if (workloadIdentity) {
      this._workloadIdentityAuth = new WorkloadIdentityAuth(workloadIdentity, this.fetch);
    }
    this.apiKey = typeof apiKey === "string" ? apiKey : "Missing Key";
    this.organization = organization;
    this.project = project;
    this.webhookSecret = webhookSecret;
  }
  /**
   * Create a new client instance re-using the same options given to the current client with optional overriding.
   */
  withOptions(options) {
    const client = new this.constructor({
      ...this._options,
      baseURL: this.baseURL,
      maxRetries: this.maxRetries,
      timeout: this.timeout,
      logger: this.logger,
      logLevel: this.logLevel,
      fetch: this.fetch,
      fetchOptions: this.fetchOptions,
      apiKey: this.apiKey,
      workloadIdentity: this._options.workloadIdentity,
      organization: this.organization,
      project: this.project,
      webhookSecret: this.webhookSecret,
      ...options
    });
    return client;
  }
  defaultQuery() {
    return this._options.defaultQuery;
  }
  validateHeaders({ values, nulls }) {
    return;
  }
  async authHeaders(opts) {
    return buildHeaders([{ Authorization: `Bearer ${this.apiKey}` }]);
  }
  stringifyQuery(query) {
    return stringifyQuery(query);
  }
  getUserAgent() {
    return `${this.constructor.name}/JS ${VERSION}`;
  }
  defaultIdempotencyKey() {
    return `stainless-node-retry-${uuid4()}`;
  }
  makeStatusError(status, error, message, headers) {
    return APIError.generate(status, error, message, headers);
  }
  async _callApiKey() {
    const apiKey = this._options.apiKey;
    if (typeof apiKey !== "function")
      return false;
    let token;
    try {
      token = await apiKey();
    } catch (err) {
      if (err instanceof OpenAIError)
        throw err;
      throw new OpenAIError(
        `Failed to get token from 'apiKey' function: ${err.message}`,
        // @ts-ignore
        { cause: err }
      );
    }
    if (typeof token !== "string" || !token) {
      throw new OpenAIError(`Expected 'apiKey' function argument to return a string but it returned ${token}`);
    }
    this.apiKey = token;
    return true;
  }
  buildURL(path2, query, defaultBaseURL) {
    const baseURL = !__classPrivateFieldGet(this, _OpenAI_instances, "m", _OpenAI_baseURLOverridden).call(this) && defaultBaseURL || this.baseURL;
    const url = isAbsoluteURL(path2) ? new URL(path2) : new URL(baseURL + (baseURL.endsWith("/") && path2.startsWith("/") ? path2.slice(1) : path2));
    const defaultQuery = this.defaultQuery();
    const pathQuery = Object.fromEntries(url.searchParams);
    if (!isEmptyObj(defaultQuery) || !isEmptyObj(pathQuery)) {
      query = { ...pathQuery, ...defaultQuery, ...query };
    }
    if (typeof query === "object" && query && !Array.isArray(query)) {
      url.search = this.stringifyQuery(query);
    }
    return url.toString();
  }
  /**
   * Used as a callback for mutating the given `FinalRequestOptions` object.
   */
  async prepareOptions(options) {
    await this._callApiKey();
  }
  /**
   * Used as a callback for mutating the given `RequestInit` object.
   *
   * This is useful for cases where you want to add certain headers based off of
   * the request properties, e.g. `method` or `url`.
   */
  async prepareRequest(request, { url, options }) {
  }
  get(path2, opts) {
    return this.methodRequest("get", path2, opts);
  }
  post(path2, opts) {
    return this.methodRequest("post", path2, opts);
  }
  patch(path2, opts) {
    return this.methodRequest("patch", path2, opts);
  }
  put(path2, opts) {
    return this.methodRequest("put", path2, opts);
  }
  delete(path2, opts) {
    return this.methodRequest("delete", path2, opts);
  }
  methodRequest(method, path2, opts) {
    return this.request(Promise.resolve(opts).then((opts2) => {
      return { method, path: path2, ...opts2 };
    }));
  }
  request(options, remainingRetries = null) {
    return new APIPromise(this, this.makeRequest(options, remainingRetries, void 0));
  }
  async makeRequest(optionsInput, retriesRemaining, retryOfRequestLogID) {
    const options = await optionsInput;
    const maxRetries = options.maxRetries ?? this.maxRetries;
    if (retriesRemaining == null) {
      retriesRemaining = maxRetries;
    }
    await this.prepareOptions(options);
    const { req, url, timeout } = await this.buildRequest(options, {
      retryCount: maxRetries - retriesRemaining
    });
    await this.prepareRequest(req, { url, options });
    const requestLogID = "log_" + (Math.random() * (1 << 24) | 0).toString(16).padStart(6, "0");
    const retryLogStr = retryOfRequestLogID === void 0 ? "" : `, retryOf: ${retryOfRequestLogID}`;
    const startTime = Date.now();
    loggerFor(this).debug(`[${requestLogID}] sending request`, formatRequestDetails({
      retryOfRequestLogID,
      method: options.method,
      url,
      options,
      headers: req.headers
    }));
    if (options.signal?.aborted) {
      throw new APIUserAbortError();
    }
    const controller = new AbortController();
    const response = await this.fetchWithAuth(url, req, timeout, controller).catch(castToError);
    const headersTime = Date.now();
    if (response instanceof globalThis.Error) {
      const retryMessage = `retrying, ${retriesRemaining} attempts remaining`;
      if (options.signal?.aborted) {
        throw new APIUserAbortError();
      }
      const isTimeout = isAbortError(response) || /timed? ?out/i.test(String(response) + ("cause" in response ? String(response.cause) : ""));
      if (retriesRemaining) {
        loggerFor(this).info(`[${requestLogID}] connection ${isTimeout ? "timed out" : "failed"} - ${retryMessage}`);
        loggerFor(this).debug(`[${requestLogID}] connection ${isTimeout ? "timed out" : "failed"} (${retryMessage})`, formatRequestDetails({
          retryOfRequestLogID,
          url,
          durationMs: headersTime - startTime,
          message: response.message
        }));
        return this.retryRequest(options, retriesRemaining, retryOfRequestLogID ?? requestLogID);
      }
      loggerFor(this).info(`[${requestLogID}] connection ${isTimeout ? "timed out" : "failed"} - error; no more retries left`);
      loggerFor(this).debug(`[${requestLogID}] connection ${isTimeout ? "timed out" : "failed"} (error; no more retries left)`, formatRequestDetails({
        retryOfRequestLogID,
        url,
        durationMs: headersTime - startTime,
        message: response.message
      }));
      if (response instanceof OAuthError || response instanceof SubjectTokenProviderError) {
        throw response;
      }
      if (isTimeout) {
        throw new APIConnectionTimeoutError();
      }
      throw new APIConnectionError({ cause: response });
    }
    const specialHeaders = [...response.headers.entries()].filter(([name]) => name === "x-request-id").map(([name, value]) => ", " + name + ": " + JSON.stringify(value)).join("");
    const responseInfo = `[${requestLogID}${retryLogStr}${specialHeaders}] ${req.method} ${url} ${response.ok ? "succeeded" : "failed"} with status ${response.status} in ${headersTime - startTime}ms`;
    if (!response.ok) {
      if (response.status === 401 && this._workloadIdentityAuth && !options.__metadata?.["hasStreamingBody"] && !options.__metadata?.["workloadIdentityTokenRefreshed"]) {
        await CancelReadableStream(response.body);
        this._workloadIdentityAuth.invalidateToken();
        return this.makeRequest({
          ...options,
          __metadata: {
            ...options.__metadata,
            workloadIdentityTokenRefreshed: true
          }
        }, retriesRemaining, retryOfRequestLogID ?? requestLogID);
      }
      const shouldRetry = await this.shouldRetry(response);
      if (retriesRemaining && shouldRetry) {
        const retryMessage2 = `retrying, ${retriesRemaining} attempts remaining`;
        await CancelReadableStream(response.body);
        loggerFor(this).info(`${responseInfo} - ${retryMessage2}`);
        loggerFor(this).debug(`[${requestLogID}] response error (${retryMessage2})`, formatRequestDetails({
          retryOfRequestLogID,
          url: response.url,
          status: response.status,
          headers: response.headers,
          durationMs: headersTime - startTime
        }));
        return this.retryRequest(options, retriesRemaining, retryOfRequestLogID ?? requestLogID, response.headers);
      }
      const retryMessage = shouldRetry ? `error; no more retries left` : `error; not retryable`;
      loggerFor(this).info(`${responseInfo} - ${retryMessage}`);
      const errText = await response.text().catch((err2) => castToError(err2).message);
      const errJSON = safeJSON(errText);
      const errMessage = errJSON ? void 0 : errText;
      loggerFor(this).debug(`[${requestLogID}] response error (${retryMessage})`, formatRequestDetails({
        retryOfRequestLogID,
        url: response.url,
        status: response.status,
        headers: response.headers,
        message: errMessage,
        durationMs: Date.now() - startTime
      }));
      const err = this.makeStatusError(response.status, errJSON, errMessage, response.headers);
      throw err;
    }
    loggerFor(this).info(responseInfo);
    loggerFor(this).debug(`[${requestLogID}] response start`, formatRequestDetails({
      retryOfRequestLogID,
      url: response.url,
      status: response.status,
      headers: response.headers,
      durationMs: headersTime - startTime
    }));
    return { response, options, controller, requestLogID, retryOfRequestLogID, startTime };
  }
  getAPIList(path2, Page2, opts) {
    return this.requestAPIList(Page2, opts && "then" in opts ? opts.then((opts2) => ({ method: "get", path: path2, ...opts2 })) : { method: "get", path: path2, ...opts });
  }
  requestAPIList(Page2, options) {
    const request = this.makeRequest(options, null, void 0);
    return new PagePromise(this, request, Page2);
  }
  async fetchWithAuth(url, init, timeout, controller) {
    if (this._workloadIdentityAuth) {
      const headers = init.headers;
      const authHeader = headers.get("Authorization");
      if (!authHeader || authHeader === `Bearer ${WORKLOAD_IDENTITY_API_KEY_PLACEHOLDER}`) {
        const token = await this._workloadIdentityAuth.getToken();
        headers.set("Authorization", `Bearer ${token}`);
      }
    }
    const response = await this.fetchWithTimeout(url, init, timeout, controller);
    return response;
  }
  async fetchWithTimeout(url, init, ms, controller) {
    const { signal, method, ...options } = init || {};
    const abort = this._makeAbort(controller);
    if (signal)
      signal.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(abort, ms);
    const isReadableBody = globalThis.ReadableStream && options.body instanceof globalThis.ReadableStream || typeof options.body === "object" && options.body !== null && Symbol.asyncIterator in options.body;
    const fetchOptions = {
      signal: controller.signal,
      ...isReadableBody ? { duplex: "half" } : {},
      method: "GET",
      ...options
    };
    if (method) {
      fetchOptions.method = method.toUpperCase();
    }
    try {
      return await this.fetch.call(void 0, url, fetchOptions);
    } finally {
      clearTimeout(timeout);
    }
  }
  async shouldRetry(response) {
    const shouldRetryHeader = response.headers.get("x-should-retry");
    if (shouldRetryHeader === "true")
      return true;
    if (shouldRetryHeader === "false")
      return false;
    if (response.status === 408)
      return true;
    if (response.status === 409)
      return true;
    if (response.status === 429)
      return true;
    if (response.status >= 500)
      return true;
    return false;
  }
  async retryRequest(options, retriesRemaining, requestLogID, responseHeaders) {
    let timeoutMillis;
    const retryAfterMillisHeader = responseHeaders?.get("retry-after-ms");
    if (retryAfterMillisHeader) {
      const timeoutMs = parseFloat(retryAfterMillisHeader);
      if (!Number.isNaN(timeoutMs)) {
        timeoutMillis = timeoutMs;
      }
    }
    const retryAfterHeader = responseHeaders?.get("retry-after");
    if (retryAfterHeader && !timeoutMillis) {
      const timeoutSeconds = parseFloat(retryAfterHeader);
      if (!Number.isNaN(timeoutSeconds)) {
        timeoutMillis = timeoutSeconds * 1e3;
      } else {
        timeoutMillis = Date.parse(retryAfterHeader) - Date.now();
      }
    }
    if (timeoutMillis === void 0) {
      const maxRetries = options.maxRetries ?? this.maxRetries;
      timeoutMillis = this.calculateDefaultRetryTimeoutMillis(retriesRemaining, maxRetries);
    }
    await sleep(timeoutMillis);
    return this.makeRequest(options, retriesRemaining - 1, requestLogID);
  }
  calculateDefaultRetryTimeoutMillis(retriesRemaining, maxRetries) {
    const initialRetryDelay = 0.5;
    const maxRetryDelay = 8;
    const numRetries = maxRetries - retriesRemaining;
    const sleepSeconds = Math.min(initialRetryDelay * Math.pow(2, numRetries), maxRetryDelay);
    const jitter = 1 - Math.random() * 0.25;
    return sleepSeconds * jitter * 1e3;
  }
  async buildRequest(inputOptions, { retryCount = 0 } = {}) {
    const options = { ...inputOptions };
    const { method, path: path2, query, defaultBaseURL } = options;
    const url = this.buildURL(path2, query, defaultBaseURL);
    if ("timeout" in options)
      validatePositiveInteger("timeout", options.timeout);
    options.timeout = options.timeout ?? this.timeout;
    const { bodyHeaders, body, isStreamingBody } = this.buildBody({ options });
    if (isStreamingBody) {
      inputOptions.__metadata = {
        ...inputOptions.__metadata,
        hasStreamingBody: true
      };
    }
    const reqHeaders = await this.buildHeaders({ options: inputOptions, method, bodyHeaders, retryCount });
    const req = {
      method,
      headers: reqHeaders,
      ...options.signal && { signal: options.signal },
      ...globalThis.ReadableStream && body instanceof globalThis.ReadableStream && { duplex: "half" },
      ...body && { body },
      ...this.fetchOptions ?? {},
      ...options.fetchOptions ?? {}
    };
    return { req, url, timeout: options.timeout };
  }
  async buildHeaders({ options, method, bodyHeaders, retryCount }) {
    let idempotencyHeaders = {};
    if (this.idempotencyHeader && method !== "get") {
      if (!options.idempotencyKey)
        options.idempotencyKey = this.defaultIdempotencyKey();
      idempotencyHeaders[this.idempotencyHeader] = options.idempotencyKey;
    }
    const headers = buildHeaders([
      idempotencyHeaders,
      {
        Accept: "application/json",
        "User-Agent": this.getUserAgent(),
        "X-Stainless-Retry-Count": String(retryCount),
        ...options.timeout ? { "X-Stainless-Timeout": String(Math.trunc(options.timeout / 1e3)) } : {},
        ...getPlatformHeaders(),
        "OpenAI-Organization": this.organization,
        "OpenAI-Project": this.project
      },
      await this.authHeaders(options),
      this._options.defaultHeaders,
      bodyHeaders,
      options.headers
    ]);
    this.validateHeaders(headers);
    return headers.values;
  }
  _makeAbort(controller) {
    return () => controller.abort();
  }
  buildBody({ options: { body, headers: rawHeaders } }) {
    if (!body) {
      return { bodyHeaders: void 0, body: void 0, isStreamingBody: false };
    }
    const headers = buildHeaders([rawHeaders]);
    const isReadableStream = typeof globalThis.ReadableStream !== "undefined" && body instanceof globalThis.ReadableStream;
    const isRetryableBody = !isReadableStream && (typeof body === "string" || body instanceof ArrayBuffer || ArrayBuffer.isView(body) || typeof globalThis.Blob !== "undefined" && body instanceof globalThis.Blob || body instanceof URLSearchParams || body instanceof FormData);
    if (
      // Pass raw type verbatim
      ArrayBuffer.isView(body) || body instanceof ArrayBuffer || body instanceof DataView || typeof body === "string" && // Preserve legacy string encoding behavior for now
      headers.values.has("content-type") || // `Blob` is superset of `File`
      globalThis.Blob && body instanceof globalThis.Blob || // `FormData` -> `multipart/form-data`
      body instanceof FormData || // `URLSearchParams` -> `application/x-www-form-urlencoded`
      body instanceof URLSearchParams || // Send chunked stream (each chunk has own `length`)
      isReadableStream
    ) {
      return { bodyHeaders: void 0, body, isStreamingBody: !isRetryableBody };
    } else if (typeof body === "object" && (Symbol.asyncIterator in body || Symbol.iterator in body && "next" in body && typeof body.next === "function")) {
      return {
        bodyHeaders: void 0,
        body: ReadableStreamFrom(body),
        isStreamingBody: true
      };
    } else if (typeof body === "object" && headers.values.get("content-type") === "application/x-www-form-urlencoded") {
      return {
        bodyHeaders: { "content-type": "application/x-www-form-urlencoded" },
        body: this.stringifyQuery(body),
        isStreamingBody: false
      };
    } else {
      return { ...__classPrivateFieldGet(this, _OpenAI_encoder, "f").call(this, { body, headers }), isStreamingBody: false };
    }
  }
};
_a2 = OpenAI, _OpenAI_encoder = /* @__PURE__ */ new WeakMap(), _OpenAI_instances = /* @__PURE__ */ new WeakSet(), _OpenAI_baseURLOverridden = function _OpenAI_baseURLOverridden2() {
  return this.baseURL !== "https://api.openai.com/v1";
};
OpenAI.OpenAI = _a2;
OpenAI.DEFAULT_TIMEOUT = 6e5;
OpenAI.OpenAIError = OpenAIError;
OpenAI.APIError = APIError;
OpenAI.APIConnectionError = APIConnectionError;
OpenAI.APIConnectionTimeoutError = APIConnectionTimeoutError;
OpenAI.APIUserAbortError = APIUserAbortError;
OpenAI.NotFoundError = NotFoundError;
OpenAI.ConflictError = ConflictError;
OpenAI.RateLimitError = RateLimitError;
OpenAI.BadRequestError = BadRequestError;
OpenAI.AuthenticationError = AuthenticationError;
OpenAI.InternalServerError = InternalServerError;
OpenAI.PermissionDeniedError = PermissionDeniedError;
OpenAI.UnprocessableEntityError = UnprocessableEntityError;
OpenAI.InvalidWebhookSignatureError = InvalidWebhookSignatureError;
OpenAI.toFile = toFile;
OpenAI.Completions = Completions2;
OpenAI.Chat = Chat;
OpenAI.Embeddings = Embeddings;
OpenAI.Files = Files2;
OpenAI.Images = Images;
OpenAI.Audio = Audio;
OpenAI.Moderations = Moderations;
OpenAI.Models = Models;
OpenAI.FineTuning = FineTuning;
OpenAI.Graders = Graders2;
OpenAI.VectorStores = VectorStores;
OpenAI.Webhooks = Webhooks;
OpenAI.Beta = Beta;
OpenAI.Batches = Batches;
OpenAI.Uploads = Uploads;
OpenAI.Responses = Responses;
OpenAI.Realtime = Realtime2;
OpenAI.Conversations = Conversations;
OpenAI.Evals = Evals;
OpenAI.Containers = Containers;
OpenAI.Skills = Skills;
OpenAI.Videos = Videos;

// src/mobile-fetch.ts
var import_obsidian5 = require("obsidian");
var mobileFetch = async (input, init) => {
  if (init?.signal?.aborted)
    throw new DOMException("Aborted", "AbortError");
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const body = init?.body;
  if (body != null && typeof body !== "string") {
    throw new Error("mobileFetch: only string body supported");
  }
  const r = await (0, import_obsidian5.requestUrl)({
    url,
    method: init?.method ?? "GET",
    headers: init?.headers,
    body: body ?? void 0,
    throw: false
  });
  return new Response(r.text, { status: r.status, headers: r.headers });
};

// src/domain-store.ts
var FILE_PATH = "!Wiki/_domain.json";
var TMP_PATH = `${FILE_PATH}.tmp`;
var WIKI_DIR = "!Wiki";
var DomainCorruptError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "DomainCorruptError";
  }
};
var DomainStore = class {
  constructor(vault) {
    this.vault = vault;
  }
  async load() {
    const adapter = this.vault.adapter;
    if (!await adapter.exists(FILE_PATH))
      return [];
    const raw = await adapter.read(FILE_PATH);
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      throw new DomainCorruptError(`${FILE_PATH}: ${e.message}`);
    }
    if (!Array.isArray(parsed))
      throw new DomainCorruptError(`${FILE_PATH}: expected JSON array`);
    const domains = parsed;
    for (const d of domains) {
      if (d.wiki_folder?.startsWith("!Wiki/")) {
        d.wiki_folder = d.wiki_folder.slice("!Wiki/".length);
      }
    }
    return domains;
  }
  async save(domains) {
    const adapter = this.vault.adapter;
    if (!await adapter.exists(WIKI_DIR))
      await adapter.mkdir(WIKI_DIR);
    const body = JSON.stringify(domains, null, 2);
    await adapter.write(TMP_PATH, body);
    if (await adapter.exists(FILE_PATH))
      await adapter.remove(FILE_PATH);
    await adapter.rename(TMP_PATH, FILE_PATH);
  }
};

// src/controller.ts
var WikiController = class {
  constructor(app, plugin, domainStore, localConfigStore) {
    this.app = app;
    this.plugin = plugin;
    this.domainStore = domainStore;
    this.localConfigStore = localConfigStore;
  }
  current = null;
  currentOp = null;
  _chatSessionId;
  _currentClaudeClient = null;
  _pendingFormat = null;
  isBusy() {
    return this.current !== null;
  }
  onBusyChange;
  get running() {
    return this.current !== null;
  }
  cancelCurrent() {
    if (this.current) {
      this.current.abort();
      new import_obsidian6.Notice(i18n().ctrl.cancelling);
    }
  }
  async format() {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      new import_obsidian6.Notice(i18n().ctrl.noActiveFile);
      return;
    }
    if (file.extension !== "md") {
      new import_obsidian6.Notice(i18n().view.formatOnlyMarkdown ?? "Format only works on markdown files");
      return;
    }
    const domains = await this.loadDomains();
    const inWiki = domains.find((d) => {
      const wikiPrefix = domainWikiFolder(d.wiki_folder);
      return file.path === wikiPrefix || file.path.startsWith(wikiPrefix + "/");
    });
    if (inWiki) {
      const T = i18n().view;
      new ConfirmModal(
        this.app,
        T.formatInWikiTitle,
        [T.formatInWikiBody(inWiki.id)],
        () => void this.suggestIngestForWikiFile(file.path, inWiki)
      ).open();
      return;
    }
    this._pendingFormat = { originalPath: file.path, tempPath: "", chat: [] };
    await this.dispatch("format", [file.path]);
  }
  async suggestIngestForWikiFile(filePath, domain) {
    const content = await this.app.vault.adapter.read(filePath);
    const m = content.match(/^---\n([\s\S]*?)\n---/);
    if (!m) {
      new import_obsidian6.Notice(i18n().view.formatInWikiNoSources);
      return;
    }
    const frontmatter = m[1];
    const sourcesMatch = frontmatter.match(/wiki_sources:\s*\n((?:\s*-\s*.+\n?)+)/);
    if (!sourcesMatch) {
      new import_obsidian6.Notice(i18n().view.formatInWikiNoSources);
      return;
    }
    const sources = sourcesMatch[1].split("\n").map((l) => l.replace(/^\s*-\s*/, "").trim()).filter(Boolean);
    if (!sources.length) {
      new import_obsidian6.Notice(i18n().view.formatInWikiNoSources);
      return;
    }
    await this.init(domain.id, false, sources);
  }
  async formatApply() {
    const p = this._pendingFormat;
    if (!p || !p.tempPath) {
      new import_obsidian6.Notice(i18n().view.formatNoPending ?? "No format preview to apply");
      return;
    }
    if (this.isBusy()) {
      new import_obsidian6.Notice(i18n().ctrl.operationRunning);
      return;
    }
    try {
      const content = await this.app.vault.adapter.read(p.tempPath);
      const origFile = this.app.vault.getAbstractFileByPath(p.originalPath);
      if (origFile && "stat" in origFile) {
        await this.app.vault.modify(origFile, content);
      } else {
        await this.app.vault.adapter.write(p.originalPath, content);
      }
      await this.app.vault.adapter.remove(p.tempPath);
      new import_obsidian6.Notice(i18n().view.formatApplied(p.originalPath));
      this.activeView()?.appendEvent({ kind: "format_applied", path: p.originalPath });
    } catch (e) {
      new import_obsidian6.Notice(i18n().ctrl.errorPrefix(e.message));
    } finally {
      this._pendingFormat = null;
      this.onBusyChange?.();
    }
  }
  async formatCancel() {
    const p = this._pendingFormat;
    if (!p || !p.tempPath) {
      this._pendingFormat = null;
      return;
    }
    try {
      await this.app.vault.adapter.remove(p.tempPath);
    } catch {
    }
    this._pendingFormat = null;
    new import_obsidian6.Notice(i18n().view.formatCancelled);
    this.activeView()?.appendEvent({ kind: "format_cancelled" });
    this.onBusyChange?.();
  }
  async formatRefine(message) {
    const p = this._pendingFormat;
    if (!p) {
      new import_obsidian6.Notice(i18n().view.formatNoPending ?? "No format preview to refine");
      return;
    }
    if (this.isBusy()) {
      new import_obsidian6.Notice(i18n().ctrl.operationRunning);
      return;
    }
    p.chat.push({ role: "user", content: message });
    await this.dispatch("format", [p.originalPath]);
  }
  async ingestActive(domainId) {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      new import_obsidian6.Notice(i18n().ctrl.noActiveFile);
      return;
    }
    const abs = this.app.vault.adapter.getFullPath(file.path);
    await this.dispatch("ingest", [abs], domainId);
  }
  async query(question, save, domainId) {
    if (!question.trim())
      return;
    const op = save ? "query-save" : "query";
    await this.dispatch(op, [question.trim()], domainId);
  }
  async lint(domain) {
    const args = domain === "all" ? [] : [domain];
    await this.dispatch("lint", args);
  }
  async fix(domainId, lintReport, instruction) {
    await this.dispatch("fix", [domainId], domainId, lintReport, instruction);
  }
  async chat(operation, domainId, context, history, newMessage) {
    const chatMessages = [...history, { role: "user", content: newMessage }];
    await this.dispatchChat(operation, domainId, context, chatMessages);
  }
  async dispatchChat(operation, domainId, context, chatMessages) {
    if (this.isBusy()) {
      new import_obsidian6.Notice(i18n().ctrl.operationRunning);
      return;
    }
    if (import_obsidian6.Platform.isMobile && operation !== "query" && operation !== "query-save") {
      new import_obsidian6.Notice(i18n().ctrl.mobileNotAvailable);
      return;
    }
    {
      const local = await this.localConfigStore.load();
      const eff = resolveEffective(this.plugin.settings, local);
      if (eff.backend === "native-agent" && !this.requireNativeAgent(eff))
        return;
      if (eff.backend === "claude-agent" && !await this.requireClaudeAgent(local))
        return;
    }
    await this.ensureView();
    const view = this.activeView();
    if (!view)
      return;
    const vaultRoot = this.cwdOrEmpty();
    let agentRunner;
    try {
      agentRunner = await this.buildAgentRunner(vaultRoot, this._chatSessionId);
    } catch (e) {
      new import_obsidian6.Notice(i18n().ctrl.errorPrefix(e.message));
      console.error("[llm-wiki] buildAgentRunner failed", e);
      return;
    }
    const ctrl = new AbortController();
    this.current = ctrl;
    this.onBusyChange?.();
    const startedAt = Date.now();
    const sessionId = String(startedAt);
    const lastMsg = chatMessages[chatMessages.length - 1]?.content ?? "";
    let finalText = "";
    let status = "done";
    await this.logEvent(vaultRoot, sessionId, "chat", domainId, {
      kind: "system",
      message: `start op=chat args=${JSON.stringify([lastMsg])} domainId=${domainId}`
    });
    view.setChatRunning();
    const OPERATION_LABELS = {
      lint: "Lint-\u043F\u0440\u043E\u0432\u0435\u0440\u043A\u0430 wiki",
      ingest: "\u0418\u0437\u0432\u043B\u0435\u0447\u0435\u043D\u0438\u0435 \u0437\u043D\u0430\u043D\u0438\u0439 (ingest)",
      query: "\u041E\u0442\u0432\u0435\u0442 \u043D\u0430 \u0437\u0430\u043F\u0440\u043E\u0441 (query)",
      "query-save": "\u041E\u0442\u0432\u0435\u0442 \u043D\u0430 \u0437\u0430\u043F\u0440\u043E\u0441 \u0441 \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u0438\u0435\u043C (query-save)"
    };
    const operationHeader = OPERATION_LABELS[operation] ?? operation;
    const timeoutMs = this.plugin.settings.timeouts.lint * 1e3;
    const runGen = agentRunner.run({
      operation: "chat",
      args: [],
      cwd: vaultRoot,
      signal: ctrl.signal,
      timeoutMs,
      domainId,
      context,
      chatMessages,
      operationHeader
    });
    try {
      for await (const ev of runGen) {
        await this.logEvent(vaultRoot, sessionId, "chat", domainId, ev);
        this.activeView()?.appendChatEvent(ev);
        if (ev.kind === "system" && ev.sessionId) {
          this._chatSessionId = ev.sessionId;
        }
        if (ev.kind === "result")
          finalText = ev.text;
        if (ev.kind === "error") {
          status = "error";
          this._chatSessionId = void 0;
        }
      }
    } catch (err) {
      status = "error";
      this._chatSessionId = void 0;
      finalText = i18n().ctrl.errorPrefix(err.message);
      await this.logEvent(vaultRoot, sessionId, "chat", domainId, { kind: "error", message: finalText });
    } finally {
      this.current = null;
      this.onBusyChange?.();
      this.currentOp = null;
    }
    if (status === "done") {
      const capturedId = this._currentClaudeClient?.lastSessionId;
      if (capturedId)
        this._chatSessionId = capturedId;
    }
    if (ctrl.signal.aborted)
      this._chatSessionId = void 0;
    await this.logEvent(vaultRoot, sessionId, "chat", domainId, {
      kind: "system",
      message: `finish status=${status} durationMs=${Date.now() - startedAt}`
    });
    this.activeView()?.finishChat({ role: "assistant", content: finalText }, status !== "done");
  }
  async init(domain, dryRun, sourcePaths) {
    const args = dryRun ? [domain, "--dry-run"] : [domain];
    if (sourcePaths?.length)
      args.push("--sources", ...sourcePaths);
    const onFileError = sourcePaths?.length ? (file, err, canRetry) => {
      const modal = new FileErrorModal(this.app, file, err, canRetry);
      modal.open();
      return modal.result;
    } : void 0;
    await this.dispatch("init", args, void 0, void 0, void 0, onFileError);
  }
  cwdOrEmpty() {
    const adapter = this.app.vault.adapter;
    const base = adapter.getBasePath?.();
    if (base == null) {
      if (!import_obsidian6.Platform.isMobile) {
        console.warn("[llm-wiki] vault.adapter.getBasePath is undefined on desktop");
      }
      return "";
    }
    return base;
  }
  async loadDomains() {
    try {
      return await this.domainStore.load();
    } catch (e) {
      if (e instanceof DomainCorruptError) {
        new import_obsidian6.Notice(`Domain map corrupt: ${e.message}`);
      }
      throw e;
    }
  }
  async registerDomain(input) {
    const id = input.id.trim();
    const err = validateDomainId(id);
    if (err) {
      new import_obsidian6.Notice(i18n().ctrl.domainAddFailed(err));
      return { ok: false, error: err };
    }
    const cur = await this.domainStore.load();
    if (cur.some((d) => d.id === id)) {
      const msg = `\u0414\u043E\u043C\u0435\u043D \xAB${id}\xBB \u0443\u0436\u0435 \u0441\u0443\u0449\u0435\u0441\u0442\u0432\u0443\u0435\u0442`;
      new import_obsidian6.Notice(i18n().ctrl.domainAddFailed(msg));
      return { ok: false, error: msg };
    }
    const wikiSubfolder = input.wikiFolder.trim() || id;
    const next = [...cur, {
      id,
      name: input.name.trim() || id,
      wiki_folder: wikiSubfolder,
      source_paths: input.sourcePaths ?? [],
      entity_types: [],
      language_notes: ""
    }];
    await this.domainStore.save(next);
    new import_obsidian6.Notice(i18n().ctrl.domainAdded(id));
    return { ok: true };
  }
  async requireClaudeAgent(local) {
    const { existsSync } = require("node:fs");
    const { iclaudePath } = local;
    if (!iclaudePath || !existsSync(iclaudePath)) {
      new import_obsidian6.Notice(i18n().ctrl.setClaudeCodePath);
      return null;
    }
    return iclaudePath;
  }
  requireNativeAgent(eff) {
    const na = eff.nativeAgent;
    if (!na?.baseUrl?.trim() || !na?.apiKey?.trim()) {
      new import_obsidian6.Notice(i18n().ctrl.configureCloudLlm);
      return false;
    }
    return true;
  }
  async buildAgentRunner(vaultRoot, resumeSessionId) {
    const adapter = this.app.vault.adapter;
    const base = this.cwdOrEmpty();
    const vaultTools = new VaultTools(adapter, base);
    const vaultName = this.app.vault.getName();
    const domains = await this.domainStore.load();
    const local = await this.localConfigStore.load();
    const s = resolveEffective(this.plugin.settings, local);
    const maxTimeoutSec = Math.max(...Object.values(s.timeouts));
    let llm;
    if (s.backend === "claude-agent") {
      const { join: join6 } = require("node:path");
      const { mkdirSync } = require("node:fs");
      const { ClaudeCliClient: ClaudeCliClient2 } = (init_claude_cli_client(), __toCommonJS(claude_cli_client_exports));
      const manifestDir = this.plugin.manifest.dir ?? join6(this.app.vault.configDir, "plugins", this.plugin.manifest.id);
      const pluginDir = this.app.vault.adapter.getFullPath(manifestDir);
      const tmpDir = join6(pluginDir, "tmp");
      mkdirSync(tmpDir, { recursive: true });
      const client = new ClaudeCliClient2({
        ...s.claudeAgent,
        iclaudePath: local.iclaudePath,
        requestTimeoutSec: maxTimeoutSec,
        cwd: vaultRoot,
        tmpDir,
        resumeSessionId
      });
      this._currentClaudeClient = client;
      llm = client;
    } else {
      this._currentClaudeClient = null;
      llm = new OpenAI({
        baseURL: s.nativeAgent.baseUrl,
        apiKey: s.nativeAgent.apiKey,
        timeout: maxTimeoutSec * 1e3,
        dangerouslyAllowBrowser: true,
        fetch: import_obsidian6.Platform.isMobile ? mobileFetch : void 0
      });
    }
    return new AgentRunner(llm, s, vaultTools, vaultName, domains);
  }
  async logEvent(_vaultRoot, sessionId, op, domainId, ev) {
    if (!this.plugin.settings.agentLogEnabled)
      return;
    const adapter = this.app.vault.adapter;
    const dir = "!Logs";
    const path2 = `${dir}/agent.jsonl`;
    try {
      if (!await adapter.exists(dir))
        await adapter.mkdir(dir);
      const line = JSON.stringify({
        ts: (/* @__PURE__ */ new Date()).toISOString(),
        session: sessionId,
        op,
        domainId,
        event: ev
      }) + "\n";
      if (await adapter.exists(path2))
        await adapter.append(path2, line);
      else
        await adapter.write(path2, line);
    } catch {
    }
  }
  async dispatch(op, args, domainId, context, instruction, onFileError) {
    if (this.isBusy()) {
      new import_obsidian6.Notice(i18n().ctrl.operationRunning);
      return;
    }
    this._chatSessionId = void 0;
    if (import_obsidian6.Platform.isMobile && op !== "query" && op !== "query-save" && op !== "format") {
      new import_obsidian6.Notice(i18n().ctrl.mobileNotAvailable);
      return;
    }
    {
      const local = await this.localConfigStore.load();
      const eff = resolveEffective(this.plugin.settings, local);
      if (eff.backend === "native-agent" && !this.requireNativeAgent(eff))
        return;
      if (eff.backend === "claude-agent" && !await this.requireClaudeAgent(local))
        return;
    }
    await this.ensureView();
    const view = this.activeView();
    if (!view)
      return;
    const vaultRoot = this.cwdOrEmpty();
    let agentRunner;
    try {
      agentRunner = await this.buildAgentRunner(vaultRoot);
    } catch (e) {
      new import_obsidian6.Notice(i18n().ctrl.errorPrefix(e.message));
      console.error("[llm-wiki] buildAgentRunner failed", e);
      return;
    }
    const ctrl = new AbortController();
    this.current = ctrl;
    this.onBusyChange?.();
    this.currentOp = { op, args };
    const startedAt = Date.now();
    const sessionId = String(startedAt);
    const steps = [];
    let finalText = "";
    let status = "done";
    await this.logEvent(vaultRoot, sessionId, op, domainId, { kind: "system", message: `start op=${op} args=${JSON.stringify(args)} domainId=${domainId ?? ""}` });
    view.setRunning(op, args);
    const opKey = op === "query-save" ? "query" : op;
    const timeoutMs = this.plugin.settings.timeouts[opKey] * 1e3;
    const chatMessages = op === "format" ? this._pendingFormat?.chat : void 0;
    const runGen = agentRunner.run({ operation: op, args, cwd: vaultRoot, signal: ctrl.signal, timeoutMs, domainId, context, instruction, onFileError, chatMessages });
    try {
      for await (const ev of runGen) {
        await this.logEvent(vaultRoot, sessionId, op, domainId, ev);
        this.activeView()?.appendEvent(ev);
        if (ev.kind === "domain_created" || ev.kind === "domain_updated" || ev.kind === "source_path_added") {
          try {
            const cur = await this.domainStore.load();
            const next = applyDomainEvent(cur, ev, { vaultRoot });
            if (next !== cur)
              await this.domainStore.save(next);
          } catch (e) {
            if (e instanceof DomainCorruptError) {
              new import_obsidian6.Notice(`Domain map corrupt: ${e.message}`);
            }
            status = "error";
            ctrl.abort();
            break;
          }
        }
        if (ev.kind === "format_preview" && this._pendingFormat) {
          this._pendingFormat.tempPath = ev.tempPath;
          this._pendingFormat.chat.push({ role: "assistant", content: ev.report });
        }
        this.collectStep(ev, steps);
        if (ev.kind === "result")
          finalText = ev.text;
        if (ev.kind === "error")
          status = "error";
        if (ev.kind === "exit") {
          if (ev.code !== 0 && status === "done")
            status = "error";
          if (ctrl.signal.aborted)
            status = "cancelled";
        }
      }
    } catch (err) {
      status = "error";
      console.error("[llm-wiki] dispatch failed", err);
      finalText = i18n().ctrl.errorPrefix(err.message);
      await this.logEvent(vaultRoot, sessionId, op, domainId, { kind: "error", message: finalText });
    } finally {
      this.current = null;
      this.onBusyChange?.();
      this.currentOp = null;
    }
    await this.logEvent(vaultRoot, sessionId, op, domainId, { kind: "system", message: `finish status=${status} durationMs=${Date.now() - startedAt}` });
    const entry = {
      id: `${startedAt}`,
      operation: op,
      args,
      domainId,
      startedAt,
      finishedAt: Date.now(),
      status,
      finalText,
      steps
    };
    this.plugin.settings.history.push(entry);
    while (this.plugin.settings.history.length > this.plugin.settings.historyLimit) {
      this.plugin.settings.history.shift();
    }
    await this.plugin.saveSettings();
    await this.activeView()?.finish(entry);
    if (op === "query-save" && status === "done" && !import_obsidian6.Platform.isMobile) {
      const m = finalText.match(/Создана\s+страница:\s*([^\s`'"]+)/i);
      if (m) {
        const pathInVault = await this.toVaultPath(vaultRoot, m[1]);
        if (pathInVault)
          await this.app.workspace.openLinkText(pathInVault, "");
      }
    }
  }
  collectStep(ev, steps) {
    if (ev.kind === "tool_use") {
      const inp = ev.input ?? {};
      steps.push({ kind: "tool_use", label: `${ev.name} ${inp.file_path ?? inp.pattern ?? ""}`.trim() });
    } else if (ev.kind === "tool_result") {
      steps.push({ kind: "tool_result", label: ev.ok ? "ok" : "error" });
    }
  }
  async ensureView() {
    const leaves = this.app.workspace.getLeavesOfType(LLM_WIKI_VIEW_TYPE);
    if (leaves.length === 0) {
      const right = this.app.workspace.getRightLeaf(false);
      if (right)
        await right.setViewState({ type: LLM_WIKI_VIEW_TYPE, active: true });
    } else {
      void this.app.workspace.revealLeaf(leaves[0]);
    }
  }
  activeView() {
    const leaves = this.app.workspace.getLeavesOfType(LLM_WIKI_VIEW_TYPE);
    const view = leaves[0]?.view;
    return view instanceof LlmWikiView ? view : null;
  }
  async toVaultPath(vaultDir, savedPath) {
    const { relative: relative2, isAbsolute: isAbsolute3, join: join6 } = require("node:path");
    const abs = isAbsolute3(savedPath) ? savedPath : join6(vaultDir, savedPath);
    const rel = relative2(vaultDir, abs);
    if (rel.startsWith("..") || isAbsolute3(rel))
      return null;
    return rel;
  }
};

// src/local-config.ts
var DEFAULTS = { iclaudePath: "" };
var LocalConfigStore = class {
  constructor(plugin) {
    this.plugin = plugin;
  }
  cache = null;
  path() {
    const dir = this.plugin.manifest.dir;
    if (!dir)
      throw new Error("LocalConfigStore: plugin manifest.dir is undefined");
    return `${dir}/local.json`;
  }
  async load() {
    if (this.cache)
      return this.cache;
    const adapter = this.plugin.app.vault.adapter;
    const p = this.path();
    if (!await adapter.exists(p)) {
      this.cache = { ...DEFAULTS };
      return this.cache;
    }
    try {
      const raw = await adapter.read(p);
      this.cache = { ...DEFAULTS, ...JSON.parse(raw) };
    } catch {
      this.cache = { ...DEFAULTS };
    }
    return this.cache;
  }
  async save(patch) {
    const cur = await this.load();
    const next = { ...cur, ...patch };
    await this.plugin.app.vault.adapter.write(this.path(), JSON.stringify(next, null, 2));
    this.cache = next;
  }
};

// src/main.ts
var LlmWikiPlugin = class extends import_obsidian7.Plugin {
  settings;
  controller;
  settingTab;
  domainStore;
  localConfigStore;
  async onload() {
    this.domainStore = new DomainStore(this.app.vault);
    this.localConfigStore = new LocalConfigStore(this);
    await migrateLegacyData(this, this.domainStore, this.localConfigStore);
    await this.loadSettings();
    await migrateToLocalV1(this, this.localConfigStore);
    this.controller = new WikiController(this.app, this, this.domainStore, this.localConfigStore);
    this.controller.onBusyChange = () => this.settingTab?.display();
    this.registerView(LLM_WIKI_VIEW_TYPE, (leaf) => new LlmWikiView(leaf, this));
    this.addRibbonIcon("brain-circuit", "LLM wiki", () => {
      const leaves = this.app.workspace.getLeavesOfType(LLM_WIKI_VIEW_TYPE);
      if (leaves.length > 0) {
        void this.app.workspace.revealLeaf(leaves[0]);
      } else {
        const right = this.app.workspace.getRightLeaf(false);
        if (right)
          void right.setViewState({ type: LLM_WIKI_VIEW_TYPE, active: true });
      }
    });
    const T = i18n();
    this.addCommand({
      id: "open-panel",
      name: T.cmd.openPanel,
      callback: () => {
        const right = this.app.workspace.getRightLeaf(false);
        if (right)
          void right.setViewState({ type: LLM_WIKI_VIEW_TYPE, active: true });
      }
    });
    if (!import_obsidian7.Platform.isMobile) {
      this.addCommand({
        id: "ingest-current",
        name: T.cmd.ingestActive,
        callback: () => void this.controller.ingestActive()
      });
    }
    this.addCommand({
      id: "query",
      name: T.cmd.query,
      callback: () => new QueryModal(this.app, false, (q) => void this.controller.query(q, false)).open()
    });
    this.addCommand({
      id: "query-save",
      name: T.cmd.querySave,
      callback: () => new QueryModal(this.app, true, (q) => void this.controller.query(q, true)).open()
    });
    if (!import_obsidian7.Platform.isMobile) {
      this.addCommand({
        id: "lint",
        name: T.cmd.lint,
        callback: () => {
          void (async () => {
            let domains;
            try {
              domains = await this.controller.loadDomains();
            } catch {
              return;
            }
            new DomainModal(
              this.app,
              T.cmd.lint,
              true,
              null,
              domains,
              (d) => void this.controller.lint(d)
            ).open();
          })();
        }
      });
      this.addCommand({
        id: "init",
        name: T.cmd.init,
        callback: () => {
          void (async () => {
            let domains;
            try {
              domains = await this.controller.loadDomains();
            } catch {
              return;
            }
            new DomainModal(
              this.app,
              T.cmd.init,
              false,
              { dryRun: true },
              domains,
              (d, f) => void this.controller.init(d, f.dryRun ?? false)
            ).open();
          })();
        }
      });
    }
    this.addCommand({
      id: "cancel",
      name: T.cmd.cancel,
      callback: () => this.controller.cancelCurrent()
    });
    this.settingTab = new LlmWikiSettingTab(this.app, this);
    this.addSettingTab(this.settingTab);
    console.debug("[llm-wiki] loaded");
  }
  onunload() {
    this.controller.cancelCurrent();
    console.debug("[llm-wiki] unloaded");
  }
  async loadSettings() {
    const data = await this.loadData();
    const caData = data?.claudeAgent ?? {};
    const naData = data?.nativeAgent ?? {};
    const caOps = caData.operations ?? {};
    const naOps = naData.operations ?? {};
    const defCA = DEFAULT_SETTINGS.claudeAgent;
    const defNA = DEFAULT_SETTINGS.nativeAgent;
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...data ?? {},
      timeouts: { ...DEFAULT_SETTINGS.timeouts, ...data?.timeouts ?? {} },
      claudeAgent: {
        ...defCA,
        ...caData,
        operations: {
          ingest: { ...defCA.operations.ingest, ...caOps.ingest ?? {} },
          query: { ...defCA.operations.query, ...caOps.query ?? {} },
          lint: { ...defCA.operations.lint, ...caOps.lint ?? {} },
          init: { ...defCA.operations.init, ...caOps.init ?? {} },
          format: { ...defCA.operations.format, ...caOps.format ?? {} }
        }
      },
      nativeAgent: {
        ...defNA,
        ...naData,
        operations: {
          ingest: { ...defNA.operations.ingest, ...naOps.ingest ?? {} },
          query: { ...defNA.operations.query, ...naOps.query ?? {} },
          lint: { ...defNA.operations.lint, ...naOps.lint ?? {} },
          init: { ...defNA.operations.init, ...naOps.init ?? {} },
          format: { ...defNA.operations.format, ...naOps.format ?? {} }
        }
      },
      history: data?.history ?? []
    };
    if (!data?.systemPrompt && (caData.systemPrompt || naData.systemPrompt))
      this.settings.systemPrompt = caData.systemPrompt ?? naData.systemPrompt;
    if (!data?.maxTokens && (caData.maxTokens || naData.maxTokens))
      this.settings.maxTokens = caData.maxTokens ?? naData.maxTokens;
    if (data?.backend === "claude-code") {
      this.settings.backend = "claude-agent";
      if (data && data.model && !this.settings.claudeAgent.model)
        this.settings.claudeAgent.model = data.model;
    }
    if (import_obsidian7.Platform.isMobile && this.settings.backend === "claude-agent") {
      this.settings.backend = "native-agent";
      await this.saveData(this.settings);
    }
    if (import_obsidian7.Platform.isMobile) {
      let dirty = false;
      if (this.settings.nativeAgent.perOperation) {
        this.settings.nativeAgent.perOperation = false;
        dirty = true;
      }
      if (this.settings.devMode.enabled) {
        this.settings.devMode.enabled = false;
        dirty = true;
      }
      if (dirty)
        await this.saveData(this.settings);
    }
    if (typeof data?.agentLogPath === "string") {
      this.settings.agentLogEnabled = data.agentLogPath.length > 0;
    }
    this.settings.devMode = {
      enabled: this.settings.devMode.enabled,
      evaluatorModel: this.settings.devMode.evaluatorModel
    };
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
};
function migrateDomainWikiFolder(domains) {
  let changed = false;
  for (const d of domains) {
    if (d.wiki_folder?.startsWith("!Wiki/")) {
      d.wiki_folder = d.wiki_folder.slice("!Wiki/".length);
      changed = true;
    }
  }
  return changed;
}
async function migrateLegacyData(plugin, domainStore, localConfigStore) {
  const data = await plugin.loadData();
  if (!data)
    return;
  let dirty = false;
  if (Array.isArray(data.domains)) {
    if (data.domains.length > 0) {
      const vaultExists = await plugin.app.vault.adapter.exists("!Wiki/_domain.json");
      if (!vaultExists) {
        await domainStore.save(data.domains);
      }
    }
    delete data.domains;
    dirty = true;
  }
  const ca = data.claudeAgent;
  if (ca && typeof ca.iclaudePath === "string") {
    const cur = await localConfigStore.load();
    if (ca.iclaudePath.length > 0 && !cur.iclaudePath) {
      await localConfigStore.save({ iclaudePath: ca.iclaudePath });
    }
    delete ca.iclaudePath;
    dirty = true;
  }
  if (dirty)
    await plugin.saveData(data);
}
async function migrateToLocalV1(plugin, localConfigStore) {
  const local = await localConfigStore.load();
  if (local.migrated_v1)
    return;
  const s = plugin.settings;
  await localConfigStore.save({
    backend: s.backend,
    nativeAgent: {
      baseUrl: s.nativeAgent.baseUrl,
      apiKey: s.nativeAgent.apiKey,
      model: s.nativeAgent.model,
      temperature: s.nativeAgent.temperature,
      topP: s.nativeAgent.topP,
      numCtx: s.nativeAgent.numCtx
    },
    claudeAgent: {
      model: s.claudeAgent.model,
      allowedTools: s.claudeAgent.allowedTools
    },
    agentLogEnabled: s.agentLogEnabled,
    migrated_v1: true
  });
  s.nativeAgent.apiKey = "";
  await plugin.saveSettings();
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  migrateDomainWikiFolder,
  migrateLegacyData,
  migrateToLocalV1
});
