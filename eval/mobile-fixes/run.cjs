"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/path-browserify/index.js
var require_path_browserify = __commonJS({
  "node_modules/path-browserify/index.js"(exports2, module2) {
    "use strict";
    function assertPath(path) {
      if (typeof path !== "string") {
        throw new TypeError("Path must be a string. Received " + JSON.stringify(path));
      }
    }
    function normalizeStringPosix(path, allowAboveRoot) {
      var res = "";
      var lastSegmentLength = 0;
      var lastSlash = -1;
      var dots = 0;
      var code;
      for (var i = 0; i <= path.length; ++i) {
        if (i < path.length)
          code = path.charCodeAt(i);
        else if (code === 47)
          break;
        else
          code = 47;
        if (code === 47) {
          if (lastSlash === i - 1 || dots === 1) {
          } else if (lastSlash !== i - 1 && dots === 2) {
            if (res.length < 2 || lastSegmentLength !== 2 || res.charCodeAt(res.length - 1) !== 46 || res.charCodeAt(res.length - 2) !== 46) {
              if (res.length > 2) {
                var lastSlashIndex = res.lastIndexOf("/");
                if (lastSlashIndex !== res.length - 1) {
                  if (lastSlashIndex === -1) {
                    res = "";
                    lastSegmentLength = 0;
                  } else {
                    res = res.slice(0, lastSlashIndex);
                    lastSegmentLength = res.length - 1 - res.lastIndexOf("/");
                  }
                  lastSlash = i;
                  dots = 0;
                  continue;
                }
              } else if (res.length === 2 || res.length === 1) {
                res = "";
                lastSegmentLength = 0;
                lastSlash = i;
                dots = 0;
                continue;
              }
            }
            if (allowAboveRoot) {
              if (res.length > 0)
                res += "/..";
              else
                res = "..";
              lastSegmentLength = 2;
            }
          } else {
            if (res.length > 0)
              res += "/" + path.slice(lastSlash + 1, i);
            else
              res = path.slice(lastSlash + 1, i);
            lastSegmentLength = i - lastSlash - 1;
          }
          lastSlash = i;
          dots = 0;
        } else if (code === 46 && dots !== -1) {
          ++dots;
        } else {
          dots = -1;
        }
      }
      return res;
    }
    function _format(sep, pathObject) {
      var dir = pathObject.dir || pathObject.root;
      var base = pathObject.base || (pathObject.name || "") + (pathObject.ext || "");
      if (!dir) {
        return base;
      }
      if (dir === pathObject.root) {
        return dir + base;
      }
      return dir + sep + base;
    }
    var posix = {
      // path.resolve([from ...], to)
      resolve: function resolve() {
        var resolvedPath = "";
        var resolvedAbsolute = false;
        var cwd;
        for (var i = arguments.length - 1; i >= -1 && !resolvedAbsolute; i--) {
          var path;
          if (i >= 0)
            path = arguments[i];
          else {
            if (cwd === void 0)
              cwd = process.cwd();
            path = cwd;
          }
          assertPath(path);
          if (path.length === 0) {
            continue;
          }
          resolvedPath = path + "/" + resolvedPath;
          resolvedAbsolute = path.charCodeAt(0) === 47;
        }
        resolvedPath = normalizeStringPosix(resolvedPath, !resolvedAbsolute);
        if (resolvedAbsolute) {
          if (resolvedPath.length > 0)
            return "/" + resolvedPath;
          else
            return "/";
        } else if (resolvedPath.length > 0) {
          return resolvedPath;
        } else {
          return ".";
        }
      },
      normalize: function normalize(path) {
        assertPath(path);
        if (path.length === 0) return ".";
        var isAbsolute2 = path.charCodeAt(0) === 47;
        var trailingSeparator = path.charCodeAt(path.length - 1) === 47;
        path = normalizeStringPosix(path, !isAbsolute2);
        if (path.length === 0 && !isAbsolute2) path = ".";
        if (path.length > 0 && trailingSeparator) path += "/";
        if (isAbsolute2) return "/" + path;
        return path;
      },
      isAbsolute: function isAbsolute2(path) {
        assertPath(path);
        return path.length > 0 && path.charCodeAt(0) === 47;
      },
      join: function join2() {
        if (arguments.length === 0)
          return ".";
        var joined;
        for (var i = 0; i < arguments.length; ++i) {
          var arg = arguments[i];
          assertPath(arg);
          if (arg.length > 0) {
            if (joined === void 0)
              joined = arg;
            else
              joined += "/" + arg;
          }
        }
        if (joined === void 0)
          return ".";
        return posix.normalize(joined);
      },
      relative: function relative(from, to) {
        assertPath(from);
        assertPath(to);
        if (from === to) return "";
        from = posix.resolve(from);
        to = posix.resolve(to);
        if (from === to) return "";
        var fromStart = 1;
        for (; fromStart < from.length; ++fromStart) {
          if (from.charCodeAt(fromStart) !== 47)
            break;
        }
        var fromEnd = from.length;
        var fromLen = fromEnd - fromStart;
        var toStart = 1;
        for (; toStart < to.length; ++toStart) {
          if (to.charCodeAt(toStart) !== 47)
            break;
        }
        var toEnd = to.length;
        var toLen = toEnd - toStart;
        var length = fromLen < toLen ? fromLen : toLen;
        var lastCommonSep = -1;
        var i = 0;
        for (; i <= length; ++i) {
          if (i === length) {
            if (toLen > length) {
              if (to.charCodeAt(toStart + i) === 47) {
                return to.slice(toStart + i + 1);
              } else if (i === 0) {
                return to.slice(toStart + i);
              }
            } else if (fromLen > length) {
              if (from.charCodeAt(fromStart + i) === 47) {
                lastCommonSep = i;
              } else if (i === 0) {
                lastCommonSep = 0;
              }
            }
            break;
          }
          var fromCode = from.charCodeAt(fromStart + i);
          var toCode = to.charCodeAt(toStart + i);
          if (fromCode !== toCode)
            break;
          else if (fromCode === 47)
            lastCommonSep = i;
        }
        var out = "";
        for (i = fromStart + lastCommonSep + 1; i <= fromEnd; ++i) {
          if (i === fromEnd || from.charCodeAt(i) === 47) {
            if (out.length === 0)
              out += "..";
            else
              out += "/..";
          }
        }
        if (out.length > 0)
          return out + to.slice(toStart + lastCommonSep);
        else {
          toStart += lastCommonSep;
          if (to.charCodeAt(toStart) === 47)
            ++toStart;
          return to.slice(toStart);
        }
      },
      _makeLong: function _makeLong(path) {
        return path;
      },
      dirname: function dirname(path) {
        assertPath(path);
        if (path.length === 0) return ".";
        var code = path.charCodeAt(0);
        var hasRoot = code === 47;
        var end = -1;
        var matchedSlash = true;
        for (var i = path.length - 1; i >= 1; --i) {
          code = path.charCodeAt(i);
          if (code === 47) {
            if (!matchedSlash) {
              end = i;
              break;
            }
          } else {
            matchedSlash = false;
          }
        }
        if (end === -1) return hasRoot ? "/" : ".";
        if (hasRoot && end === 1) return "//";
        return path.slice(0, end);
      },
      basename: function basename2(path, ext) {
        if (ext !== void 0 && typeof ext !== "string") throw new TypeError('"ext" argument must be a string');
        assertPath(path);
        var start = 0;
        var end = -1;
        var matchedSlash = true;
        var i;
        if (ext !== void 0 && ext.length > 0 && ext.length <= path.length) {
          if (ext.length === path.length && ext === path) return "";
          var extIdx = ext.length - 1;
          var firstNonSlashEnd = -1;
          for (i = path.length - 1; i >= 0; --i) {
            var code = path.charCodeAt(i);
            if (code === 47) {
              if (!matchedSlash) {
                start = i + 1;
                break;
              }
            } else {
              if (firstNonSlashEnd === -1) {
                matchedSlash = false;
                firstNonSlashEnd = i + 1;
              }
              if (extIdx >= 0) {
                if (code === ext.charCodeAt(extIdx)) {
                  if (--extIdx === -1) {
                    end = i;
                  }
                } else {
                  extIdx = -1;
                  end = firstNonSlashEnd;
                }
              }
            }
          }
          if (start === end) end = firstNonSlashEnd;
          else if (end === -1) end = path.length;
          return path.slice(start, end);
        } else {
          for (i = path.length - 1; i >= 0; --i) {
            if (path.charCodeAt(i) === 47) {
              if (!matchedSlash) {
                start = i + 1;
                break;
              }
            } else if (end === -1) {
              matchedSlash = false;
              end = i + 1;
            }
          }
          if (end === -1) return "";
          return path.slice(start, end);
        }
      },
      extname: function extname(path) {
        assertPath(path);
        var startDot = -1;
        var startPart = 0;
        var end = -1;
        var matchedSlash = true;
        var preDotState = 0;
        for (var i = path.length - 1; i >= 0; --i) {
          var code = path.charCodeAt(i);
          if (code === 47) {
            if (!matchedSlash) {
              startPart = i + 1;
              break;
            }
            continue;
          }
          if (end === -1) {
            matchedSlash = false;
            end = i + 1;
          }
          if (code === 46) {
            if (startDot === -1)
              startDot = i;
            else if (preDotState !== 1)
              preDotState = 1;
          } else if (startDot !== -1) {
            preDotState = -1;
          }
        }
        if (startDot === -1 || end === -1 || // We saw a non-dot character immediately before the dot
        preDotState === 0 || // The (right-most) trimmed path component is exactly '..'
        preDotState === 1 && startDot === end - 1 && startDot === startPart + 1) {
          return "";
        }
        return path.slice(startDot, end);
      },
      format: function format(pathObject) {
        if (pathObject === null || typeof pathObject !== "object") {
          throw new TypeError('The "pathObject" argument must be of type Object. Received type ' + typeof pathObject);
        }
        return _format("/", pathObject);
      },
      parse: function parse(path) {
        assertPath(path);
        var ret = { root: "", dir: "", base: "", ext: "", name: "" };
        if (path.length === 0) return ret;
        var code = path.charCodeAt(0);
        var isAbsolute2 = code === 47;
        var start;
        if (isAbsolute2) {
          ret.root = "/";
          start = 1;
        } else {
          start = 0;
        }
        var startDot = -1;
        var startPart = 0;
        var end = -1;
        var matchedSlash = true;
        var i = path.length - 1;
        var preDotState = 0;
        for (; i >= start; --i) {
          code = path.charCodeAt(i);
          if (code === 47) {
            if (!matchedSlash) {
              startPart = i + 1;
              break;
            }
            continue;
          }
          if (end === -1) {
            matchedSlash = false;
            end = i + 1;
          }
          if (code === 46) {
            if (startDot === -1) startDot = i;
            else if (preDotState !== 1) preDotState = 1;
          } else if (startDot !== -1) {
            preDotState = -1;
          }
        }
        if (startDot === -1 || end === -1 || // We saw a non-dot character immediately before the dot
        preDotState === 0 || // The (right-most) trimmed path component is exactly '..'
        preDotState === 1 && startDot === end - 1 && startDot === startPart + 1) {
          if (end !== -1) {
            if (startPart === 0 && isAbsolute2) ret.base = ret.name = path.slice(1, end);
            else ret.base = ret.name = path.slice(startPart, end);
          }
        } else {
          if (startPart === 0 && isAbsolute2) {
            ret.name = path.slice(1, startDot);
            ret.base = path.slice(1, end);
          } else {
            ret.name = path.slice(startPart, startDot);
            ret.base = path.slice(startPart, end);
          }
          ret.ext = path.slice(startDot, end);
        }
        if (startPart > 0) ret.dir = path.slice(0, startPart - 1);
        else if (isAbsolute2) ret.dir = "/";
        return ret;
      },
      sep: "/",
      delimiter: ":",
      win32: null,
      posix: null
    };
    posix.posix = posix;
    module2.exports = posix;
  }
});

// src/retrieval-diag.ts
function seedPassesGate(denseMax, threshold) {
  return denseMax >= threshold;
}
function retrievalTag(mode, seedFallback, reason, denseMax) {
  if (mode === "jaccard") return "jaccard";
  if (seedFallback === "llm") return "llm seeds";
  if (seedFallback === "jaccard") {
    return reason === "embed-failed" ? "jaccard (embed failed)" : `jaccard (low ${(denseMax ?? 0).toFixed(2)})`;
  }
  return "vector";
}

// src/wiki-graph.ts
var import_path_browserify = __toESM(require_path_browserify(), 1);

// src/wiki-path.ts
var WIKI_ROOT = "!Wiki";
var GLOBAL_CONFIG_DIR = `${WIKI_ROOT}/_config`;
var GLOBAL_DOMAIN_PATH = `${GLOBAL_CONFIG_DIR}/_domain.json`;
var GLOBAL_AGENT_LOG_PATH = `${GLOBAL_CONFIG_DIR}/_agent.jsonl`;
var GLOBAL_DEV_LOG_PATH = `${GLOBAL_CONFIG_DIR}/_dev.jsonl`;

// src/page-similarity.ts
function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}
function maxCosine(query, vecs) {
  let best = 0;
  for (const v of vecs) {
    if (v.length === 0) continue;
    const c = cosine(query, v);
    if (c > best) best = c;
  }
  return best;
}

// src/i18n.ts
var en = {
  settings: {
    h3_general: "General settings",
    h3_backend: "Backend settings",
    systemPrompt_name: "User prompt",
    systemPrompt_desc: "Appended to the system prompt of every operation. Empty by default.",
    outputLanguage_name: "Response language",
    outputLanguage_desc: "Language for all generated content. Auto = match the Obsidian UI language. Technical and domain terms are never translated.",
    reasoningLanguage_name: "Reasoning language",
    reasoningLanguage_desc: "Language the model reasons in. Default English (models reason best in English). Auto = follow the response language, then the Obsidian UI language. Best-effort \u2014 actual support depends on the model.",
    maxTokens_name: "Max tokens",
    maxTokens_desc: "Max tokens in the response. Default 4096. \u2191 longer answers, slower/costlier \xB7 \u2193 risk of truncation. Recommended \u2265 4096.",
    domains_heading: "Domains",
    editDomain: "Edit",
    deleteDomain: "Delete",
    confirmDeleteDomain: (id) => `Delete domain "${id}"?`,
    domainDeleted: (id) => `Domain \xAB${id}\xBB deleted`,
    busyBanner: "Operation in progress \u2014 domain editing is disabled.",
    domains_empty: "No domains. Use 'Add domain' in the sidebar panel to create one.",
    timeouts_name: "Timeouts (seconds)",
    timeouts_desc: "ingest / query / lint / init / format, sec (0 = no limit). Default 300/300/900/3600/600. \u2191 fewer aborts on big tasks \xB7 \u2193 catches hangs sooner.",
    historyLimit_name: "History limit",
    historyLimit_desc: "Max operations kept in the sidebar history. Default 20. \u2191 longer history, more memory \xB7 \u2193 leaner.",
    agentLog_name: "Agent log (JSONL)",
    agentLog_desc: "Log agent events to <vault>/!Wiki/_config/_agent.jsonl.",
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
    temperature_desc: "Sampling randomness, 0.0\u20132.0. Default 0.2. \u2191 more creative/varied \xB7 \u2193 more deterministic/precise. Recommended 0.1\u20130.3 for extraction.",
    topP_name: "Top-p",
    topP_desc: "0.0\u20131.0, or empty \u2014 disable.",
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
    opMaxTokens_desc: "Max tokens for this operation. Default 4096 (lint/init 8192, format 32768). \u2191 longer output, slower \xB7 \u2193 risk of truncation.",
    opTemperature_name: "Temperature",
    opTemperature_desc: "Temperature for this operation, 0.0\u20132.0. Default 0.2. \u2191 more varied \xB7 \u2193 more precise.",
    h3_devmode: "Developer",
    devMode_enabled_name: "Dev mode",
    devMode_enabled_desc: "Enable dev logger and evaluator after each operation.",
    devMode_evaluatorModel_name: "Evaluator model",
    devMode_evaluatorModel_desc: "Model name for the evaluator (same backend).",
    proxy_h3: "Proxy",
    proxy_enabled_name: "Use proxy",
    proxy_enabled_desc: "Route native-agent traffic through HTTP/HTTPS proxy.",
    proxy_url_name: "Proxy URL",
    proxy_url_desc: "http://proxy.example.com:8080 or https://...",
    proxy_username_name: "Username",
    proxy_username_desc: "Optional. For basic-auth proxies.",
    proxy_password_name: "Password",
    proxy_password_desc: "Optional. Stored locally in local.json.",
    proxy_noProxy_name: "No-proxy hosts",
    proxy_noProxy_desc: "CSV. Supports exact host and *.suffix. Example: localhost,127.0.0.1,*.internal",
    proxy_hint: "Proxy applies to native-agent only. claude-agent uses its own configuration. On mobile, proxy is currently not supported.",
    proxy_mobile_warning: "Proxy is not supported on mobile in this version.",
    proxy_invalid: (m) => `Proxy config invalid: ${m}`,
    h3_lint: "Lint",
    lintUseLlm_name: "Use LLM for lint",
    lintUseLlm_desc: "Uncheck to run programmatic-only lint (no LLM calls, much faster). Serves as default for the per-run modal toggle.",
    h3_graph: "Graph",
    h3_jaccard: "Jaccard",
    graphDepth_name: "BFS depth",
    graphDepth_desc: "Query: hops from seed pages. 0 = seeds only, max sensible 3. Default 1. \u2191 wider context, more pages/tokens \xB7 \u2193 tighter, faster.",
    bfsTopK_name: "BFS context top-K",
    bfsTopK_desc: "Max BFS-expanded pages ranked by similarity added to query context. 0 = all. Default 10. \u2191 more recall, more tokens \xB7 \u2193 tighter, cheaper.",
    wikiLinkValidationRetries_name: "WikiLink fix passes",
    wikiLinkValidationRetries_desc: "Max programmatic fix passes for WikiLink format errors. 0 = validate only. Default 3. \u2191 fixes more links, slower \xB7 \u2193 faster, leaves more errors.",
    seedTopK_name: "Seed top-K",
    seedTopK_desc: "Max seed pages selected by keyword score, 1\u201350. Default 5. \u2191 more entry points, broader & slower \xB7 \u2193 focused, faster.",
    seedMinScore_name: "Seed min score",
    seedMinScore_desc: "Min Jaccard score for a page to qualify as a seed, 0.0\u20131.0. Default 0.1. \u2191 stricter, fewer/cleaner seeds \xB7 \u2193 looser, more recall.",
    mergeDeleteWarnThreshold_name: "Merge delete warning threshold",
    mergeDeleteWarnThreshold_desc: "Ingest warns when the LLM requests deleting more pages than this in one merge. Default 5. \u2191 fewer warnings, risk of bulk loss \xB7 \u2193 flags merges earlier.",
    structuredRetries_name: "Structured output retries",
    structuredRetries_desc: "Retries on schema validation failure, 0\u20133. Default 1. \u2191 higher success on weaker models, more latency/tokens \xB7 \u2193 faster, more failures.",
    llmIdleTimeout_name: "LLM idle timeout (seconds)",
    llmIdleTimeout_desc: "Seconds of LLM silence before aborting the attempt. 0 = disabled. Default 300. \u2191 more patience for slow models \xB7 \u2193 catches stalls sooner.",
    llmIdleRetries_name: "LLM idle retries",
    llmIdleRetries_desc: "Max retry attempts after an idle abort. 0 = no retry. Default 3. \u2191 more resilient to transient stalls, slower \xB7 \u2193 fails fast.",
    effort_desc: "Claude reasoning level (--effort). Empty = no thinking. In per-op mode \u2014 global fallback.",
    effort_off: "Disabled",
    effort_inherit: "Inherit",
    thinkingBudget_desc: "Max tokens for model reasoning. 0 or empty = disabled. Example: 2048. \u2191 deeper reasoning, slower/costlier \xB7 \u2193 faster.",
    testConnection_name: "Test connection",
    testConnection_desc: "Sends a test prompt to the endpoint to check availability.",
    testConnection_btn: "Test",
    testConnection_btnBusy: "Testing\u2026",
    testConnection_ok: "\u2705 Model responds",
    claudeAvailable_ok: "\u2705 Claude available",
    semanticEnable_desc: "Use embedding vectors for relevant page selection. Requires native backend with an embeddings-capable model.",
    relevantTopK_desc: "Max wiki pages loaded per ingest/query call. Default 15. \u2191 more context, slower/costlier \xB7 \u2193 faster, leaner.",
    embeddingModel_desc: "Model name for embeddings, e.g. text-embedding-3-small",
    embeddingDimensions_desc: "Vector dimensions, e.g. 512 or 1536",
    chunkSize_desc: (d) => `Max characters per section window. Default ${d}. \u2191 fewer, larger chunks (more context each) \xB7 \u2193 finer chunks, better recall.`,
    chunkOverlap_desc: (d) => `Overlap between consecutive windows of a long section. Default ${d}. \u2191 less context lost at edges, more vectors \xB7 \u2193 leaner.`,
    chunkMin_desc: (d) => `Sections shorter than this merge into a neighbour. Default ${d}. \u2191 fewer tiny chunks \xB7 \u2193 keeps small sections separate.`,
    chunkMaxCount_desc: (d) => `Cap on vectors per page (summary + sections). Default ${d}. \u2191 better section recall, more embedding cost \xB7 \u2193 cheaper, coarser.`,
    hybridRetrieval_desc: "Fuse embedding and Jaccard via RRF. Requires an embedding model; without one \u2014 plain Jaccard.",
    rrfK_desc: "RRF smoothing constant. Default 60. \u2191 flatter rank contribution (softer top) \xB7 \u2193 stronger weight on top results. Rarely change.",
    bfsFusion_desc: "Order query context via RRF fusion of vector and graph. Off by default.",
    seedSimilarityThreshold_desc: "Min max-score for a seed; below it \u2014 fallback to Jaccard \u2192 llmSelectSeeds. Example: 0.3 \xB7 0 = off, 1 = exact match. \u2191 stricter (fewer seeds, more precise) \xB7 \u2193 wider coverage. Recommended 0.25\u20130.4.",
    dedupOnIngest_desc: "On creating a near-duplicate page \u2014 merge into the existing one via LLM-merge.",
    dedupThreshold_desc: "Cosine threshold for dedup on ingest (0..1). Default 0.85. \u2191 merges only near-duplicates (safer) \xB7 \u2193 more aggressive, risk of false merges. Recommended 0.83\u20130.90.",
    lintNearDuplicate_desc: "In Lint, report pairs of close pages by embedding cosine.",
    nearDupThreshold_desc: "Cosine threshold for the near-duplicate report in Lint (0..1). Default 0.80. \u2191 fewer pairs, only clear duplicates \xB7 \u2193 more pairs, noisier. Recommended 0.78\u20130.85."
  },
  view: {
    refreshTitle: "Refresh domains",
    mobileWaiting: "\u23F3 Waiting for LLM response\u2026",
    analysing: "Analysing\u2026",
    formingResponse: "Forming response\u2026",
    ingestingFiles: "Ingesting files\u2026",
    analysingFiles: "Analysing files\u2026",
    reinitTitle: "Re-init domain (wipe + rebuild)",
    reinitNoSources: "Domain has no source_paths \u2014 re-init not possible",
    addSourceTitle: "Manage sources for domain",
    addDomain: "Add domain",
    sectionCreate: "Create",
    sectionDomain: "Fill / Maintain",
    sectionDomainMobile: "Domain",
    sectionQuery: "Query",
    ingest: "Ingest",
    lint: "Lint",
    format: "Format",
    formatOnlyMarkdown: "Format only works on markdown files",
    formatInWikiTitle: "Action forbidden",
    formatInWikiBody: (id) => `This file is a wiki article (domain \xAB${id}\xBB). Formatting wiki articles is not available.`,
    formatInWikiClose: "Close",
    formatNoPending: "No format preview available",
    formatApplied: (path) => `Formatted: ${path}`,
    formatCancelled: "Format cancelled",
    formatPreviewHeader: "Format preview",
    formatApply: "Apply",
    formatApplyReplace: "Apply (delete old)",
    formatApplyKeep: "Apply (keep old as .deprecated)",
    formatCancelBtn: "Discard",
    formatRefinePlaceholder: "Refine the formatting (Enter to send)\u2026",
    formatMissingTokens: (n) => `\u26A0 ${n} significant token(s) missing in formatted text`,
    fixPlaceholder: "Describe the task for the model (Enter to send, Shift+Enter for newline)\u2026",
    fixSend: "Send",
    chatLabel: "Chat",
    chatSend: "Send",
    init: "Init",
    ask: "Ask",
    cancel: "Cancel",
    result: "Result",
    history: "History",
    allDomains: "(all)",
    noHistory: "No history yet.",
    answerRequired: "AI Wiki \u2014 answer required",
    noActiveFile: "No active file",
    selectDomainForInit: "Select a specific domain for init",
    cwdNotSet: "Working directory is not set",
    enterQuestion: "Enter a question",
    operationInProgress: "Operation already in progress",
    stepsCount: (n, s) => `${n} steps \xB7 ${s}s`,
    starting: "Starting",
    initialising: "Initialising",
    selectDomainFirst: "Select a domain first"
  },
  formatProgress: {
    analysing: (path) => `Analysing file ${path}...
`,
    truncatedSalvageSummary: "Format: response truncated \u2014 salvage",
    truncatedSalvageRetrySummary: "Format: retry response truncated \u2014 salvage",
    truncatedSalvageDetail: "Marker <<<END>>> missing; partial output used.",
    outputTruncated: (hint) => `Format: response truncated by the model output limit \u2014 shorten the page or ${hint}`,
    outputTruncatedAfterRetry: (hint) => `Format: response truncated by the model output limit (after retry) \u2014 shorten the page or ${hint}`,
    sentinelInvalidRetry: "\n[Sentinel invalid \u2014 retrying]\n",
    sentinelInvalidAfterRetry: "Format: LLM returned an invalid sentinel (after retry)",
    writeFailed: (err) => `Format: writing the formatted file failed \u2014 ${err}`,
    truncationHintEnv: "raise the limit: env CLAUDE_CODE_MAX_OUTPUT_TOKENS in iclaude.sh",
    truncationHintSettings: "raise the limit: Settings \u2192 per-operation \u2192 format \u2192 maxTokens"
  },
  ingestProgress: {
    synthesizing: (domainId) => `Synthesizing wiki pages for domain "${domainId}"...
`
  },
  lintProgress: {
    evaluating: (domainId) => `Evaluating domain "${domainId}" quality...
`,
    actualizing: (domainId) => `
Actualizing domain config for "${domainId}"...
`
  },
  initProgress: {
    reinitWiping: (folder) => `Re-init: wiping ${folder}...
`,
    removedFiles: (n) => `removed ${n} files
`,
    fileChars: (file, n) => `\u2139 ${file}: ${n} chars
`
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
    lint_title: "Lint Wiki",
    lintSelectAll: "\u0414\u043E\u0431\u0430\u0432\u0438\u0442\u044C \u0432\u0441\u0435",
    lintDeselectAll: "\u0423\u0431\u0440\u0430\u0442\u044C \u0432\u0441\u0435",
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
    reinitConfirmTitle: "Re-init \u2014 confirm",
    reinitConfirmBody: (id, wikiFiles, srcFiles, srcCount) => `Domain \xAB${id}\xBB: ${wikiFiles} wiki files will be deleted and rebuilt from ${srcFiles} md-files (${srcCount} source paths). Continue?`,
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
    busyCloseLeave: "Leave in background",
    shellConsentTitle: "\u26A0 Shell Execution Notice",
    shellConsentBody: (iclaudePath) => `This plugin runs an external process:
  ${iclaudePath}
with your operating system user's permissions. This is required for AI Wiki to function. Review the path above, then confirm to enable.

Security note: this backend runs an autonomous agent without per-action permission prompts. Content of the notes you process is fed to the agent as input \u2014 a malicious or untrusted note could attempt to make the agent run unintended commands (prompt injection). Only process notes you trust.`,
    shellConsentEnable: "I understand, enable",
    manageSourcesTitle: (id) => `Sources: \xAB${id}\xBB`,
    ingestScopeTitle: "Sources saved \u2014 run ingest?",
    ingestScopeBody: (added, total) => `Added ${added} new path(s). Ingest new only or all ${total} path(s)?`,
    ingestScopeNew: (n) => `New only (${n})`,
    ingestScopeAll: (n) => `All (${n})`,
    ingestScopeSkip: "Skip",
    formatVisionTitle: "Format with vision?",
    formatVisionBody: "Vision recognition is enabled. Analyze attachments before formatting?",
    formatVisionWith: "With vision",
    formatVisionWithout: "Without vision"
  }
};
var _formatProgressShapeCheck = en.formatProgress;

// src/phases/attachment-analyzer.ts
function getMimeType(path) {
  const ext = path.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    default:
      return null;
  }
}
function isVisionSupportedOnMobile(path) {
  return getMimeType(path) !== null;
}

// src/source-paths.ts
var import_path_browserify2 = __toESM(require_path_browserify(), 1);
function isSelectableSourceFolder(path) {
  return path !== WIKI_ROOT && !path.startsWith(`${WIKI_ROOT}/`);
}

// eval/mobile-fixes/run.ts
var pass = 0;
var fail = 0;
var failures = [];
function check(name, cond, detail = "") {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    failures.push(name);
    console.log(`  FAIL  ${name}${detail ? `
        \u2192 ${detail}` : ""}`);
  }
}
function section(t) {
  console.log(`
=== ${t} ===`);
}
section("seedPassesGate \u2014 gate on dense cosine, not RRF");
check("strong cosine passes", seedPassesGate(0.62, 0.3) === true);
check("RRF-scale score fails (the bug)", seedPassesGate(0.033, 0.3) === false);
check("embed-failed (0) fails", seedPassesGate(0, 0.3) === false);
check("threshold 0 always passes", seedPassesGate(0, 0) === true);
section("retrievalTag");
check("hybrid vector used", retrievalTag("hybrid", "none", void 0, 0.62) === "vector");
check("hybrid low-similarity", retrievalTag("hybrid", "jaccard", "low-similarity", 0.21) === "jaccard (low 0.21)");
check("hybrid embed-failed", retrievalTag("hybrid", "jaccard", "embed-failed", 0) === "jaccard (embed failed)");
check("pure jaccard mode", retrievalTag("jaccard", "none", void 0, 0) === "jaccard");
check("llm fallback", retrievalTag("embedding", "llm", void 0, 0.1) === "llm seeds");
section("maxCosine \u2192 denseMax feeds the gate");
var f = (xs) => Float32Array.from(xs);
check("identical vectors cosine 1", Math.abs(maxCosine(f([1, 0, 0]), [f([1, 0, 0])]) - 1) < 1e-6);
check("orthogonal vectors cosine 0", Math.abs(maxCosine(f([1, 0, 0]), [f([0, 1, 0])])) < 1e-6);
{
  const dense = maxCosine(f([1, 1, 0]), [f([0, 1, 0]), f([1, 1, 0])]);
  check("max-pool picks best chunk", Math.abs(dense - 1) < 1e-6);
  check("strong denseMax passes gate", seedPassesGate(dense, 0.3) === true);
}
check("orthogonal denseMax fails gate", seedPassesGate(maxCosine(f([1, 0]), [f([0, 1])]), 0.3) === false);
section("isVisionSupportedOnMobile");
check("png supported", isVisionSupportedOnMobile("img/a.png") === true);
check("jpg supported", isVisionSupportedOnMobile("img/a.JPG") === true);
check("webp supported", isVisionSupportedOnMobile("img/a.webp") === true);
check("pdf not supported", isVisionSupportedOnMobile("doc/a.pdf") === false);
check("excalidraw not supported", isVisionSupportedOnMobile("d/a.excalidraw") === false);
section("isSelectableSourceFolder \u2014 exclude !Wiki output");
check("ordinary folder selectable", isSelectableSourceFolder("\u041F\u0440\u043E\u0435\u043A\u0442\u044B/Bagato") === true);
check("!Wiki root excluded", isSelectableSourceFolder("!Wiki") === false);
check("!Wiki subtree excluded", isSelectableSourceFolder("!Wiki/sar/dags") === false);
check("lookalike not excluded", isSelectableSourceFolder("!WikiNotes/x") === true);
console.log(`
${fail === 0 ? "ALL PASS" : "FAILURES"}: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log(failures.join("\n"));
  process.exit(1);
}
