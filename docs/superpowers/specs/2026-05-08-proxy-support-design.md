# Proxy support for native-agent backend

**Date:** 2026-05-08
**Status:** Design

## Problem

Plugin's `native-agent` backend talks to OpenAI-compatible HTTP endpoints (Ollama, OpenAI, Anthropic-compatible proxies). In corporate networks the plugin must route this traffic through HTTP/HTTPS proxy with optional basic-auth credentials. No proxy support exists today.

`claude-agent` backend spawns `iclaude.sh` as a child process; the plugin's Node-level HTTP agents cannot intercept its traffic. Proxying for that backend is out of scope.

## Goals

- Add a Proxy section to plugin settings (visible only when backend is `native-agent`).
- Single toggle controls usage; URL + optional `username`/`password` + optional `noProxy` list.
- Apply to native-agent OpenAI client on desktop via custom `fetch` обёртку поверх `undici.fetch` + `undici.ProxyAgent` (Chromium-fetch в Electron renderer не принимает Node-агенты — поэтому нужен Node-fetch).
- Mobile: show warning, do not attempt proxying (Obsidian `requestUrl` lacks proxy support).
- Credentials live in `local.json` (per-machine, not synced).

## Non-goals

- Proxy support for `claude-agent` (separate concern; iclaude has its own configuration).
- Proxy on mobile (deferred).
- SOCKS proxy.
- PAC files / per-host proxy selection beyond `noProxy` bypass.

## Storage

Extend `LocalConfig` (`src/local-config.ts`):

```ts
export interface ProxyConfig {
  enabled: boolean;
  url: string;          // "http://host:port" or "https://host:port"
  username?: string;
  password?: string;
  noProxy?: string;     // CSV: "localhost,127.0.0.1,*.internal"
}

export interface LocalConfig {
  // ...existing...
  proxy?: ProxyConfig;
}
```

`local.json` is excluded from Obsidian Sync and tracked in `.gitignore` (same treatment as `apiKey`). No schema migration needed — missing `proxy` means disabled.

## UI (`src/settings.ts`)

New section "Proxy" rendered after the Backend section, only when `eff.backend === "native-agent"`:

- `Setting`: toggle `enabled` — `proxy.enabled`
- `Setting`: text `url` — placeholder `http://proxy.example.com:8080`
- `Setting`: text `username`
- `Setting`: text input with `type="password"` for `password`
- `Setting`: text `noProxy` — placeholder `localhost,127.0.0.1`
- Hint paragraph: "Proxy applies to native-agent only. claude-agent uses its own configuration. On mobile, proxy is currently not supported."

When `enabled === false`, URL/credentials/noProxy fields are visually disabled (greyed out) but values are preserved in `local.json` for re-enabling.

i18n strings added to `src/i18n.ts` under `settings.*`.

## Module: `src/proxy.ts`

```ts
export interface ResolvedProxy {
  url: string;          // full URL with embedded creds, ready for HttpsProxyAgent
  noProxyList: string[];
}

export function buildProxyUrl(cfg: ProxyConfig): string;
export function parseNoProxy(csv: string | undefined): string[];
export function shouldBypass(host: string, noProxyList: string[]): boolean;
export function createProxyDispatcher(cfg: ProxyConfig): import("undici").Dispatcher | null;
export function createProxyFetch(cfg: ProxyConfig): typeof fetch | null;
export function maskProxyUrl(url: string): string;  // for logs/Notices
```

Behavior:

- `buildProxyUrl`: parse `cfg.url` via `URL`, set `username`/`password` after `encodeURIComponent` on each, return `URL.toString()`. Throws on malformed URL.
- `parseNoProxy`: split on `,`, trim, drop empties.
- `shouldBypass(host, list)`: returns true if any entry matches host. Match rules:
  - exact case-insensitive equality
  - leading `*.` → suffix match (e.g. `*.internal` matches `api.internal`)
  - IP literal exact match
- `createProxyDispatcher`: `require("undici")`, return `new ProxyAgent(buildProxyUrl(cfg))`. Returns `null` when `cfg.enabled === false` or `Platform.isMobile`.
- `createProxyFetch`: создаёт обёртку над `undici.fetch` с фиксированным `dispatcher`. Подпись совместима с `typeof fetch`. Возвращает `null` если dispatcher не создан.
- `maskProxyUrl`: replaces `user:pass@` with `user:****@`.

## Integration: `src/controller.ts` — `buildAgentRunner`

In the `native-agent` branch:

```ts
const proxyCfg = s.proxy;
let proxyFetch: typeof fetch | null = null;
if (proxyCfg.enabled && Platform.isMobile) {
  new Notice(i18n().settings.proxy_mobile_warning);
} else if (proxyCfg.enabled) {
  try {
    const baseHost = new URL(s.nativeAgent.baseUrl).hostname;
    const noProxyList = parseNoProxy(proxyCfg.noProxy);
    if (!shouldBypass(baseHost, noProxyList)) {
      proxyFetch = createProxyFetch(proxyCfg);
      if (proxyFetch) console.info(`[llm-wiki] using proxy ${maskProxyUrl(proxyCfg.url)}`);
    }
  } catch (e) {
    new Notice(i18n().settings.proxy_invalid((e as Error).message));
  }
}

llm = new OpenAI({
  baseURL: s.nativeAgent.baseUrl,
  apiKey: s.nativeAgent.apiKey,
  timeout: maxTimeoutSec * 1000,
  dangerouslyAllowBrowser: true,
  fetch: Platform.isMobile ? mobileFetch : (proxyFetch ?? undefined),
});
```

Note: when `noProxy` matches `baseURL` host, `proxyFetch` остаётся `null` → SDK использует дефолтный (Chromium) fetch.

## Effective settings (`src/effective-settings.ts`)

Add `proxy` to the resolved object so consumers (controller, settings UI) read a single source:

```ts
return {
  // ...existing...
  proxy: local.proxy ?? { enabled: false, url: "" },
};
```

## Dependencies

Add `undici` to `dependencies` in `package.json`. Bundle via esbuild (`platform: "node"`, undici работает только в Node-окружении). Размер бандла +~700KB; alternatives рассмотрены и отброшены: `https-proxy-agent` не интегрируется с openai SDK v6 (нет поля `httpAgent`), а Chromium-fetch в Electron renderer не принимает Node-агенты.

## Security

- `password` stored plain in `local.json`, same treatment as existing `nativeAgent.apiKey`. Never written to `data.json` (which is synced).
- Logs: `agent.jsonl` (controller) and `dev.jsonl` (agent-runner) must not contain proxy credentials. Existing log code does not log network internals — verify no incidental leak.
- Notices/error messages that mention proxy URL must use `maskProxyUrl`.
- Adding entry to `.gitignore` is unnecessary — `local.json` already gitignored.

## Testing

- `tests/proxy.test.ts`:
  - `buildProxyUrl` — URL-encodes `@`, `:`, `/`, spaces in password
  - `buildProxyUrl` — throws on malformed URL
  - `parseNoProxy` — handles whitespace, empty entries
  - `shouldBypass` — exact, suffix glob, IP, case-insensitive
  - `maskProxyUrl` — masks password, leaves user/host intact
  - `createProxyDispatcher` — returns null on mobile / when disabled
  - `createProxyFetch` — возвращает функцию-обёртку, делегирующую `undici.fetch` с заданным dispatcher (smoke-mock на uniciFetch)

- `tests/settings.test.ts` (extend): `resolveEffective` returns `proxy` from local.

- Manual smoke: desktop, native-agent + Ollama through Squid proxy with basic auth — verify request reaches origin via proxy access log.

## Out of scope / follow-ups

- Mobile proxy via `undici.ProxyAgent` — investigate in a separate task; depends on Obsidian mobile runtime capabilities.
- Proxy for `claude-agent` — would require either modifying `iclaude.sh` invocation or relying on iclaude's own proxy config (it reserves `-p`/`--proxy` for that purpose).
- SOCKS proxy support.
- Per-backend proxy override (e.g., distinct proxies for native vs evaluator).
