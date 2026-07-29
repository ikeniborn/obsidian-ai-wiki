import assert from "node:assert/strict";
import test from "node:test";

import {
  extractTechnicalUnits,
  findUnsupportedTechnicalUnits,
  sanitizeUnsupportedTechnicalLines,
} from "../src/phases/query-grounding-validator";

test("technical grounding accepts exact units from selected context", () => {
  const context = [
    "sudo ufw allow from 192.168.1.0/24 to any port nfs",
    "Edit `/etc/ufw/before.rules`.",
    "What=/dev/disk/by-uuid/5bc0ceca-92a5-44d7-ad0c-f395e7f400c6",
    "DirectoryMode=0777",
    "See https://example.test/ufw.",
    "Use a 1200 second ban.",
  ].join("\n");
  const answer = [
    "Use `/etc/ufw/before.rules` and https://example.test/ufw.",
    "Network: 192.168.1.0/24. Timeout: 1200 seconds.",
    "```bash",
    "sudo ufw allow from 192.168.1.0/24 to any port nfs",
    "```",
    "```ini",
    "What=/dev/disk/by-uuid/5bc0ceca-92a5-44d7-ad0c-f395e7f400c6",
    "DirectoryMode=0777",
    "```",
  ].join("\n");

  assert.deepEqual(findUnsupportedTechnicalUnits(answer, [context]), []);
});

test("technical grounding reports altered code, path, URL, address, UUID, and numbers", () => {
  const context = [
    "DirectoryMode=0777",
    "Path: /etc/ufw/before.rules",
    "https://example.test/original",
    "192.168.1.0/24",
    "5bc0ceca-92a5-44d7-ad0c-f395e7f400c6",
    "1200 seconds",
  ].join("\n");
  const answer = [
    "Use `/etc/ufw/after.rules` and https://example.test/invented.",
    "Allow 10.0.0.0/8 for 600 seconds.",
    "UUID 11111111-2222-3333-4444-555555555555.",
    "```ini",
    "DirectoryMode=0755",
    "```",
  ].join("\n");

  const unsupported = findUnsupportedTechnicalUnits(answer, [context]);
  assert.deepEqual(unsupported.map((unit) => [unit.kind, unit.text]), [
    ["fenced_code", "DirectoryMode=0755"],
    ["inline_code", "/etc/ufw/after.rules"],
    ["url", "https://example.test/invented"],
    ["ipv4", "10.0.0.0/8"],
    ["uuid", "11111111-2222-3333-4444-555555555555"],
    ["number", "600"],
  ]);
});

test("technical grounding ignores generated comments and ordinary prose", () => {
  const context = "sudo systemctl restart sshd";
  const answer = [
    "Перезапустите службу после проверки конфигурации.",
    "```bash",
    "# This explanatory comment need not occur in the source",
    "sudo systemctl restart sshd",
    "```",
  ].join("\n");

  assert.deepEqual(extractTechnicalUnits(answer), [{
    kind: "fenced_code",
    text: "sudo systemctl restart sshd",
  }]);
  assert.deepEqual(findUnsupportedTechnicalUnits(answer, [context]), []);
});

test("technical grounding normalizes CRLF and non-breaking spaces only at boundaries", () => {
  const context = "```ini\r\nOptions=defaults,noexec\r\n```";
  const answer = "```ini\nOptions=defaults,noexec\n```";

  assert.deepEqual(findUnsupportedTechnicalUnits(answer, [context]), []);
});

test("technical grounding ignores Markdown list and heading ordinals but validates one-digit settings", () => {
  const answer = [
    "### 1. Установка",
    "#### 4) Проверка",
    "10. Выполните проверку.",
    "11) Затем установите значение 7.",
  ].join("\n");

  assert.deepEqual(extractTechnicalUnits(answer), [{ kind: "number", text: "7" }]);
  assert.deepEqual(findUnsupportedTechnicalUnits(answer, ["Установите значение 8."]), [{
    kind: "number",
    text: "7",
  }]);
});

test("technical grounding compares complete versions and numeric token boundaries", () => {
  const context = "Ubuntu 22.04 uses port 2200 and timeout 6000.";
  const answer = "Ubuntu 24.04 uses port 22 and timeout 600.";

  assert.deepEqual(findUnsupportedTechnicalUnits(answer, [context]), [
    { kind: "number", text: "24.04" },
    { kind: "number", text: "22" },
    { kind: "number", text: "600" },
  ]);
});

test("technical grounding does not classify slash-separated prose as a path", () => {
  assert.deepEqual(extractTechnicalUnits("Выбор для SSD/HDD; файл `/etc/sysctl.conf`."), [{
    kind: "inline_code",
    text: "/etc/sysctl.conf",
  }]);
});

test("technical grounding strips a trailing sentence period from an extracted path", () => {
  const answer = "See /etc/modprobe.d/amdgpu.conf.";

  assert.deepEqual(extractTechnicalUnits(answer), [{
    kind: "path",
    text: "/etc/modprobe.d/amdgpu.conf",
  }]);
});

test("technical grounding sanitizer removes only unsupported technical lines", () => {
  const context = [
    "DirectoryMode=0777",
    "Keep the supported explanation.",
    "Ubuntu client uses /etc/fstab.",
  ].join("\n");
  const answer = [
    "Keep the supported explanation.",
    "```ini",
    "DirectoryMode=0777",
    "DirectoryMode=0755",
    "```",
    "Ubuntu 24.04 uses `/etc/fstab`.",
  ].join("\n");
  const unsupported = findUnsupportedTechnicalUnits(answer, [context]);

  const sanitized = sanitizeUnsupportedTechnicalLines(answer, unsupported);

  assert.equal(sanitized.removedLines, 1);
  assert.equal(sanitized.removedUnits, 2);
  assert.equal(sanitized.answer, [
    "Keep the supported explanation.",
    "```ini",
    "DirectoryMode=0777",
    "```",
    "Ubuntu uses `/etc/fstab`.",
  ].join("\n"));
  assert.deepEqual(findUnsupportedTechnicalUnits(sanitized.answer, [context]), []);
});

test("technical grounding sanitizer removes empty CRLF and tilde fences", () => {
  const answer = "~~~bash\r\nsudo unsafe --force\r\n~~~";
  const unsupported = findUnsupportedTechnicalUnits(answer, ["sudo safe"]);

  const sanitized = sanitizeUnsupportedTechnicalLines(answer, unsupported);

  assert.equal(sanitized.answer, "");
  assert.equal(sanitized.removedLines, 3);
  assert.equal(sanitized.removedUnits, 1);
});
