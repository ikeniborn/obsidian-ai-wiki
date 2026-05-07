# Mobile setup — cloud LLM (Obsidian Mobile, iOS/Android)

LLM Wiki on mobile supports `query` and `query-save` commands only. Other operations (`ingest`, `lint`, `init`, `fix`, `chat`) require Obsidian Desktop.

This guide shows how to point the plugin at a cloud-hosted LLM via the OpenAI-compatible HTTP API.

## Quick start

1. Install the plugin on mobile (via Obsidian Sync or BRAT — `manifest.json` now allows mobile).
2. Open **Settings → LLM Wiki**.
3. Backend is forced to `native-agent` on mobile (no toggle shown).
4. Fill in three fields:
   - **Base URL** — provider's OpenAI-compatible endpoint
   - **API key** — provider key (or any non-empty string for self-hosted Ollama)
   - **Model** — model name as expected by the provider
5. Pick a domain in the right-side panel.
6. Run command **LLM Wiki: Query**, type a question.

## Provider examples

### OpenRouter

| Field | Value |
|---|---|
| Base URL | `https://openrouter.ai/api/v1` |
| API key | `sk-or-...` (from openrouter.ai → Keys) |
| Model | `anthropic/claude-3.5-sonnet` (or any OpenRouter model) |

### Ollama Cloud

| Field | Value |
|---|---|
| Base URL | `https://ollama.com/v1` |
| API key | Your Ollama Cloud API key |
| Model | `llama3.2` (or any pulled model) |

### together.ai

| Field | Value |
|---|---|
| Base URL | `https://api.together.xyz/v1` |
| API key | `...` (from api.together.ai) |
| Model | e.g. `meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo` |

### Self-hosted Ollama via Tailscale

Run Ollama on a desktop / home server. Reach it from the phone via Tailscale.

| Field | Value |
|---|---|
| Base URL | `https://<your-tailnet-name>.ts.net:11434/v1` |
| API key | `ollama` (any non-empty value) |
| Model | `llama3.2` (or whichever you have pulled) |

Required server-side env var so Ollama accepts requests from a mobile WebView origin:

```
OLLAMA_ORIGINS=*
OLLAMA_HOST=0.0.0.0
```

Trust the Tailscale-issued certificate on the phone (Settings → Tailscale → MagicDNS).

## API key security

- Keys are stored in plain JSON in Obsidian's `data.json` for this plugin.
- If you sync via Obsidian Sync, the key is end-to-end encrypted in transit but readable on every synced device.
- Use provider-scoped keys with low rate limits and the cheapest model tier you tolerate.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `401` / `403` | Wrong key, expired key | Regenerate key, paste again |
| `CORS` error in console | Self-hosted Ollama without `OLLAMA_ORIGINS=*` | Set env var, restart |
| `timeout` | Slow model / network | Increase **Settings → LLM Wiki → Timeouts** value for `query` |
| `No domain configured` | Domain map empty | Create a domain on Desktop first; sync the vault |
| Empty answer | Wiki folder missing or empty | Verify `!Wiki/<domain>` exists in vault |

## Limits

- Context truncated at 80 000 characters of wiki content.
- New domain creation, ingest, lint require Obsidian Desktop.
- Logging (agent.jsonl, dev.jsonl) is disabled on mobile (no fs access).
