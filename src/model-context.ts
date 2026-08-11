export const BACKEND_DEFAULT_CONTEXT = 8_192;
export const PROBE_DEADLINE_MS = 2_000;
export const DEFAULT_TTL_MS = 86_400_000;

const MIN_PLAUSIBLE_CONTEXT = 1_024;
const MAX_PLAUSIBLE_CONTEXT = 2_000_000;
const CALIBRATION_WINDOW = 8;
const CALIBRATION_MIN = 0.5;
const CALIBRATION_MAX = 3;

export interface ModelContextRecord {
  contextWindow: number;
  source: "discovered" | "learned" | "default";
  calibration: number;
  samples: number;
  expiresAt?: number;
}

export type ModelContextMap = Record<string, ModelContextRecord>;

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
 * Picks the entry whose `id` equals the model, then reads only that entry.
 * A context length belonging to a different model would be confidently wrong
 * and would produce real overflows.
 */
function contextLengthForModel(payload: unknown, model: string): number | null {
  if (payload === null || typeof payload !== "object") return null;
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data)) return findContextLength(payload);
  const list = data as unknown[];
  const entry = list.find((item) =>
    item !== null && typeof item === "object" && (item as { id?: unknown }).id === model);
  return entry === undefined ? null : findContextLength(entry);
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
): Promise<number | null> {
  const started = Date.now();
  const now = (): number => Date.now() - started;
  const deadline = deadlineMs;
  const root = baseUrl.replace(/\/+$/, "");

  const models = await getJson(fetchFn, `${root}/models`, apiKey, deadline, now, signal);
  const fromModels = models === null ? null : contextLengthForModel(models, model);
  if (fromModels !== null) return fromModels;

  const ollamaRoot = root.replace(/\/v1$/, "");
  const show = await getJson(fetchFn, `${ollamaRoot}/api/show`, apiKey, deadline, now, signal, { model });
  return show === null ? null : findContextLength(show);
}

export class ModelContextStore {
  private cache: ModelContextMap | null = null;
  private inFlight = new Map<string, Promise<ModelContextRecord>>();

  constructor(private deps: ModelContextStoreDeps) {}

  get(baseUrl: string, model: string): ModelContextRecord | undefined {
    return this.cache?.[cacheKey(baseUrl, model)];
  }

  async resolve(
    baseUrl: string,
    model: string,
    apiKey: string,
    now: number,
    signal?: AbortSignal,
  ): Promise<ModelContextRecord> {
    signal?.throwIfAborted();
    if (this.cache === null) this.cache = await this.deps.read();
    const key = cacheKey(baseUrl, model);

    const cached = this.cache[key];
    if (cached && (cached.expiresAt === undefined || cached.expiresAt > now)) return cached;

    const pending = this.inFlight.get(key);
    if (pending) return pending;

    const task = (async (): Promise<ModelContextRecord> => {
      const probed = await probeContextWindow(
        this.deps.fetchFn, baseUrl, apiKey, model, PROBE_DEADLINE_MS, signal,
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
      await this.deps.write(this.cache!);
      return record;
    })().finally(() => this.inFlight.delete(key));

    this.inFlight.set(key, task);
    return task;
  }

  observeUsage(baseUrl: string, model: string, estimated: number, actual: number): void {
    const record = this.get(baseUrl, model);
    if (!record || estimated <= 0 || actual <= 0) return;
    const ratio = actual / estimated;
    if (ratio < CALIBRATION_MIN || ratio > CALIBRATION_MAX) return;
    // MULTIPLICATIVE. `ratio` is measured through the current factor, so
    // averaging it into the factor converges on sqrt(truth): a real factor of 2
    // settles at 1.414, a permanent 29% underestimate. Multiply, then smooth.
    const weight = Math.min(record.samples, CALIBRATION_WINDOW - 1);
    const target = record.calibration * ratio;
    record.calibration = Math.min(CALIBRATION_MAX, Math.max(
      CALIBRATION_MIN,
      (record.calibration * weight + target) / (weight + 1),
    ));
    record.samples = Math.min(record.samples + 1, CALIBRATION_WINDOW);
    void this.persist();
  }

  observeContextError(baseUrl: string, model: string, maxContextTokens?: number): void {
    const record = this.get(baseUrl, model);
    if (!record) return;
    const next = plausible(maxContextTokens) ?? Math.floor(record.contextWindow * 0.75);
    if (next >= record.contextWindow) return;
    record.contextWindow = Math.max(MIN_PLAUSIBLE_CONTEXT, next);
    record.source = "learned";
    delete record.expiresAt;
    void this.persist();
  }

  private async persist(): Promise<void> {
    if (this.cache) await this.deps.write(this.cache);
  }
}
