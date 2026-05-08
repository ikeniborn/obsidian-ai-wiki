import { describe, it, expect } from "vitest";
import { extractJsonObject, significantTokens, missingTokens } from "../../src/phases/format-utils";

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

  it("извлекает имена собственные (заглавные)", () => {
    const t = significantTokens("Ростелеком использует ClickHouse и Postgres");
    expect(t.has("Ростелеком")).toBe(true);
    expect(t.has("ClickHouse")).toBe(true);
    expect(t.has("Postgres")).toBe(true);
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
});
