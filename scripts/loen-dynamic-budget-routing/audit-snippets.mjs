const TRAILING_CONTINUATION_RE = /[ \t]*(?:&&[ \t]*)?\\[ \t]*$/;

export function stripTrailingContinuation(value) {
  return value.replace(TRAILING_CONTINUATION_RE, "").trimEnd();
}

export function normalizedText(value) {
  return value.normalize("NFC").replace(/\s+/g, " ").trim();
}

export function unique(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

export const commandStart = /^(?:\$\s*)?(?:sudo\b|apt(?:-get)?\b|dnf\b|yum\b|curl\b|wget\b|git\b|systemctl\b|journalctl\b|ufw\b|iptables\b|nft\b|ss\b|nstat\b|netstat\b|nmcli\b|ip\b|mount\b|umount\b|lsblk\b|fdisk\b|du\b|cp\b|mv\b|rm\b|mkdir\b|chmod\b|chown\b|nano\b|vim\b|echo\b|export\b|source\b|nvm\b|npm\b|grub-mkconfig\b|update-grub\b|sysctl\b|swapoff\b|swapon\b|mkswap\b|ssh(?:-keygen|-copy-id|-add)?\b|scp\b|useradd\b|usermod\b|passwd\b|groupadd\b|modprobe\b|lspci\b|lsusb\b|cat\b|grep\b|sed\b|awk\b|find\b|dd\b|tee\b)/;

export function extractTechnicalSnippets(markdown) {
  const snippets = [];
  let inFence = false;
  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (/^```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence && line && !line.startsWith("#")) snippets.push(normalizedText(line));
    if (!inFence && commandStart.test(line)) snippets.push(normalizedText(line.replace(/^\$\s*/, "")));
    if (!inFence && /^(?:[A-Z][A-Z0-9_]*|[a-z][a-z0-9_.-]*)=\S/.test(line)) {
      snippets.push(normalizedText(line));
    }
    for (const match of line.matchAll(/`([^`\r\n]+)`/g)) {
      const value = normalizedText(match[1]);
      if (value.length >= 4 && (/[\s=|]/.test(value) || value.includes("/") || value.includes("--"))) {
        snippets.push(value);
      }
    }
  }
  return unique(snippets);
}
