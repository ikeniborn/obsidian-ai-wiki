import { requestUrl } from "obsidian";

export const mobileFetch: typeof fetch = async (input, init) => {
  if (init?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const url = typeof input === "string"
    ? input
    : input instanceof URL ? input.toString() : (input as Request).url;
  const body = init?.body;
  if (body != null && typeof body !== "string") {
    throw new Error("mobileFetch: only string body supported");
  }
  const r = await requestUrl({
    url,
    method: init?.method ?? "GET",
    headers: init?.headers as Record<string, string> | undefined,
    body: body ?? undefined,
    throw: false,
  });
  return new Response(r.text, { status: r.status, headers: r.headers as HeadersInit });
};
