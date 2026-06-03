# Settings Grouping Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix native backend settings order — move `structuredRetries` above per-operation section, add visual heading separator, remove duplicate "Semantic Search" heading.

**Architecture:** Three surgical edits in `src/settings.ts` native backend rendering block (~lines 471–547). No logic changes — pure UI layout reorder.

**Tech Stack:** TypeScript, Obsidian Settings API (`Setting`, `containerEl`)

---

### Task 1: Move `structuredRetries` above per-operation section

**Files:**
- Modify: `src/settings.ts:471–543`

Current order (lines 471–543):
```
if (!Platform.isMobile) { perOperation toggle }
if (s.nativeAgent.perOperation) { per-op block }
new Setting … structuredRetries   ← wrong position
```

Target order:
```
new Setting … structuredRetries   ← moved here
if (!Platform.isMobile) { perOperation toggle }
if (s.nativeAgent.perOperation) { per-op block }
```

- [ ] **Step 1: Remove `structuredRetries` block from current position**

In `src/settings.ts`, delete lines 530–543 (the blank line + `structuredRetries` Setting block):

```typescript
      new Setting(containerEl)
        .setName(T.settings.structuredRetries_name)
        .setDesc(T.settings.structuredRetries_desc)
        .addText((t) =>
          t.setPlaceholder("1")
            .setValue(String(s.nativeAgent.structuredRetries))
            .onChange(async (v) => {
              const n = Number(v);
              if (!Number.isFinite(n) || n < 0 || n > 3) return;
              s.nativeAgent.structuredRetries = Math.floor(n);
              await this.plugin.saveSettings();
            }),
        );
```

- [ ] **Step 2: Insert `structuredRetries` block before `if (!Platform.isMobile)`**

Insert the same block immediately before the line `if (!Platform.isMobile) {` (currently line 471, will shift after step 1):

```typescript
      new Setting(containerEl)
        .setName(T.settings.structuredRetries_name)
        .setDesc(T.settings.structuredRetries_desc)
        .addText((t) =>
          t.setPlaceholder("1")
            .setValue(String(s.nativeAgent.structuredRetries))
            .onChange(async (v) => {
              const n = Number(v);
              if (!Number.isFinite(n) || n < 0 || n > 3) return;
              s.nativeAgent.structuredRetries = Math.floor(n);
              await this.plugin.saveSettings();
            }),
        );

      if (!Platform.isMobile) {
```

---

### Task 2: Add "Per-operation models" heading separator

**Files:**
- Modify: `src/settings.ts` — inside `if (!Platform.isMobile)` block

- [ ] **Step 1: Add heading before the per-operation toggle**

Inside `if (!Platform.isMobile) {`, insert one line before `new Setting(containerEl).setName(T.settings.perOperation_name)`:

```typescript
      if (!Platform.isMobile) {
        new Setting(containerEl).setName("Per-operation models").setHeading();
        new Setting(containerEl)
          .setName(T.settings.perOperation_name)
          .setDesc(T.settings.perOperation_desc)
          .addToggle((t) =>
            t.setValue(s.nativeAgent.perOperation)
              .onChange(async (v) => { s.nativeAgent.perOperation = v; await this.plugin.saveSettings(); this.display(); }),
          );
      }
```

---

### Task 3: Remove duplicate "Semantic Search" heading

**Files:**
- Modify: `src/settings.ts:545–547`

Current (two identical lines):
```typescript
      new Setting(containerEl).setName("Semantic Search").setHeading();

      new Setting(containerEl).setName("Semantic Search").setHeading();
```

- [ ] **Step 1: Delete the second `"Semantic Search"` heading line**

Keep the first occurrence, delete the blank line and the second `new Setting(containerEl).setName("Semantic Search").setHeading();` line.

Result:
```typescript
      new Setting(containerEl).setName("Semantic Search").setHeading();

      new Setting(containerEl)
        .setName("Enable semantic similarity (embeddings)")
```

---

### Task 4: Build and verify

**Files:**
- Build output: `dist/main.js`

- [ ] **Step 1: Run build**

```bash
npm run build
```

Expected: exits 0, no TypeScript errors.

- [ ] **Step 2: Run lat check**

```bash
lat check
```

Expected: all links and code refs pass (no src changes affect lat.md content).

- [ ] **Step 3: Commit**

```bash
git add src/settings.ts dist/main.js
git commit -m "fix(settings): move structuredRetries above per-op section; add heading separator; remove duplicate Semantic Search heading"
```
