import type { VaultTools } from "../vault-tools";

/** Convert raw base64 (no `data:` prefix) to an ArrayBuffer for binary writes. */
export function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/** Deterministic, collision-resistant filename stem from a vault-relative embed path. */
function keyFor(path: string): string {
  return path.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "x";
}

/**
 * Per-run temporary store for vision results. Lives under the plugin directory
 * (`<manifest.dir>/.vision-tmp/<runId>`), NOT the vault content tree, so rendered
 * PNGs and cached descriptions never appear as notes. Enables resume across the
 * AgentRunner idle-retry loop: a re-entered runFormat reads completed
 * descriptions from here instead of re-calling the vision LLM.
 *
 * Every method swallows its own errors and degrades to a no-op / null — the
 * store must never block or fail a format run.
 */
export class VisionTempStore {
  constructor(private vaultTools: VaultTools, private dir: string) {}

  async getDescription(path: string): Promise<string | null> {
    try {
      const p = `${this.dir}/${keyFor(path)}.json`;
      if (!(await this.vaultTools.exists(p))) return null;
      const obj = JSON.parse(await this.vaultTools.read(p)) as { path?: string; desc?: string };
      return typeof obj.desc === "string" && obj.path === path ? obj.desc : null;
    } catch {
      return null;
    }
  }

  async putDescription(path: string, desc: string): Promise<void> {
    try {
      const p = `${this.dir}/${keyFor(path)}.json`;
      await this.vaultTools.write(p, JSON.stringify({ path, desc }));
    } catch { /* never block format */ }
  }

  async putPng(path: string, b64: string): Promise<void> {
    try {
      const p = `${this.dir}/${keyFor(path)}.png`;
      await this.vaultTools.writeBinary(p, base64ToArrayBuffer(b64));
    } catch { /* fire-and-forget */ }
  }

  async cleanup(): Promise<void> {
    try {
      await this.vaultTools.adapter.rmdir?.(this.dir, true);
    } catch { /* swallow */ }
  }
}
