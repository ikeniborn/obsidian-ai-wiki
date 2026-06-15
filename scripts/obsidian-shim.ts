// Runtime stand-in for Obsidian's `requestUrl`, used only by the eval harness
// (scripts/) which runs under tsx outside Obsidian. The real `obsidian` package
// is types-only, so its `requestUrl` has no runtime implementation here.
// Mirrors the subset of the API that src/page-similarity.ts consumes: { status, text }.
export interface RequestUrlParam {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  throw?: boolean;
}

export interface RequestUrlResponse {
  status: number;
  text: string;
}

export async function requestUrl(param: RequestUrlParam): Promise<RequestUrlResponse> {
  const res = await fetch(param.url, {
    method: param.method ?? "GET",
    headers: param.headers,
    body: param.body,
  });
  const text = await res.text();
  return { status: res.status, text };
}
