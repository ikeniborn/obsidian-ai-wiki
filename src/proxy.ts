export function shouldBypass(host: string, list: string[]): boolean {
  const h = host.toLowerCase();
  for (const raw of list) {
    const entry = raw.toLowerCase();
    if (entry.startsWith("*.")) {
      const suffix = entry.slice(1);
      if (h.endsWith(suffix)) return true;
    } else if (h === entry) {
      return true;
    }
  }
  return false;
}

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
