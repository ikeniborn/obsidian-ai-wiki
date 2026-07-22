import { readFile } from "node:fs/promises";

const OBSIDIAN_STUB = `
export const moment = { locale: () => "en" };
export const Platform = { isDesktopApp: true, isMobile: false };
export async function requestUrl(options) {
  if (typeof globalThis.__obsidianRequestUrlForTest === "function") {
    return globalThis.__obsidianRequestUrlForTest(options);
  }
  throw new Error("obsidian.requestUrl is not available in this test");
}
`;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "obsidian") {
    return {
      url: `data:text/javascript,${encodeURIComponent(OBSIDIAN_STUB)}`,
      shortCircuit: true,
    };
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.endsWith(".md")) {
    const text = await readFile(new URL(url), "utf8");
    return {
      format: "module",
      source: `export default ${JSON.stringify(text)};`,
      shortCircuit: true,
    };
  }
  return nextLoad(url, context);
}
