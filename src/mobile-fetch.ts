import { requestUrl } from "obsidian";

export const mobileFetch: typeof fetch = async (input, init) => {
  if (init?.signal?.aborted) throw new DOMException("Aborted", "AbortError");

  let url: string;
  if (typeof input === "string") url = input;
  else if (input instanceof URL) url = input.toString();
  else url = input.url;

  const body = init?.body;
  if (body != null && typeof body !== "string") {
    throw new Error("mobileFetch: only string body supported");
  }

  const requestPromise = requestUrl({
    url,
    method: init?.method ?? "GET",
    headers: init?.headers as Record<string, string> | undefined,
    body: body ?? undefined,
    throw: false,
  });

  const r = init?.signal
    ? await Promise.race([requestPromise, abortRace(init.signal)])
    : await requestPromise;

  return new Response(r.text, { status: r.status, headers: r.headers as HeadersInit });
};

function abortRace(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const handler = () => reject(new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", handler, { once: true });
  });
}
