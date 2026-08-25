import "../cross-domain/register";
import { createRequire } from "node:module";

type RequestUrlParams = { body?: string };
type RequestUrlResponse = { status: number; text: string };
type RequestUrlHandler = (params: RequestUrlParams) => RequestUrlResponse | Promise<RequestUrlResponse>;
type HierarchicalGlobal = typeof globalThis & { __hierarchicalRequestUrl?: RequestUrlHandler };

// eslint-disable-next-line @typescript-eslint/no-require-imports
const require = createRequire(import.meta.url);
const Module = require("module") as { _load: (...args: unknown[]) => unknown };
const _origLoad = Module._load;
Module._load = function (...args: unknown[]) {
  if (args[0] === "obsidian") {
    return {
      moment: { locale: () => "en" },
      Platform: { isDesktopApp: true, isMobile: false },
      requestUrl: async (params: RequestUrlParams) => {
        const handler = (globalThis as HierarchicalGlobal).__hierarchicalRequestUrl;
        if (handler) return handler(params);
        const body = JSON.parse(params.body ?? "{}") as { input?: unknown };
        const input = Array.isArray(body.input) ? body.input : [body.input];
        return {
          status: 200,
          text: JSON.stringify({ data: input.map(() => ({ embedding: [1, 0] })) }),
        };
      },
    };
  }
  return _origLoad.apply(this, args);
};
