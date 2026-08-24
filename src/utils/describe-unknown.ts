export function describeUnknown(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return value.toString();
  if (typeof value === "symbol") return value.description ?? "Symbol";
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  try { return JSON.stringify(value) ?? "Unknown value"; }
  catch { return "Unknown value"; }
}
