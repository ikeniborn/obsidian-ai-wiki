// Vitest setup — provide globals needed for Obsidian-plugin code
if (typeof globalThis.window === "undefined") {
  (globalThis as any).window = globalThis;
}
