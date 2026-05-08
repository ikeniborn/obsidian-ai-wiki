export function parseNoProxy(csv: string | undefined): string[] {
  if (!csv) return [];
  return csv.split(",").map((s) => s.trim()).filter(Boolean);
}

export function maskProxyUrl(url: string): string {
  try {
    const u = new URL(url);
    if (!u.password) return url;
    u.password = "****";
    return u.toString();
  } catch {
    return url;
  }
}
