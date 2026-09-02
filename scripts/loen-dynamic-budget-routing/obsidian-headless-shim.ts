interface RequestUrlOptions {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string | ArrayBuffer;
  throw?: boolean;
}

interface RequestUrlResponse {
  status: number;
  headers: Record<string, string>;
  arrayBuffer: ArrayBuffer;
  json: unknown;
  text: string;
}

export async function requestUrl(options: RequestUrlOptions): Promise<RequestUrlResponse> {
  const response = await fetch(options.url, {
    method: options.method,
    headers: options.headers,
    body: options.body instanceof ArrayBuffer ? new Uint8Array(options.body) : options.body,
  });
  const arrayBuffer = await response.arrayBuffer();
  const text = new TextDecoder().decode(arrayBuffer);
  let json: unknown;
  try {
    json = JSON.parse(text) as unknown;
  } catch {
    json = undefined;
  }
  if ((options.throw ?? true) && !response.ok) {
    throw new Error(`Request failed: ${response.status} ${text.slice(0, 300)}`);
  }
  return {
    status: response.status,
    headers: Object.fromEntries(
      (response.headers as unknown as { entries(): Iterable<[string, string]> }).entries()),
    arrayBuffer,
    json,
    text,
  };
}

export const Platform = {
  isDesktop: true,
  isDesktopApp: true,
  isMobile: false,
  isMobileApp: false,
};

export const moment = {
  locale: () => "en",
};

export class Notice {
  constructor(_message: string) {}
}
