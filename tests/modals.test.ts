import { describe, it, expect, vi } from "vitest";
import { EditDomainModal, FileErrorModal, LintOptionsModal } from "../src/modals";
import type { DomainEntry } from "../src/domain";

const domain: DomainEntry = {
  id: "test",
  name: "Test",
  wiki_folder: "test",
  source_paths: ["/home/user/docs", "/home/user/notes with spaces"],
  entity_types: [
    { type: "Person", description: "People", extraction_cues: ["author"], min_mentions_for_page: 2 },
  ],
  language_notes: "Russian terminology",
};

function makeModal(onSave = vi.fn()) {
  return new EditDomainModal({} as any, domain, onSave);
}

describe("FileErrorModal", () => {
  function makeFileErrorModal(canRetry = true) {
    return new FileErrorModal({} as any, "/some/file.md", new Error("read error"), canRetry);
  }

  it("resolves result with 'skip' when pick('skip') is called", async () => {
    const m = makeFileErrorModal();
    (m as any).pick("skip");
    expect(await m.result).toBe("skip");
  });

  it("resolves result with 'retry' when pick('retry') is called and canRetry is true", async () => {
    const m = makeFileErrorModal(true);
    (m as any).pick("retry");
    expect(await m.result).toBe("retry");
  });

  it("resolves result with 'stop' when pick('stop') is called", async () => {
    const m = makeFileErrorModal();
    (m as any).pick("stop");
    expect(await m.result).toBe("stop");
  });

  it("resolves result with 'skip' when onClose() is called without prior pick", async () => {
    const m = makeFileErrorModal();
    m.onClose();
    expect(await m.result).toBe("skip");
  });

  it("does not resolve twice when onClose() is called after pick()", async () => {
    const m = makeFileErrorModal();
    (m as any).pick("stop");
    m.onClose(); // second call — resolved flag prevents override
    expect(await m.result).toBe("stop");
  });

  it("canRetry=false: pick('retry') is never triggered by the modal (retry path absent)", () => {
    const m = makeFileErrorModal(false);
    // When canRetry is false, the retry button is not added in onOpen().
    // Verify the internal flag is correct so the conditional branch is skipped.
    expect((m as any).canRetry).toBe(false);
  });
})

describe("EditDomainModal", () => {
  it("is exported", () => {
    expect(EditDomainModal).toBeDefined();
  });

  it("initialises entityTypesList from domain", () => {
    const m = makeModal();
    expect((m as any).entityTypesList).toEqual(domain.entity_types);
  });

  it("initialises sourcePathsList from domain including paths with spaces", () => {
    const m = makeModal();
    expect((m as any).sourcePathsList).toEqual([
      "/home/user/docs",
      "/home/user/notes with spaces",
    ]);
  });

  it("initialises entityTypesMode to 'cards'", () => {
    const m = makeModal();
    expect((m as any).entityTypesMode).toBe("cards");
  });

  describe("handleSave — card-mode", () => {
    it("calls onSave with entityTypesList (no JSON parsing)", () => {
      const onSave = vi.fn();
      const m = makeModal(onSave);
      (m as any).entityTypesMode = "cards";
      (m as any).entityTypesList = domain.entity_types;
      (m as any).sourcePathsList = ["/home/user/docs"];
      (m as any).nameVal = "Test";
      (m as any).wikiFolderVal = "test";
      (m as any).languageNotesVal = "";
      (m as any).handleSave();
      expect(onSave).toHaveBeenCalledOnce();
      expect(onSave.mock.calls[0][0].entity_types).toEqual(domain.entity_types);
    });

    it("passes source_paths with spaces intact", () => {
      const onSave = vi.fn();
      const m = makeModal(onSave);
      (m as any).entityTypesMode = "cards";
      (m as any).entityTypesList = [];
      (m as any).sourcePathsList = ["/home/user/notes with spaces"];
      (m as any).nameVal = "Test";
      (m as any).wikiFolderVal = "test";
      (m as any).languageNotesVal = "";
      (m as any).handleSave();
      expect(onSave.mock.calls[0][0].source_paths).toEqual(["/home/user/notes with spaces"]);
    });
  });

  describe("handleSave — json-mode", () => {
    it("calls onSave with parsed entityTypes when JSON is valid", () => {
      const onSave = vi.fn();
      const m = makeModal(onSave);
      (m as any).entityTypesMode = "json";
      (m as any).entityTypesVal = JSON.stringify([{ type: "Tech", description: "x", extraction_cues: [] }]);
      (m as any).sourcePathsList = [];
      (m as any).nameVal = "Test";
      (m as any).wikiFolderVal = "test";
      (m as any).languageNotesVal = "";
      (m as any).handleSave();
      expect(onSave).toHaveBeenCalledOnce();
      expect(onSave.mock.calls[0][0].entity_types[0].type).toBe("Tech");
    });

    it("does NOT call onSave when JSON is invalid", () => {
      const onSave = vi.fn();
      const m = makeModal(onSave);
      (m as any).entityTypesMode = "json";
      (m as any).entityTypesVal = "not valid json {{{";
      (m as any).nameVal = "Test";
      (m as any).wikiFolderVal = "test";
      (m as any).handleSave();
      expect(onSave).not.toHaveBeenCalled();
    });

    it("does NOT call onSave when JSON is not an array", () => {
      const onSave = vi.fn();
      const m = makeModal(onSave);
      (m as any).entityTypesMode = "json";
      (m as any).entityTypesVal = '{"type":"Tech"}';
      (m as any).nameVal = "Test";
      (m as any).wikiFolderVal = "test";
      (m as any).handleSave();
      expect(onSave).not.toHaveBeenCalled();
    });
  });
});

describe("LintOptionsModal", () => {
  const domains: DomainEntry[] = [
    {
      id: "pharma",
      name: "Pharma",
      wiki_folder: "wiki",
      source_paths: [],
      entity_types: [
        { type: "Drug", description: "A drug", extraction_cues: [], min_mentions_for_page: 1, wiki_subfolder: "drugs" },
        { type: "Condition", description: "A condition", extraction_cues: [], min_mentions_for_page: 1, wiki_subfolder: "conditions" },
      ],
    },
  ];

  it("initialises domain to 'all'", () => {
    const m = new LintOptionsModal({} as any, domains, true, vi.fn());
    expect((m as any).domain).toBe("all");
  });

  it("initialises useLlm from defaultUseLlm=false", () => {
    const m = new LintOptionsModal({} as any, domains, false, vi.fn());
    expect((m as any).useLlm).toBe(false);
  });

  it("initialises useLlm from defaultUseLlm=true", () => {
    const m = new LintOptionsModal({} as any, domains, true, vi.fn());
    expect((m as any).useLlm).toBe(true);
  });

  it("submit calls onSubmit with domain='all' and entityTypeFilter=[]", () => {
    const onSubmit = vi.fn();
    const m = new LintOptionsModal({} as any, domains, true, onSubmit);
    (m as any).domain = "all";
    (m as any).entityTypeFilter = [];
    (m as any).submit();
    expect(onSubmit).toHaveBeenCalledWith("all", { useLlm: true, entityTypeFilter: [] });
  });

  it("submit forces entityTypeFilter=[] when domain is 'all'", () => {
    const onSubmit = vi.fn();
    const m = new LintOptionsModal({} as any, domains, true, onSubmit);
    (m as any).domain = "all";
    (m as any).entityTypeFilter = ["Drug"];
    (m as any).submit();
    expect(onSubmit).toHaveBeenCalledWith("all", { useLlm: true, entityTypeFilter: [] });
  });

  it("submit passes entityTypeFilter when domain is not 'all'", () => {
    const onSubmit = vi.fn();
    const m = new LintOptionsModal({} as any, domains, true, onSubmit);
    (m as any).domain = "pharma";
    (m as any).entityTypeFilter = ["Drug"];
    (m as any).useLlm = false;
    (m as any).submit();
    expect(onSubmit).toHaveBeenCalledWith("pharma", { useLlm: false, entityTypeFilter: ["Drug"] });
  });

  it("renderEntitySection populates entityTypeFilter with all domain entity types", () => {
    const m = new LintOptionsModal({} as any, domains, true, vi.fn());
    (m as any).domain = "pharma";
    (m as any).entitySection = { empty: vi.fn(), createEl: vi.fn() };
    (m as any).renderEntitySection();
    expect((m as any).entityTypeFilter).toEqual(["Drug", "Condition"]);
  });

  it("renderEntitySection empties entitySection and returns early when domain is 'all'", () => {
    const m = new LintOptionsModal({} as any, domains, true, vi.fn());
    const mockSection = { empty: vi.fn(), createEl: vi.fn() };
    (m as any).domain = "all";
    (m as any).entitySection = mockSection;
    (m as any).renderEntitySection();
    expect(mockSection.empty).toHaveBeenCalled();
    expect((m as any).entityTypeFilter).toEqual([]);
  });
});
