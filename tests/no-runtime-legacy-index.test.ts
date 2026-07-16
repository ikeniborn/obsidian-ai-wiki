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

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && entry.name.endsWith(".ts") && !basename(entry.name).startsWith("migrate-") ? [path] : [];
  });
}

test("normal runtime neither imports nor calls legacy Markdown index helpers", () => {
  const violations: string[] = [];
  for (const path of sourceFiles(srcRoot)) {
    const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node) && node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)) {
        for (const element of node.importClause.namedBindings.elements) {
          const imported = element.propertyName?.text ?? element.name.text;
          if (legacyNames.has(imported)) violations.push(`${path}: import ${imported}`);
        }
      }
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && legacyNames.has(node.expression.text)) {
        violations.push(`${path}: call ${node.expression.text}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  assert.deepEqual(violations, []);
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
