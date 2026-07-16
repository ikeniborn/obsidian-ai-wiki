import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import test from "node:test";
import ts from "typescript";

const root = process.cwd();
const srcRoot = join(root, "src");
const legacyNames = new Set([
  "parseIndexAnnotations",
  "upsertIndexAnnotation",
  "removeIndexAnnotation",
  "reconcileIndex",
]);

function legacyViolations(path: string, text: string): string[] {
  const violations: string[] = [];
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && node.importClause?.namedBindings) {
      if (ts.isNamedImports(node.importClause.namedBindings)) {
        for (const element of node.importClause.namedBindings.elements) {
          const imported = element.propertyName?.text ?? element.name.text;
          if (legacyNames.has(imported)) violations.push(`${path}: import ${imported}`);
        }
      }
    }
    if (ts.isCallExpression(node)) {
      if (ts.isIdentifier(node.expression) && legacyNames.has(node.expression.text)) {
        violations.push(`${path}: call ${node.expression.text}`);
      }
      if (ts.isPropertyAccessExpression(node.expression) && legacyNames.has(node.expression.name.text)) {
        violations.push(`${path}: property call ${node.expression.name.text}`);
      }
      if (ts.isElementAccessExpression(node.expression) &&
          ts.isStringLiteralLike(node.expression.argumentExpression) &&
          legacyNames.has(node.expression.argumentExpression.text)) {
        violations.push(`${path}: element call ${node.expression.argumentExpression.text}`);
      }
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword &&
          node.arguments.length === 1 &&
          ts.isStringLiteralLike(node.arguments[0]) &&
          /(?:^|\/)wiki-index$/.test(node.arguments[0].text)) {
        violations.push(`${path}: dynamic import ${node.arguments[0].text}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return violations;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && entry.name.endsWith(".ts") && !basename(entry.name).startsWith("migrate-") ? [path] : [];
  });
}

test("normal runtime neither imports nor calls legacy Markdown index helpers", () => {
  const violations = sourceFiles(srcRoot).flatMap((path) => legacyViolations(path, readFileSync(path, "utf8")));
  assert.deepEqual(violations, []);
});

test("legacy helper scan catches namespace, element, and dynamic-import access", () => {
  const fixture = [
    'import * as wikiIndex from "./wiki-index";',
    "wikiIndex.parseIndexAnnotations(raw);",
    'wikiIndex["removeIndexAnnotation"](raw, id);',
    'const dynamic = await import("./wiki-index");',
    "dynamic.reconcileIndex(raw, pages);",
  ].join("\n");

  const violations = legacyViolations("fixture.ts", fixture);
  assert.equal(violations.some((entry) => entry.includes("property call parseIndexAnnotations")), true);
  assert.equal(violations.some((entry) => entry.includes("element call removeIndexAnnotation")), true);
  assert.equal(violations.some((entry) => entry.includes("dynamic import ./wiki-index")), true);
  assert.equal(violations.some((entry) => entry.includes("property call reconcileIndex")), true);
});

test("ingest prompt does not accept or render raw Markdown index content", () => {
  const source = readFileSync(join(srcRoot, "phases/ingest.ts"), "utf8");
  assert.doesNotMatch(source, /Wiki index \(_index\.md\)/);

  const ast = ts.createSourceFile("ingest.ts", source, ts.ScriptTarget.Latest, true);
  let hasIndexContentParameter = false;
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "buildIngestMessages") {
      hasIndexContentParameter = node.parameters.some((parameter) => ts.isIdentifier(parameter.name) && parameter.name.text === "indexContent");
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.equal(hasIndexContentParameter, false);
});

test("init prompt and runtime have no raw index placeholder or argument", () => {
  const source = readFileSync(join(srcRoot, "phases/init.ts"), "utf8");
  const template = readFileSync(join(root, "prompts/init.md"), "utf8");
  assert.doesNotMatch(source, /\bindex_block\b/);
  assert.doesNotMatch(template, /\{\{index_block\}\}/);
});

function containsFailureOutcome(node: ts.Node): boolean {
  if (ts.isThrowStatement(node)) return true;
  if (ts.isObjectLiteralExpression(node)) {
    const fields = new Map(node.properties.flatMap((property) => {
      if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name)) return [];
      return [[property.name.text, property.initializer] as const];
    }));
    const kind = fields.get("kind");
    const ok = fields.get("ok");
    if (kind && ts.isStringLiteralLike(kind) && kind.text === "error") return true;
    if (kind && ts.isStringLiteralLike(kind) && kind.text === "tool_result" && ok?.kind === ts.SyntaxKind.FalseKeyword) return true;
  }
  let found = false;
  ts.forEachChild(node, (child) => {
    if (!found && containsFailureOutcome(child)) found = true;
  });
  return found;
}

test("structured index integrity mutations are not swallowed by phase catches", () => {
  const guardedCalls = new Map<string, { names: Set<string>; within?: Set<string> }>([
    ["phases/ingest.ts", { names: new Set(["upsertPageIndex", "reconcilePageIndex", "removeArticleIndex", "refreshCache"]) }],
    ["phases/lint.ts", { names: new Set(["upsertPageIndex", "reconcilePageIndex", "removeArticleIndex", "refreshCache"]) }],
    ["phases/lint-chat.ts", { names: new Set(["upsertPageIndex"]) }],
    ["phases/delete.ts", { names: new Set(["removeArticleIndex"]) }],
    ["page-similarity.ts", { names: new Set(["fetchEmbeddings", "transformWikiIndexRecords"]), within: new Set(["refreshCache"]) }],
  ]);
  const violations: string[] = [];

  for (const [file, guard] of guardedCalls) {
    const path = join(srcRoot, file);
    const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const name = ts.isIdentifier(node.expression)
          ? node.expression.text
          : ts.isPropertyAccessExpression(node.expression)
            ? node.expression.name.text
            : "";
        if (guard.names.has(name)) {
          let current: ts.Node | undefined = node;
          let enclosingFunction = "";
          while (current?.parent) {
            current = current.parent;
            if (ts.isFunctionLike(current)) {
              if ("name" in current && current.name && ts.isIdentifier(current.name)) enclosingFunction = current.name.text;
              break;
            }
          }
          if (guard.within && !guard.within.has(enclosingFunction)) {
            ts.forEachChild(node, visit);
            return;
          }
          current = node;
          while (current?.parent) {
            if (ts.isTryStatement(current.parent) && current.parent.tryBlock === current) {
              const caught = current.parent.catchClause;
              if (caught && !containsFailureOutcome(caught.block)) violations.push(`${file}: swallowed ${name}`);
            }
            if (ts.isFunctionLike(current.parent)) break;
            current = current.parent;
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }

  assert.deepEqual(violations, []);
});
