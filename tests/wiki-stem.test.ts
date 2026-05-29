import { describe, it, expect } from "vitest";
import {
  GENERIC_WIKI_STEM_REGEX,
  buildWikiStem,
  isWikiStem,
  slugifyEntity,
  stemRegex,
} from "../src/wiki-stem";

describe("slugifyEntity", () => {
  it("lowercases ASCII alphanumerics and splits PascalCase", () => {
    expect(slugifyEntity("NeuralNetworks")).toBe("neural_networks");
    expect(slugifyEntity("HTTP2")).toBe("http2");
  });

  it("splits acronym + CamelCase boundary", () => {
    expect(slugifyEntity("NFSPage")).toBe("nfs_page");
    expect(slugifyEntity("HTTPServer")).toBe("http_server");
  });

  it("collapses spaces into a single underscore and lowercases", () => {
    expect(slugifyEntity("Neural Networks")).toBe("neural_networks");
    expect(slugifyEntity("Two   spaces")).toBe("two_spaces");
  });

  it("strips combining diacritics via NFD normalization and lowercases", () => {
    expect(slugifyEntity("Café")).toBe("cafe");
    expect(slugifyEntity("naïve")).toBe("naive");
    expect(slugifyEntity("résumé")).toBe("resume");
  });

  it("replaces punctuation runs with a single underscore", () => {
    expect(slugifyEntity("foo/bar")).toBe("foo_bar");
    expect(slugifyEntity("a.b.c")).toBe("a_b_c");
    expect(slugifyEntity("hello-world!")).toBe("hello_world");
  });

  it("trims leading and trailing underscores", () => {
    expect(slugifyEntity("__foo__")).toBe("foo");
    expect(slugifyEntity("...bar...")).toBe("bar");
  });

  it("drops non-ASCII letters that have no ASCII fold", () => {
    expect(slugifyEntity("Größe")).toBe("gro_e");
    expect(slugifyEntity("漢字Name")).toBe("name");
  });

  it("rejects empty-after-normalization input", () => {
    expect(() => slugifyEntity("")).toThrow(/cannot derive slug/);
    expect(() => slugifyEntity("///")).toThrow(/cannot derive slug/);
    expect(() => slugifyEntity("漢字")).toThrow(/cannot derive slug/);
  });
});

describe("buildWikiStem", () => {
  it("composes wiki_<domain>_<slug> in lowercase", () => {
    expect(buildWikiStem("os", "NFS")).toBe("wiki_os_nfs");
    expect(buildWikiStem("work_project", "Neural Networks")).toBe(
      "wiki_work_project_neural_networks"
    );
  });

  it("rejects malformed domain ids", () => {
    expect(() => buildWikiStem("Bad-Domain", "X")).toThrow(/invalid domainId/);
    expect(() => buildWikiStem("UPPER", "X")).toThrow(/invalid domainId/);
    expect(() => buildWikiStem("", "X")).toThrow(/invalid domainId/);
  });
});

describe("stemRegex", () => {
  it("matches lowercase stems for the given domain only", () => {
    const re = stemRegex("os");
    expect(re.test("wiki_os_nfs")).toBe(true);
    expect(re.test("wiki_os_neural_networks")).toBe(true);
    expect(re.test("wiki_os_NFS")).toBe(false);
    expect(re.test("wiki_work_nfs")).toBe(false);
    expect(re.test("nfs")).toBe(false);
    expect(re.test("wiki_os_")).toBe(false);
  });

  it("rejects malformed domain ids", () => {
    expect(() => stemRegex("Bad")).toThrow(/invalid domainId/);
  });
});

describe("GENERIC_WIKI_STEM_REGEX", () => {
  it("accepts lowercase wiki_<domain>_<entity>", () => {
    expect(GENERIC_WIKI_STEM_REGEX.test("wiki_os_nfs")).toBe(true);
    expect(GENERIC_WIKI_STEM_REGEX.test("wiki_a_b")).toBe(true);
    expect(GENERIC_WIKI_STEM_REGEX.test("wiki_work_project_neural_networks")).toBe(true);
  });

  it("rejects uppercase entity parts", () => {
    expect(GENERIC_WIKI_STEM_REGEX.test("wiki_os_NFS")).toBe(false);
    expect(GENERIC_WIKI_STEM_REGEX.test("wiki_os_Neural_Networks")).toBe(false);
  });

  it("rejects missing prefix or empty parts", () => {
    expect(GENERIC_WIKI_STEM_REGEX.test("nfs")).toBe(false);
    expect(GENERIC_WIKI_STEM_REGEX.test("wiki__nfs")).toBe(false);
    expect(GENERIC_WIKI_STEM_REGEX.test("wiki_os_")).toBe(false);
    expect(GENERIC_WIKI_STEM_REGEX.test("WIKI_os_nfs")).toBe(false);
  });
});

describe("isWikiStem", () => {
  it("uses generic regex without a domain", () => {
    expect(isWikiStem("wiki_os_nfs")).toBe(true);
    expect(isWikiStem("nfs")).toBe(false);
  });

  it("uses domain-specific regex when domain provided", () => {
    expect(isWikiStem("wiki_os_nfs", "os")).toBe(true);
    expect(isWikiStem("wiki_os_nfs", "work")).toBe(false);
  });
});
