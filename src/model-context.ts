import type { ContextWindowSource, RunEvent } from "./types";

export const BACKEND_DEFAULT_CONTEXT = 8_192;
export const PROBE_DEADLINE_MS = 2_000;
export const DEFAULT_TTL_MS = 86_400_000;

/**
 * The smallest window this plugin will budget from — exported so the settings field
 * can refuse what the engine would refuse, instead of storing and displaying a number
 * nothing uses.
 */
export const MIN_CONTEXT_WINDOW = 1_024;
const MIN_PLAUSIBLE_CONTEXT = MIN_CONTEXT_WINDOW;
const MAX_PLAUSIBLE_CONTEXT = 2_000_000;
const CALIBRATION_WINDOW = 8;
const CALIBRATION_MIN = 0.5;
const CALIBRATION_MAX = 3;

export interface ModelContextRecord {
  contextWindow: number;
  source: ContextWindowSource;
  calibration: number;
  samples: number;
  expiresAt?: number;
}

export type ModelContextMap = Record<string, ModelContextRecord>;

/** One diagnostic per endpoint the probe attempts. */
export type ContextProbeEvent = Extract<RunEvent, { kind: "context_probe" }>;

/** What `observeUsage` actually did with a sample, so the caller can report it. */
export interface CalibrationOutcome {
  ratio: number;
  applied: boolean;
  clamped: boolean;
}

/**
 * What `observeContextError` did with a provider rejection. Returned rather than
 * swallowed so the caller can put the `configured` case — the one where the provider
 * contradicts an explicit user instruction — into the run log.
 */
export type ContextErrorOutcome =
  | { applied: false; reason: "unknown-model" | "no-reported-window" | "not-smaller" }
  | { applied: false; reason: "configured"; contextWindow: number; reportedWindow: number }
  | { applied: true; reason: "learned"; contextWindow: number; reportedWindow: number };

export interface ModelContextStoreDeps {
  read: () => Promise<ModelContextMap>;
  write: (next: ModelContextMap) => Promise<void>;
  fetchFn: typeof fetch;
}

function cacheKey(baseUrl: string, model: string): string {
  return `${baseUrl}::${model}`;
}

function plausible(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) return null;
  if (value < MIN_PLAUSIBLE_CONTEXT || value > MAX_PLAUSIBLE_CONTEXT) return null;
  return value;
}

/** First plausible integer under any key whose name reports a context length. */
function findContextLength(value: unknown): number | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findContextLength(item);
      if (found !== null) return found;
    }
    return null;
  }
  if (value === null || typeof value !== "object") return null;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (key.endsWith("context_length") || key === "max_context_length" || key === "n_ctx") {
      const direct = plausible(item);
      if (direct !== null) return direct;
    }
    const nested = findContextLength(item);
    if (nested !== null) return nested;
  }
  return null;
}

/**
 * Picks the `/models`-response entry whose `id` equals the requested model.
 * A context length belonging to a different model would be confidently wrong and
 * would produce real overflows, so an unscoped payload (no `data` array, or no
 * matching entry) yields `undefined` rather than falling back to an unscoped scan —
 * the caller falls through to `/api/show`, which is legitimately unscoped because it
 * is queried FOR the model by name.
 */
function modelEntry(payload: unknown, model: string): { entry: unknown } | null {
  if (payload === null || typeof payload !== "object") return null;
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data)) return null;
  const found = (data as unknown[]).find((item) =>
    item !== null && typeof item === "object" && (item as { id?: unknown }).id === model);
  return found === undefined ? null : { entry: found };
}

async function getJson(
  fetchFn: typeof fetch,
  url: string,
  apiKey: string,
  deadline: number,
  now: () => number,
  signal: AbortSignal | undefined,
  body?: unknown,
): Promise<unknown> {
  const remaining = deadline - now();
  if (remaining <= 0) return null;
  const controller = new AbortController();
  const onAbort = (): void => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  const timer = window.setTimeout(() => controller.abort(), remaining);
  try {
    const response = await fetchFn(url, {
      method: body === undefined ? "GET" : "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

/** Best-effort. Returns null when nothing reports a plausible window for this model. */
export async function probeContextWindow(
  fetchFn: typeof fetch,
  baseUrl: string,
  apiKey: string,
  model: string,
  deadlineMs: number = PROBE_DEADLINE_MS,
  signal?: AbortSignal,
  onProbe?: (event: ContextProbeEvent) => void,
): Promise<number | null> {
  const started = Date.now();
  const now = (): number => Date.now() - started;
  const deadline = deadlineMs;
  const root = baseUrl.replace(/\/+$/, "");
  const report = (
    endpoint: string,
    ok: boolean,
    startedAt: number,
    matchedById: boolean | undefined,
    contextLength: number | null,
  ): void => {
    onProbe?.({
      kind: "context_probe",
      baseUrl,
      model,
      endpoint,
      ok,
      ms: now() - startedAt,
      ...(matchedById === undefined ? {} : { matchedById }),
      ...(contextLength === null ? {} : { contextLength }),
    });
  };

  const modelsUrl = `${root}/models`;
  const modelsStartedAt = now();
  const models = await getJson(fetchFn, modelsUrl, apiKey, deadline, now, signal);
  // Two independent facts, reported separately: whether the listing contained this
  // model at all, and whether that entry advertised a window. Conflating them (the
  // pre-fix behavior) made an aggregating gateway that lists the model without any
  // context-length field look identical to one that has never heard of it.
  //
  // A listing that could not be read at all is a third case and carries no verdict:
  // reporting `false` there would claim the backend has never heard of the model
  // when the request simply failed. Omit the field, the way `/api/show` does.
  const matched = models === null ? null : modelEntry(models, model);
  const fromModels = matched === null ? null : findContextLength(matched.entry);
  report(modelsUrl, models !== null, modelsStartedAt, models === null ? undefined : matched !== null, fromModels);
  if (fromModels !== null) return fromModels;

  const ollamaRoot = root.replace(/\/v1$/, "");
  const showUrl = `${ollamaRoot}/api/show`;
  const showStartedAt = now();
  const show = await getJson(fetchFn, showUrl, apiKey, deadline, now, signal, { model });
  const fromShow = show === null ? null : findContextLength(show);
  // `/api/show` is queried FOR one model by name, so "matched by id" has no meaning
  // here; reporting `false` would read as "no such model".
  report(showUrl, show !== null, showStartedAt, undefined, fromShow);
  return fromShow;
}

/**
 * The record a user-supplied window produces. Shared by `ModelContextStore.resolve`
 * and the settings tab, so the numbers the settings page shows for a window the user
 * just typed are the same ones the next run will budget from.
 *
 * `calibration`/`samples` carry over from any previous record: they measure the token
 * ESTIMATOR against the provider, not the window, so a new window does not invalidate
 * them.
 */
export function configuredContextRecord(
  contextWindow: number,
  previous?: ModelContextRecord,
): ModelContextRecord {
  return {
    contextWindow,
    source: "configured",
    calibration: previous?.calibration ?? 1,
    samples: previous?.samples ?? 0,
  };
}

/** A configured window is honoured only when it is a plausible one; see `plausible`. */
export function plausibleContextWindow(value: unknown): number | null {
  return plausible(value);
}

/**
 * The window the settings tab may show as this model's own, or null when nothing
 * about the model is actually known and the field must read "Automatic".
 *
 * A `default` record is the 8192-token fallback `resolve` writes when the backend
 * advertised no window and nobody typed one. It is not a measurement of the model:
 * `resolveVisionBudget` refuses to size the vision model from it, so a Vision field
 * showing 8192 would advertise the one number the engine will not use and tell the
 * user the missing window is already handled.
 *
 * A `default` record is also the only one that carries `expiresAt` (see
 * `DEFAULT_TTL_MS`; `observeContextError` deletes it when the record becomes
 * `learned`), so an expired record needs no case of its own here.
 */
export function placeholderContextWindow(record: ModelContextRecord): number | null {
  return record.source === "default" ? null : record.contextWindow;
}

export class ModelContextStore {
  private cache: ModelContextMap | null = null;
  private inFlight = new Map<string, Promise<ModelContextRecord>>();

  constructor(private deps: ModelContextStoreDeps) {}

  get(baseUrl: string, model: string): ModelContextRecord | undefined {
    return this.cache?.[cacheKey(baseUrl, model)];
  }

  /**
   * `configuredWindow` is the user's own setting. When it is plausible, it replaces
   * the discovered window outright: no probe runs, and the record is cached so the
   * settings tab and the next run read the same number.
   */
  async resolve(
    baseUrl: string,
    model: string,
    apiKey: string,
    now: number,
    signal?: AbortSignal,
    onProbe?: (event: ContextProbeEvent) => void,
    configuredWindow?: number,
  ): Promise<ModelContextRecord> {
    signal?.throwIfAborted();
    if (this.cache === null) this.cache = await this.deps.read();
    const key = cacheKey(baseUrl, model);
    const configured = plausible(configuredWindow);

    const cached = this.cache[key];
    if (configured !== null) {
      if (cached?.source === "configured" && cached.contextWindow === configured) return cached;
      const record = configuredContextRecord(configured, cached);
      this.cache[key] = record;
      // Best-effort, like every other write here: the record is already live in
      // memory, so a failed write costs nothing but a re-read next session.
      try {
        await this.deps.write(this.cache);
      } catch { /* the in-memory record stands */ }
      return record;
    }
    // A record this store wrote from a since-cleared setting must not pin the window
    // forever: clearing the setting returns the pair to probing.
    if (
      cached && cached.source !== "configured"
      && (cached.expiresAt === undefined || cached.expiresAt > now)
    ) return cached;

    const pending = this.inFlight.get(key);
    if (pending) return pending;

    const task = (async (): Promise<ModelContextRecord> => {
      const probed = await probeContextWindow(
        this.deps.fetchFn, baseUrl, apiKey, model, PROBE_DEADLINE_MS, signal, onProbe,
      );
      signal?.throwIfAborted();
      const record: ModelContextRecord = probed === null
        ? {
            contextWindow: BACKEND_DEFAULT_CONTEXT,
            source: "default",
            calibration: cached?.calibration ?? 1,
            samples: cached?.samples ?? 0,
            expiresAt: now + DEFAULT_TTL_MS,
          }
        : {
            contextWindow: probed,
            source: "discovered",
            calibration: cached?.calibration ?? 1,
            samples: cached?.samples ?? 0,
          };
      this.cache![key] = record;
      // Best-effort, like observeUsage and observeContextError: the record is
      // already live in memory, so a failed cache write costs one probe on the
      // next session. It must never fail the run that asked for the record.
      try {
        await this.deps.write(this.cache!);
      } catch { /* the in-memory record stands */ }
      return record;
    })().finally(() => this.inFlight.delete(key));

    this.inFlight.set(key, task);
    return task;
  }

  /**
   * `appliedCalibration` is the factor the reported `estimated` was produced with —
   * NOT whatever the record holds now. The two differ because
   * `LlmCallOptions.tokenCalibration` is resolved once per run: every sample of a run
   * is measured through the factor the record held when that run started, while the
   * record moves with each sample.
   */
  observeUsage(
    baseUrl: string,
    model: string,
    estimated: number,
    actual: number,
    appliedCalibration: number,
  ): CalibrationOutcome {
    const record = this.get(baseUrl, model);
    const ratio = estimated > 0 ? actual / estimated : 0;
    if (!record || estimated <= 0 || actual <= 0) return { ratio, applied: false, clamped: false };
    // The plausibility band belongs to the IMPLIED factor, not to the raw ratio.
    // `ratio` is measured through `appliedCalibration`, so a record parked near a
    // clamp produces a raw ratio near the reciprocal of that clamp: with a stored
    // factor of 3 and a true factor of 1, every corrective sample has a raw ratio
    // of 1/3 and a raw gate discards all of them — the record never recovers.
    // `target` is what the update aims at, so it is what has to be plausible.
    const target = appliedCalibration * ratio;
    if (target < CALIBRATION_MIN || target > CALIBRATION_MAX) {
      return { ratio, applied: false, clamped: true };
    }
    // MULTIPLICATIVE. `ratio` is measured THROUGH `appliedCalibration`, so
    // averaging it into the factor converges on sqrt(truth): a real factor of 2
    // settles at 1.414, a permanent 29% underestimate. Multiply, then smooth.
    //
    // The multiplication is against the factor that produced this estimate, not
    // against `record.calibration`. When the estimate carries a stale factor —
    // which is the normal case after the first sample of a run — multiplying by
    // the already-corrected record folds the same bias in a second time, and the
    // factor compounds away from the truth instead of converging on it
    // (a +10% raw bias landed on +25% over eight samples in one observed run).
    const weight = Math.min(record.samples, CALIBRATION_WINDOW - 1);
    record.calibration = Math.min(CALIBRATION_MAX, Math.max(
      CALIBRATION_MIN,
      (record.calibration * weight + target) / (weight + 1),
    ));
    record.samples = Math.min(record.samples + 1, CALIBRATION_WINDOW);
    // Persist best-effort: the in-memory record already carries the new
    // calibration regardless of whether the write below succeeds, and a disk
    // hiccup losing one sample is not worth surfacing as an unhandled
    // rejection (or failing this call) in the plugin host.
    this.persist().catch(() => {});
    return { ratio, applied: true, clamped: false };
  }

  observeContextError(baseUrl: string, model: string, maxContextTokens?: number): ContextErrorOutcome {
    const record = this.get(baseUrl, model);
    if (!record) return { applied: false, reason: "unknown-model" };
    // ONLY a window the provider actually reported is learned. A rejection that
    // carries no token count (an error code alone) says the prompt was too big,
    // not how big the window is, and guessing -25% here would compound: the
    // callback fires per failed attempt and per repack boundary, `learned`
    // records never expire, and nothing raises the window again. The in-run
    // repack already shrinks the effective input budget for such a failure, so
    // the operation still recovers — only the durable cache stops guessing.
    const next = plausible(maxContextTokens);
    if (next === null) return { applied: false, reason: "no-reported-window" };
    // A window the user typed is an instruction, not a guess to be corrected. The
    // learning path exists because a probed/defaulted window has nobody to ask;
    // silently shrinking a configured one would make the settings field describe a
    // number the engine is not using, and the user would have no way to see why.
    // The in-run repack still shrinks the effective input budget, so the operation
    // recovers either way — and the conflict is reported so the user can correct
    // the setting themselves.
    if (record.source === "configured") {
      return {
        applied: false,
        reason: "configured",
        contextWindow: record.contextWindow,
        reportedWindow: next,
      };
    }
    if (next >= record.contextWindow) return { applied: false, reason: "not-smaller" };
    record.contextWindow = Math.max(MIN_PLAUSIBLE_CONTEXT, next);
    record.source = "learned";
    delete record.expiresAt;
    // Same best-effort persistence as observeUsage: the shrunk window is
    // already live in memory, so a write failure here must not crash or
    // surface as an unhandled rejection.
    this.persist().catch(() => {});
    return { applied: true, reason: "learned", contextWindow: record.contextWindow, reportedWindow: next };
  }

  private async persist(): Promise<void> {
    if (this.cache) await this.deps.write(this.cache);
  }
}
