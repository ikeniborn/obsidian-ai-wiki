export class JsonlParseError extends Error {
  constructor(path: string, line: number, cause: unknown) {
    const msg = cause instanceof Error ? cause.message : String(cause);
    super(`${path}:${line}: ${msg}`);
    this.name = "JsonlParseError";
  }
}

export function parseJsonl<T = unknown>(text: string, path: string): T[] {
  const out: T[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!raw) continue;
    try {
      out.push(JSON.parse(raw) as T);
    } catch (e) {
      throw new JsonlParseError(path, i + 1, e);
    }
  }
  return out;
}

export function stringifyJsonl(records: unknown[]): string {
  return records.map((record) => JSON.stringify(record)).join("\n") + (records.length ? "\n" : "");
}
