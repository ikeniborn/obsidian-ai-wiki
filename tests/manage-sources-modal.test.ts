import { describe, it, expect, vi } from "vitest";
import { ManageSourcesModal } from "../src/modals";
import type { DomainEntry } from "../src/domain";

const domain: DomainEntry = {
  id: "ai",
  name: "AI",
  wiki_folder: "ии",
  source_paths: ["/home/user/docs", "/home/user/notes"],
  entity_types: [],
  language_notes: "",
};

describe("ManageSourcesModal", () => {
  it("initialises sourcePathsList from domain.source_paths", () => {
    const m = new ManageSourcesModal({} as any, domain, vi.fn());
    expect((m as any).sourcePathsList).toEqual(["/home/user/docs", "/home/user/notes"]);
  });

  it("does not mutate original domain.source_paths (creates a copy)", () => {
    const m = new ManageSourcesModal({} as any, domain, vi.fn());
    (m as any).sourcePathsList.push("/extra");
    expect(domain.source_paths).toHaveLength(2);
  });

  it("calls onSave with filtered sourcePaths when handleSave is called", () => {
    const onSave = vi.fn();
    const m = new ManageSourcesModal({} as any, domain, onSave);
    (m as any).sourcePathsList = ["/home/user/docs", "", "/home/user/notes"];
    (m as any).handleSave();
    expect(onSave).toHaveBeenCalledWith({ sourcePaths: ["/home/user/docs", "/home/user/notes"] });
  });

  it("handles domain with no source_paths (undefined)", () => {
    const domainNoSrc: DomainEntry = { ...domain, source_paths: undefined };
    const m = new ManageSourcesModal({} as any, domainNoSrc, vi.fn());
    expect((m as any).sourcePathsList).toEqual([]);
  });
});
