export const WIPE_HASH_ALGORITHM = "sha256-v2" as const;
export const WIPE_EVENT_MAX_BYTES = 256 * 1024;
export const WIPE_LOG_LINE_MAX_BYTES = 1_048_576;
export const WIPE_IDENTIFIER_MAX_UTF8_BYTES = 255;
export const WIPE_IDENTIFIER_MAX_CODEPOINTS = 255;

export interface WipeManifestEntry {
  path: string;
  hash?: string;
}

export interface WipeManifestChunkProof {
  chunkIndex: number;
  chunkCount: number;
  entryCount: number;
  chunkHash: string;
}

export function assertWellFormedWipeString(value: string, label: string): void {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!Number.isFinite(next) || next < 0xdc00 || next > 0xdfff) {
        throw new Error(`${label} contains ill-formed UTF-16`);
      }
      index++;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new Error(`${label} contains ill-formed UTF-16`);
    }
  }
}

export function assertBoundedWipeIdentifier(value: string, label: string): void {
  assertWellFormedWipeString(value, label);
  if (
    Array.from(value).length > WIPE_IDENTIFIER_MAX_CODEPOINTS
    || new TextEncoder().encode(value).length > WIPE_IDENTIFIER_MAX_UTF8_BYTES
  ) {
    throw new Error(`${label} identifier exceeds 255 UTF-8 bytes or Unicode codepoints`);
  }
}

function uint32(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new Error("wipe proof integer is out of range");
  }
  const result = new Uint8Array(4);
  new DataView(result.buffer).setUint32(0, value);
  return result;
}

function prefixedString(value: string, label: string): Uint8Array {
  assertWellFormedWipeString(value, label);
  const bytes = new TextEncoder().encode(value);
  const result = new Uint8Array(4 + bytes.length);
  new DataView(result.buffer).setUint32(0, bytes.length);
  result.set(bytes, 4);
  return result;
}

function join(parts: readonly Uint8Array[]): Uint8Array {
  const size = parts.reduce((total, part) => total + part.length, 0);
  const result = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function canonicalWipeChunk(entries: readonly WipeManifestEntry[]): Uint8Array {
  const parts: Uint8Array[] = [uint32(entries.length)];
  for (const entry of entries) {
    parts.push(prefixedString(entry.path, "manifest path"));
    parts.push(entry.hash === undefined
      ? new Uint8Array([0])
      : join([
          new Uint8Array([1]),
          prefixedString(entry.hash, "manifest file hash"),
        ]));
  }
  return join(parts);
}

export async function wipeProofHash(bytes: Uint8Array): Promise<string> {
  const input = new Uint8Array(bytes.byteLength);
  input.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", input);
  return `sha256:${Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")}`;
}

export function validWipeProofHash(value: unknown): value is string {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value);
}

export async function wipeChunkHash(
  entries: readonly WipeManifestEntry[],
): Promise<string> {
  return wipeProofHash(canonicalWipeChunk(entries));
}

export async function initialWipeManifestRoot(
  totalCount: number,
  chunkCount: number,
): Promise<string> {
  return wipeProofHash(join([
    prefixedString("iwiki-wipe-manifest-sha256-v2", "wipe proof domain"),
    uint32(totalCount),
    uint32(chunkCount),
  ]));
}

export async function advanceWipeManifestRoot(
  currentRoot: string,
  chunk: WipeManifestChunkProof,
): Promise<string> {
  if (!validWipeProofHash(currentRoot) || !validWipeProofHash(chunk.chunkHash)) {
    throw new Error("wipe manifest root contains an invalid SHA-256 proof");
  }
  return wipeProofHash(join([
    prefixedString("iwiki-wipe-manifest-sha256-v2-step", "wipe proof domain"),
    prefixedString(currentRoot, "wipe manifest root"),
    uint32(chunk.chunkIndex),
    uint32(chunk.chunkCount),
    uint32(chunk.entryCount),
    prefixedString(chunk.chunkHash, "wipe chunk hash"),
  ]));
}
