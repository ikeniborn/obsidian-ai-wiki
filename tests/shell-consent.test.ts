import { describe, it, expect, vi } from "vitest";
import { ShellConsentModal } from "../src/modals";
import { DEFAULT_SETTINGS } from "../src/types";

describe("DEFAULT_SETTINGS.shellConsentGiven", () => {
  it("defaults to false", () => {
    expect(DEFAULT_SETTINGS.shellConsentGiven).toBe(false);
  });
});

describe("ShellConsentModal", () => {
  it("is exported from modals.ts", () => {
    expect(ShellConsentModal).toBeDefined();
  });

  it("sets shellConsentGiven=true and saves when enable() is called", async () => {
    const saveSettings = vi.fn().mockResolvedValue(undefined);
    const plugin = {
      settings: { shellConsentGiven: false },
      saveSettings,
    } as any;
    const modal = new ShellConsentModal({} as any, plugin);
    await (modal as any).enable();
    expect(plugin.settings.shellConsentGiven).toBe(true);
    expect(saveSettings).toHaveBeenCalledOnce();
  });

  it("does not change shellConsentGiven when cancel() is called", () => {
    const plugin = {
      settings: { shellConsentGiven: false },
      saveSettings: vi.fn(),
    } as any;
    const modal = new ShellConsentModal({} as any, plugin);
    (modal as any).close = vi.fn();
    (modal as any).cancel();
    expect(plugin.settings.shellConsentGiven).toBe(false);
    expect(plugin.saveSettings).not.toHaveBeenCalled();
  });
});
