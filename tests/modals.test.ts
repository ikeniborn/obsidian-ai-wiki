import { describe, it, expect, vi } from "vitest";
import { EditDomainModal } from "../src/modals";
import type { DomainEntry } from "../src/domain-map";

const domain: DomainEntry = {
  id: "test",
  name: "Test",
  wiki_folder: "!Wiki/test",
  source_paths: ["/home/user/docs", "/home/user/notes with spaces"],
  entity_types: [
    { type: "Person", description: "People", extraction_cues: ["author"], min_mentions_for_page: 2 },
  ],
  language_notes: "Russian terminology",
};

function makeModal(onSave = vi.fn()) {
  return new EditDomainModal({} as any, domain, onSave);
}

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
      (m as any).wikiFolderVal = "!Wiki/test";
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
      (m as any).wikiFolderVal = "!Wiki/test";
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
      (m as any).wikiFolderVal = "!Wiki/test";
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
      (m as any).wikiFolderVal = "!Wiki/test";
      (m as any).handleSave();
      expect(onSave).not.toHaveBeenCalled();
    });

    it("does NOT call onSave when JSON is not an array", () => {
      const onSave = vi.fn();
      const m = makeModal(onSave);
      (m as any).entityTypesMode = "json";
      (m as any).entityTypesVal = '{"type":"Tech"}';
      (m as any).nameVal = "Test";
      (m as any).wikiFolderVal = "!Wiki/test";
      (m as any).handleSave();
      expect(onSave).not.toHaveBeenCalled();
    });
  });
});
