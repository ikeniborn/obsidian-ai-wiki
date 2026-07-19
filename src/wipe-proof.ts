export const WIPE_HASH_ALGORITHM = "sha256-v1" as const;

export interface WipeManifestEntry {
  path: string;
  hash?: string;
}

function lengthPrefix(bytes: Uint8Array): Uint8Array {
  const result = new Uint8Array(5 + bytes.length);
  result[0] = 1;
  new DataView(result.buffer).setUint32(1, bytes.length);
  result.set(bytes, 5);
  return result;
}

export function canonicalWipeEntries(entries: readonly WipeManifestEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const count = new Uint8Array(4);
  new DataView(count.buffer).setUint32(0, entries.length);
  parts.push(count);
  for (const entry of entries) {
    parts.push(lengthPrefix(encoder.encode(entry.path)));
    parts.push(entry.hash === undefined
      ? new Uint8Array([0])
      : lengthPrefix(encoder.encode(entry.hash)));
  }
  const size = parts.reduce((total, part) => total + part.length, 0);
  const result = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
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

export async function wipeEntriesHash(
  entries: readonly WipeManifestEntry[],
): Promise<string> {
  return wipeProofHash(canonicalWipeEntries(entries));
}
