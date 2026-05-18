import { describe, it, expect, vi } from "vitest";
import { ShellConsentModal } from "../src/modals";

describe("ShellConsentModal", () => {
  it("is exported from modals.ts", () => {
    expect(ShellConsentModal).toBeDefined();
  });

  it("calls onEnable callback and closes when enable() is called", async () => {
    const onEnable = vi.fn().mockResolvedValue(undefined);
    const modal = new ShellConsentModal({} as any, "/usr/bin/claude", onEnable);
    (modal as any).close = vi.fn();
    await (modal as any).enable();
    expect(onEnable).toHaveBeenCalledOnce();
    expect((modal as any).close).toHaveBeenCalled();
  });

  it("does not call onEnable when cancel() is called", () => {
    const onEnable = vi.fn();
    const modal = new ShellConsentModal({} as any, "/usr/bin/claude", onEnable);
    (modal as any).close = vi.fn();
    (modal as any).cancel();
    expect(onEnable).not.toHaveBeenCalled();
  });
});
