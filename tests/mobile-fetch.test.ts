import { describe, it, expect, beforeEach } from "vitest";
import { mobileFetch } from "../src/mobile-fetch";
import { __requestUrlCalls, __setRequestUrlResponse, __clearRequestUrlCalls } from "../vitest.mock";

describe("mobileFetch", () => {
  beforeEach(() => __clearRequestUrlCalls());

  it("forwards method, headers, body and returns Response with text", async () => {
    __setRequestUrlResponse({ status: 200, text: '{"ok":1}', headers: { "x-test": "1" } });
    const res = await mobileFetch("https://api.test/v1/chat", {
      method: "POST",
      headers: { authorization: "Bearer x" },
      body: '{"model":"m"}',
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('{"ok":1}');
    expect(__requestUrlCalls[0]).toMatchObject({
      url: "https://api.test/v1/chat",
      method: "POST",
      headers: { authorization: "Bearer x" },
      body: '{"model":"m"}',
      throw: false,
    });
  });

  it("throws AbortError when signal already aborted", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(mobileFetch("https://api.test/", { signal: ctrl.signal })).rejects.toThrow("Aborted");
  });

  it("rejects non-string body", async () => {
    await expect(
      mobileFetch("https://api.test/", { method: "POST", body: new Uint8Array([1, 2]) as unknown as BodyInit }),
    ).rejects.toThrow("only string body supported");
  });
});
