import { Platform } from "obsidian";
import type { OkfBundle } from "./okf-export";

/**
 * Writes an OKF bundle to an absolute filesystem path (outside the vault).
 * Desktop-only: `node:fs`/`node:path` are imported lazily so the Node builtins
 * never load on mobile, where filesystem access is unavailable.
 */
export async function writeOkfBundle(destAbs: string, bundle: OkfBundle): Promise<void> {
  if (!Platform.isDesktopApp) throw new Error("OKF export is desktop-only");
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  for (const file of bundle.files) {
    const abs = path.join(destAbs, file.relpath);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, file.content, "utf8");
  }
}
