import { describe, it, expect } from "vitest";
import { extractJsonObject, significantTokens, missingTokens, missingTokensWithContext, looksTruncated, appendMissingLines, restoreObsidianEmbeds, missingObsidianEmbeds } from "../../src/phases/format-utils";

describe("extractJsonObject", () => {
  it("парсит чистый JSON", () => {
    const out = extractJsonObject('{"report":"r","formatted":"f"}');
    expect(out).toEqual({ report: "r", formatted: "f" });
  });

  it("парсит JSON с обёрткой текста до и после", () => {
    const out = extractJsonObject('Вот ответ:\n{"report":"r","formatted":"# H"}\nКонец');
    expect(out).toEqual({ report: "r", formatted: "# H" });
  });

  it("учитывает фигурные скобки внутри строк", () => {
    const out = extractJsonObject('{"report":"a {b} c","formatted":"d"}');
    expect(out).toEqual({ report: "a {b} c", formatted: "d" });
  });

  it("учитывает escape-последовательности", () => {
    const out = extractJsonObject('{"report":"line1\\nline2","formatted":"f"}');
    expect(out?.report).toBe("line1\nline2");
  });

  it("возвращает null для невалидного JSON", () => {
    expect(extractJsonObject("not json")).toBeNull();
    expect(extractJsonObject("{ broken")).toBeNull();
  });

  it("не путается с inner ```fence``` внутри formatted (regression)", () => {
    // formatted содержит ```sql / ```bash — раньше stripCodeFence жадно вырезал первый внутренний блок.
    const json = '{"report":"r","formatted":"# H\\n\\n```sql\\nSELECT 1;\\n```\\n\\n```bash\\nls\\n```\\n"}';
    const out = extractJsonObject(json);
    expect(out?.report).toBe("r");
    expect(out?.formatted).toContain("```sql");
    expect(out?.formatted).toContain("```bash");
  });

  it("парсит JSON, обёрнутый в ```json fence снаружи", () => {
    const wrapped = '```json\n{"report":"r","formatted":"```sql\\nSELECT 1;\\n```"}\n```';
    const out = extractJsonObject(wrapped);
    expect(out?.report).toBe("r");
    expect(out?.formatted).toContain("```sql");
  });
});

describe("looksTruncated", () => {
  it("обнаруживает обрыв на середине JSON", () => {
    expect(looksTruncated('```json\n{"report":"start of report')).toBe(true);
  });

  it("полный JSON не считается обрезанным", () => {
    expect(looksTruncated('{"report":"r","formatted":"f"}')).toBe(false);
  });

  it("текст без { не считается обрезанным", () => {
    expect(looksTruncated("just text no json")).toBe(false);
  });

  it("открытая скобка без закрытия — обрезано", () => {
    expect(looksTruncated('{"a":{"b":"c"}')).toBe(true);
  });
});

describe("significantTokens", () => {
  it("извлекает числа", () => {
    const t = significantTokens("Версия 1.2.3 в 2024 году");
    expect(t.has("1.2")).toBe(true);
    expect(t.has("3")).toBe(true);
    expect(t.has("2024")).toBe(true);
  });

  it("извлекает URL", () => {
    const t = significantTokens("См. https://example.com/path и http://a.b");
    expect(t.has("https://example.com/path")).toBe(true);
    expect(t.has("http://a.b")).toBe(true);
  });

  it("извлекает Latin-имена собственные и акронимы; кириллица игнорируется (рефраз допустим)", () => {
    const t = significantTokens("Ростелеком использует ClickHouse и Postgres, API через HTTP");
    expect(t.has("ClickHouse")).toBe(true);
    expect(t.has("Postgres")).toBe(true);
    expect(t.has("API")).toBe(true);
    expect(t.has("HTTP")).toBe(true);
    expect(t.has("Ростелеком")).toBe(false);
  });

  it("извлекает идентификаторы из inline кода", () => {
    const t = significantTokens("Метод `getUser` вызывает `parseJson`.");
    expect(t.has("getUser")).toBe(true);
    expect(t.has("parseJson")).toBe(true);
  });

  it("извлекает идентификаторы из fenced блоков", () => {
    const t = significantTokens("```ts\nfunction foo() { return BAR_CONST; }\n```");
    expect(t.has("foo")).toBe(true);
    expect(t.has("BAR_CONST")).toBe(true);
  });

  it("НЕ извлекает Pascal-suffix из camelCase (regression: socketTimeout → Timeout)", () => {
    const t = significantTokens("`socketTimeout` равен `connectionKeepAlive`");
    expect(t.has("socketTimeout")).toBe(true);
    expect(t.has("connectionKeepAlive")).toBe(true);
    expect(t.has("Timeout")).toBe(false);
    expect(t.has("KeepAlive")).toBe(false);
  });

  it("НЕ дробит числа: 2025 → не «025», not «25»", () => {
    const t = significantTokens("Год 2025 версия v3.7");
    expect(t.has("2025")).toBe(true);
    expect(t.has("025")).toBe(false);
    expect(t.has("25")).toBe(false);
  });
});

describe("missingTokens", () => {
  it("возвращает пустой массив если все токены сохранены", () => {
    const orig = "Ростелеком 2024 https://a.b `foo`";
    const fmt = "Ростелеком в 2024 году ссылка https://a.b метод `foo`";
    expect(missingTokens(orig, fmt)).toEqual([]);
  });

  it("находит утраченные токены", () => {
    const orig = "Ростелеком 2024 https://a.b";
    const fmt = "Ростелеком 2024";
    expect(missingTokens(orig, fmt)).toContain("https://a.b");
  });

  it("сравнение case-insensitive — Clickhouse vs ClickHouse не теряется", () => {
    const orig = "Используем ClickHouse и API";
    const fmt = "Используем clickhouse и api";
    expect(missingTokens(orig, fmt)).toEqual([]);
  });

  it("числа внутри URL не дробятся на отдельные токены", () => {
    const orig = "См. https://example.org/path/15-1244.00/43232405";
    const fmt = "Ссылка: https://example.org/path/15-1244.00/43232405";
    expect(missingTokens(orig, fmt)).toEqual([]);
  });

  it("URL сохранён, но числа из его пути не считаются missing", () => {
    const orig = "https://example.org/v1/2024";
    const fmt = "https://example.org/v1/2024";
    const missing = missingTokens(orig, fmt);
    expect(missing).toEqual([]);
  });

  it("plural→singular: Aggregations ≈ aggregation, CTEs ≈ CTE (lemma rephrase)", () => {
    const orig = "Aggregations и CTEs и Files используются.";
    const fmt = "aggregation, CTE и file применяются.";
    expect(missingTokens(orig, fmt)).toEqual([]);
  });

  it("singular→plural не теряется: aggregation ≈ aggregations", () => {
    const orig = "Используем `Aggregation` для группировки.";
    const fmt = "Используем aggregations для группировки.";
    expect(missingTokens(orig, fmt)).toEqual([]);
  });
});

describe("missingTokensWithContext", () => {
  it("возвращает контекст-строку из оригинала для каждого missing токена", () => {
    const orig = "Дата релиза: 2025-01-XX (placeholder)\nДругая строка про API";
    const fmt = "Дата релиза\nДругая строка про API";
    const missing = missingTokensWithContext(orig, fmt);
    const xx = missing.find((m) => m.token === "XX");
    expect(xx).toBeDefined();
    expect(xx?.context).toContain("placeholder");
  });

  it("обрезает длинный контекст на 120 символов", () => {
    const longLine = "PER " + "x".repeat(200);
    const missing = missingTokensWithContext(longLine, "");
    const per = missing.find((m) => m.token === "PER");
    expect(per?.context.length).toBeLessThanOrEqual(120);
    expect(per?.context).toMatch(/…$/);
  });
});

describe("appendMissingLines", () => {
  it("дописывает restored-block с оригинальными строками", () => {
    const formatted = "# Заголовок\n\nТекст.";
    const missing = [
      { token: "ClickHouse", context: "ClickHouse 23.8 — колоночная СУБД." },
      { token: "https://a.b", context: "См. https://a.b/docs" },
    ];
    const result = appendMissingLines(formatted, missing);
    expect(result).toContain("---\n<!-- restored-lines: token loss after retry -->");
    expect(result).toContain("ClickHouse 23.8 — колоночная СУБД.");
    expect(result).toContain("См. https://a.b/docs");
  });

  it("дедуплицирует строки-источники", () => {
    const formatted = "# H";
    const missing = [
      { token: "API", context: "Строка с API и другими токенами" },
      { token: "HTTP", context: "Строка с API и другими токенами" },
    ];
    const result = appendMissingLines(formatted, missing);
    const count = (result.match(/Строка с API/g) ?? []).length;
    expect(count).toBe(1);
  });

  it("пропускает токены с пустым context", () => {
    const formatted = "# H";
    const missing = [
      { token: "API", context: "" },
      { token: "URL", context: "" },
    ];
    const result = appendMissingLines(formatted, missing);
    expect(result).toBe("# H");
  });

  it("если все context пустые — возвращает formatted без изменений", () => {
    const formatted = "# H\n\nТекст.";
    const result = appendMissingLines(formatted, [{ token: "X", context: "" }]);
    expect(result).toBe("# H\n\nТекст.");
  });

  it("не мутирует входной formatted", () => {
    const formatted = "# H";
    const missing = [{ token: "API", context: "строка с API" }];
    const before = formatted;
    appendMissingLines(formatted, missing);
    expect(formatted).toBe(before);
  });
});

describe("restoreObsidianEmbeds", () => {
  it("no-op when embed already preserved", () => {
    const orig = "text\n![[file.excalidraw]]\nend";
    const fmt  = "text\n![[file.excalidraw]]\nend";
    expect(restoreObsidianEmbeds(orig, fmt)).toBe(fmt);
  });

  it("restores embed converted to standard Markdown image", () => {
    const orig = "![[Проект 122 Минцифра 2025-09-23 10.03.28.excalidraw]]";
    const fmt  = "![Схема: Проект 122 Минцифра (2025-09-23 10.03.28)](Проект 122 Минцифра 2025-09-23 10.03.28.excalidraw)";
    expect(restoreObsidianEmbeds(orig, fmt)).toBe(orig);
  });

  it("restores embed with alias converted to standard Markdown", () => {
    const orig = "![[diagram.png|My Diagram]]";
    const fmt  = "![My Diagram](diagram.png)";
    expect(restoreObsidianEmbeds(orig, fmt)).toBe("![[diagram.png|My Diagram]]");
  });

  it("restores multiple embeds", () => {
    const orig = "![[a.png]]\n![[b.excalidraw]]";
    const fmt  = "![](a.png)\n![](b.excalidraw)";
    expect(restoreObsidianEmbeds(orig, fmt)).toBe(orig);
  });

  it("no-op when no embeds in original", () => {
    const orig = "plain text";
    const fmt  = "plain text formatted";
    expect(restoreObsidianEmbeds(orig, fmt)).toBe(fmt);
  });
});

describe("missingObsidianEmbeds", () => {
  it("returns empty when all embeds preserved", () => {
    const orig = "![[file.png]] text";
    const fmt  = "![[file.png]] formatted text";
    expect(missingObsidianEmbeds(orig, fmt)).toEqual([]);
  });

  it("returns missing embed when LLM dropped it entirely", () => {
    const orig = "![[file.png]] text";
    const fmt  = "formatted text";
    expect(missingObsidianEmbeds(orig, fmt)).toEqual(["![[file.png]]"]);
  });

  it("returns empty after restoration (restoreObsidianEmbeds called first)", () => {
    const orig = "![[diagram.excalidraw]]";
    const fmt  = "![Схема](diagram.excalidraw)";
    const restored = restoreObsidianEmbeds(orig, fmt);
    expect(missingObsidianEmbeds(orig, restored)).toEqual([]);
  });
});
