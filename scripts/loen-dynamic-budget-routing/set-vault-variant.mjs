#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const vaultRoot = process.env.AIWIKI_TEST_VAULT
  ?? "/tmp/ai-wiki-bounded-ingest-replay.SMt4rx/run";
const pluginDir = path.join(vaultRoot, ".obsidian/plugins/ai-wiki");
const dataPath = path.join(pluginDir, "data.json");
const evidenceDir = path.resolve("docs/loen/dynamic-llm-budget-routing/evidence");
const baselinePath = path.join(evidenceDir, "baseline-data.json");

const variant = process.argv[2];
if (!variant) {
  console.error("usage: set-vault-variant.mjs <a-off-16384|b-off-4096|c-connection-close-4096|d-undici-adapter-4096|restore>");
  process.exit(2);
}

function ensureObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

fs.mkdirSync(evidenceDir, { recursive: true });
if (!fs.existsSync(dataPath)) throw new Error(`missing data.json: ${dataPath}`);
const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
if (!fs.existsSync(baselinePath)) {
  fs.writeFileSync(baselinePath, `${JSON.stringify(data, null, 2)}\n`);
}

if (variant === "restore") {
  fs.copyFileSync(baselinePath, dataPath);
  console.log(JSON.stringify({ variant, restored: dataPath, baseline: baselinePath }, null, 2));
  process.exit(0);
}

const variants = {
  "a-off-16384": { devEnabled: false, mode: "off", initMaxTokens: 16384, perOperation: true },
  "b-off-4096": { devEnabled: false, mode: "off", initMaxTokens: 4096, perOperation: true },
  "c-connection-close-4096": { devEnabled: true, mode: "connection-close", initMaxTokens: 4096, perOperation: true },
  "d-undici-adapter-4096": { devEnabled: true, mode: "undici-request-adapter", initMaxTokens: 4096, perOperation: true },
};
const selected = variants[variant];
if (!selected) throw new Error(`unknown variant: ${variant}`);

data.devMode = ensureObject(data.devMode);
data.devMode.enabled = selected.devEnabled;
data.devMode.nativeTransportDiagnosticMode = selected.mode;

data.nativeAgent = ensureObject(data.nativeAgent);
const activeModel = typeof data.nativeAgent.model === "string" && data.nativeAgent.model.trim()
  ? data.nativeAgent.model
  : undefined;
data.nativeAgent.perOperation = selected.perOperation;
data.nativeAgent.operations = ensureObject(data.nativeAgent.operations);
for (const op of ["ingest", "query", "lint", "init", "format"]) {
  data.nativeAgent.operations[op] = ensureObject(data.nativeAgent.operations[op]);
  if (activeModel) data.nativeAgent.operations[op].model = activeModel;
}
data.nativeAgent.operations.init = {
  ...ensureObject(data.nativeAgent.operations.init),
  ...(activeModel ? { model: activeModel } : {}),
  maxTokens: selected.initMaxTokens,
};

fs.writeFileSync(dataPath, `${JSON.stringify(data, null, 2)}\n`);
console.log(JSON.stringify({
  variant,
  dataPath,
  effective: {
    devMode: data.devMode,
    nativeAgent: {
      perOperation: data.nativeAgent.perOperation,
      init: data.nativeAgent.operations.init,
      globalMaxTokens: data.nativeAgent.maxTokens,
      synthesisMaxEntityBatchSize: data.nativeAgent.synthesisMaxEntityBatchSize,
    },
  },
}, null, 2));
