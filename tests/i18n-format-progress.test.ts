import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register(new URL("./md-obsidian-loader.mjs", import.meta.url));

const { formatProgressForMode, i18nFor } = await import("../src/i18n");

for (const lang of ["en", "ru", "es"] as const) {
  test(`${lang} format truncation hint follows per-operation mode`, () => {
    const progress = i18nFor(lang).formatProgress;
    const global = formatProgressForMode(progress, false).truncationHintSettings;
    const perOperation = formatProgressForMode(progress, true).truncationHintSettings;

    assert.match(global, /Default chat model/);
    assert.match(global, /Max completion tokens/);
    assert.match(perOperation, /per-operation/);
    assert.match(perOperation, /format/);
  });
}
