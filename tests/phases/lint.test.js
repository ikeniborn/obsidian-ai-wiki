import { describe, it, expect, vi } from "vitest";
import { runLint } from "../../src/phases/lint";
import { VaultTools } from "../../src/vault-tools";
function mockAdapter(overrides = {}) {
    return {
        read: vi.fn().mockResolvedValue(""),
        write: vi.fn().mockResolvedValue(undefined),
        list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
        exists: vi.fn().mockResolvedValue(true),
        mkdir: vi.fn().mockResolvedValue(undefined),
        ...overrides,
    };
}
function makeLlm(report, configJson = "{}") {
    const streamResponse = {
        [Symbol.asyncIterator]: async function* () {
            yield { choices: [{ delta: { content: report } }] };
        },
    };
    const nonStreamResponse = { choices: [{ message: { content: configJson } }] };
    return {
        chat: {
            completions: {
                create: vi.fn().mockImplementation((params) => Promise.resolve(params.stream ? streamResponse : nonStreamResponse)),
            },
        },
    };
}
async function collect(gen) {
    const out = [];
    for await (const e of gen)
        out.push(e);
    return out;
}
const domain = {
    id: "work",
    name: "Work",
    wiki_folder: "vaults/Work/!Wiki/work",
    source_paths: [],
};
describe("runLint", () => {
    it("yields error when domains is empty", async () => {
        const vt = new VaultTools(mockAdapter(), "/vault");
        const events = await collect(runLint([], vt, makeLlm(""), "model", [], "/vault", new AbortController().signal));
        expect(events.some((e) => e.kind === "error")).toBe(true);
    });
    it("yields error when specified domain not found", async () => {
        const vt = new VaultTools(mockAdapter(), "/vault");
        const events = await collect(runLint(["unknown-domain"], vt, makeLlm(""), "model", [domain], "/vault", new AbortController().signal));
        expect(events.some((e) => e.kind === "error")).toBe(true);
    });
    it("yields result with report for existing domain", async () => {
        const adapter = mockAdapter({
            exists: vi.fn().mockResolvedValue(true),
            list: vi.fn().mockResolvedValue({ files: ["vaults/Work/!Wiki/work/Page.md"], folders: [] }),
            read: vi.fn().mockResolvedValue("---\ntags: []\n---\n# Page\n\nContent."),
        });
        const vt = new VaultTools(adapter, "/vault");
        const events = await collect(runLint(["work"], vt, makeLlm("No issues found."), "model", [domain], "/vault", new AbortController().signal));
        const result = events.find((e) => e.kind === "result");
        expect(result).toBeDefined();
        expect(result.text).toBeTruthy();
    });
    it("yields domain_updated with entity_types from second LLM call", async () => {
        const adapter = mockAdapter({
            list: vi.fn().mockResolvedValue({ files: ["vaults/Work/!Wiki/work/Page.md"], folders: [] }),
            read: vi.fn().mockResolvedValue("---\ntags: []\n---\n# Page\n\nContent."),
        });
        const vt = new VaultTools(adapter, "/vault");
        const configJson = JSON.stringify({
            entity_types: [{ type: "концепция", description: "updated", extraction_cues: ["тест"], min_mentions_for_page: 1, wiki_subfolder: "work/концепции" }],
            language_notes: "Updated notes.",
        });
        const events = await collect(runLint(["work"], vt, makeLlm("Report.", configJson), "model", [domain], "/vault", new AbortController().signal));
        const ev = events.find((e) => e.kind === "domain_updated");
        expect(ev).toBeDefined();
        expect(ev.domainId).toBe("work");
        expect(ev.patch.entity_types).toHaveLength(1);
        expect(ev.patch.language_notes).toBe("Updated notes.");
    });
    it("emits vector info_text events in embedding mode", async () => {
        const adapter = mockAdapter({
            exists: vi.fn().mockResolvedValue(true),
            list: vi.fn().mockResolvedValue({ files: ["vaults/Work/!Wiki/work/Page.md"], folders: [] }),
            read: vi.fn().mockResolvedValue("---\ntags: []\n---\n# Page\n\nContent."),
        });
        const vt = new VaultTools(adapter, "/vault");
        const similarity = {
            config: { mode: "embedding" },
            loadCache: vi.fn().mockResolvedValue(undefined),
            refreshCache: vi.fn().mockResolvedValue({ updated: 3 }),
        };
        const events = await collect(
            runLint(["work"], vt, makeLlm("No issues."), "model", [domain], "/vault", new AbortController().signal, 20, {}, similarity)
        );
        const infoEvents = events.filter((e) => e.kind === "info_text");
        expect(similarity.loadCache).toHaveBeenCalled();
        expect(similarity.refreshCache).toHaveBeenCalled();
        expect(infoEvents.some((e) => e.summary.includes("загрузка кэша векторов"))).toBe(true);
        expect(infoEvents.some((e) => e.summary.includes("обновлено векторов: 3"))).toBe(true);
    });
    it("does not emit vector events in jaccard mode", async () => {
        const adapter = mockAdapter({
            exists: vi.fn().mockResolvedValue(true),
            list: vi.fn().mockResolvedValue({ files: ["vaults/Work/!Wiki/work/Page.md"], folders: [] }),
            read: vi.fn().mockResolvedValue("---\ntags: []\n---\n# Page\n\nContent."),
        });
        const vt = new VaultTools(adapter, "/vault");
        const similarity = {
            config: { mode: "jaccard" },
            loadCache: vi.fn().mockResolvedValue(undefined),
            refreshCache: vi.fn().mockResolvedValue({ updated: 0 }),
        };
        const events = await collect(
            runLint(["work"], vt, makeLlm("No issues."), "model", [domain], "/vault", new AbortController().signal, 20, {}, similarity)
        );
        const vectorEvents = events.filter(
            (e) => e.kind === "info_text" && (e.summary.includes("векторов") || e.summary.includes("кэша"))
        );
        expect(vectorEvents).toHaveLength(0);
    });
    it("does not emit write event when updated is 0", async () => {
        const adapter = mockAdapter({
            exists: vi.fn().mockResolvedValue(true),
            list: vi.fn().mockResolvedValue({ files: ["vaults/Work/!Wiki/work/Page.md"], folders: [] }),
            read: vi.fn().mockResolvedValue("---\ntags: []\n---\n# Page\n\nContent."),
        });
        const vt = new VaultTools(adapter, "/vault");
        const similarity = {
            config: { mode: "embedding" },
            loadCache: vi.fn().mockResolvedValue(undefined),
            refreshCache: vi.fn().mockResolvedValue({ updated: 0 }),
        };
        const events = await collect(
            runLint(["work"], vt, makeLlm("No issues."), "model", [domain], "/vault", new AbortController().signal, 20, {}, similarity)
        );
        const infoEvents = events.filter((e) => e.kind === "info_text");
        expect(infoEvents.some((e) => e.summary.includes("загрузка кэша векторов"))).toBe(true);
        expect(infoEvents.some((e) => e.summary.includes("обновлено векторов"))).toBe(false);
    });
});
