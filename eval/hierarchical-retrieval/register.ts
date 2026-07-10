import "../cross-domain/register";
import { createRequire } from "node:module";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const require = createRequire(import.meta.url);
const Module = require("module") as { _load: (...args: unknown[]) => unknown };
const _origLoad = Module._load;
Module._load = function (...args: unknown[]) {
  if (args[0] === "obsidian") {
    return {
      moment: { locale: () => "en" },
      Platform: { isDesktopApp: true, isMobile: false },
      requestUrl: async () => ({
        status: 200,
        text: JSON.stringify({ data: [{ embedding: [1, 0] }] }),
      }),
    };
  }
  return _origLoad.apply(this, args);
};
