import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import test from "node:test";
import ts from "typescript";

const root = resolve(new URL("..", import.meta.url).pathname);
const srcRoot = resolve(root, "src");

interface Finding {
  file: string;
  line: number;
  kind: "completion" | "raw-client";
  governed: boolean;
}

function sourceFiles(path: string): string[] {
  return readdirSync(path).flatMap((name) => {
    const child = resolve(path, name);
    return statSync(child).isDirectory()
      ? sourceFiles(child)
      : name.endsWith(".ts") ? [child] : [];
  });
}

function unwrap(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current)
    || ts.isAsExpression(current)
    || ts.isTypeAssertionExpression(current)
    || ts.isNonNullExpression(current)
  ) current = current.expression;
  return current;
}

function propertyName(expression: ts.Expression): string | undefined {
  const current = unwrap(expression);
  if (ts.isPropertyAccessExpression(current)) return current.name.text;
  if (
    ts.isElementAccessExpression(current)
    && current.argumentExpression
    && ts.isStringLiteral(current.argumentExpression)
  ) return current.argumentExpression.text;
  return undefined;
}

function isCompletionObject(expression: ts.Expression, objectAliases: Set<string>): boolean {
  const current = unwrap(expression);
  if (ts.isIdentifier(current)) return objectAliases.has(current.text);
  return propertyName(current) === "completions";
}

function isCreateMethod(
  expression: ts.Expression,
  objectAliases: Set<string>,
  methodAliases: Set<string>,
): boolean {
  const current = unwrap(expression);
  if (ts.isIdentifier(current)) return methodAliases.has(current.text);
  if (
    (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current))
    && propertyName(current) === "create"
  ) return isCompletionObject(current.expression, objectAliases);
  if (
    ts.isCallExpression(current)
    && propertyName(current.expression) === "bind"
    && (ts.isPropertyAccessExpression(unwrap(current.expression))
      || ts.isElementAccessExpression(unwrap(current.expression)))
  ) {
    const bind = unwrap(current.expression) as ts.PropertyAccessExpression | ts.ElementAccessExpression;
    return isCreateMethod(bind.expression, objectAliases, methodAliases);
  }
  return false;
}

function optionsSupplyRetry(
  call: ts.CallExpression,
  checker: ts.TypeChecker | undefined,
): boolean {
  const typeSuppliesRetry = (node: ts.Node): boolean => {
    if (!checker) return false;
    const type = checker.getNonNullableType(checker.getTypeAtLocation(node));
    return checker.getPropertyOfType(type, "retry") !== undefined;
  };
  const options = call.arguments[1];
  if (!options) return false;
  const current = unwrap(options);
  if (ts.isObjectLiteralExpression(current)) {
    return current.properties.some((property) => {
      if (ts.isSpreadAssignment(property)) {
        return typeSuppliesRetry(property.expression);
      }
      return property.name !== undefined && property.name.getText() === "retry";
    });
  }
  return typeSuppliesRetry(current);
}

function analyzeSource(
  source: ts.SourceFile,
  checker?: ts.TypeChecker,
): Finding[] {
  const objectAliases = new Set<string>();
  const methodAliases = new Set<string>();
  const wrapperAliases = new Set<string>();
  const governedWrappers = new Set<string>();

  const collectAliases = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && node.initializer) {
      const initializer = unwrap(node.initializer);
      if (ts.isIdentifier(node.name)) {
        if (isCompletionObject(initializer, objectAliases)) objectAliases.add(node.name.text);
        if (isCreateMethod(initializer, objectAliases, methodAliases)) methodAliases.add(node.name.text);
      } else if (
        ts.isObjectBindingPattern(node.name)
        && isCompletionObject(initializer, objectAliases)
      ) {
        for (const element of node.name.elements) {
          const sourceName = element.propertyName?.getText(source) ?? element.name.getText(source);
          if (sourceName === "create" && ts.isIdentifier(element.name)) {
            methodAliases.add(element.name.text);
          }
        }
      }
    }
    ts.forEachChild(node, collectAliases);
  };
  collectAliases(source);

  // Resolve one layer of wrapper functions after aliases are known. This catches
  // helpers that hide a direct, destructured, or bound completion invocation.
  const collectWrappers = (node: ts.Node): void => {
    const named = ts.isFunctionDeclaration(node) && node.name
      ? node.name.text
      : ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)
        ? node.name.text
        : undefined;
    const body = ts.isFunctionDeclaration(node)
      ? node.body
      : ts.isVariableDeclaration(node)
        && node.initializer
        && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
        ? node.initializer.body
        : undefined;
    if (named && body) {
      let delegates = false;
      let allDelegatesGoverned = true;
      const inspect = (child: ts.Node): void => {
        if (
          ts.isCallExpression(child)
          && isCreateMethod(child.expression, objectAliases, methodAliases)
        ) {
          delegates = true;
          if (!optionsSupplyRetry(child, checker)) allDelegatesGoverned = false;
        }
        ts.forEachChild(child, inspect);
      };
      inspect(body);
      if (delegates) {
        wrapperAliases.add(named);
        if (allDelegatesGoverned) governedWrappers.add(named);
      }
    }
    ts.forEachChild(node, collectWrappers);
  };
  collectWrappers(source);

  const file = relative(root, source.fileName);
  const findings: Finding[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "OpenAI") {
      findings.push({
        file,
        line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
        kind: "raw-client",
        governed: file === "src/native-openai-client.ts",
      });
    }
    if (ts.isCallExpression(node)) {
      const expression = unwrap(node.expression);
      const wrapperCall = ts.isIdentifier(expression) && wrapperAliases.has(expression.text);
      if (isCreateMethod(expression, objectAliases, methodAliases) || wrapperCall) {
        findings.push({
          file,
          line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
          kind: "completion",
          governed: file === "src/native-llm-executor.ts"
            || file === "src/native-openai-client.ts"
            || file === "src/mobile-llm-wrap.ts"
            || (wrapperCall && ts.isIdentifier(expression) && governedWrappers.has(expression.text))
            || optionsSupplyRetry(node, checker),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return findings;
}

function productionFindings(): Finding[] {
  const files = sourceFiles(srcRoot);
  const program = ts.createProgram(files, {
    allowJs: false,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022,
  });
  const checker = program.getTypeChecker();
  return files.flatMap((file) => analyzeSource(program.getSourceFile(file)!, checker));
}

test("AST detector follows direct, aliased, destructured, bound, and wrapped completion calls", () => {
  const fixture = ts.createSourceFile("fixture.ts", `
    const completions = client.chat.completions;
    completions.create(params);
    const direct = client.chat.completions.create;
    direct(params);
    const { create: destructured } = client.chat.completions;
    destructured(params);
    const bound = client.chat.completions.create.bind(client.chat.completions);
    bound(params);
    function wrapper(params) { return direct(params); }
    wrapper(params);
  `, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);

  const completionFindings = analyzeSource(fixture)
    .filter((finding) => finding.kind === "completion");
  assert.equal(completionFindings.length >= 5, true, JSON.stringify(completionFindings));
});

test("current 13 direct production callsites are all retry-governed", () => {
  const findings = productionFindings();
  const directSyntaxCount = sourceFiles(srcRoot).reduce((count, file) => {
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.ES2022, true);
    const objectAliases = new Set<string>();
    const collect = (node: ts.Node): void => {
      if (
        ts.isVariableDeclaration(node)
        && ts.isIdentifier(node.name)
        && node.initializer
        && isCompletionObject(node.initializer, objectAliases)
      ) objectAliases.add(node.name.text);
      ts.forEachChild(node, collect);
    };
    collect(source);
    let calls = 0;
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node)
        && (ts.isPropertyAccessExpression(node.expression) || ts.isElementAccessExpression(node.expression))
        && propertyName(node.expression) === "create"
        && isCompletionObject(node.expression.expression, objectAliases)
      ) calls += 1;
      ts.forEachChild(node, visit);
    };
    visit(source);
    return count + calls;
  }, 0);
  assert.equal(directSyntaxCount, 13, "update the seeded baseline intentionally when production boundaries change");

  const ungoverned = findings.filter((finding) => !finding.governed);
  assert.deepEqual(
    ungoverned,
    [],
    `Ungoverned native completion boundaries:\n${ungoverned
      .map((finding) => `${finding.file}:${finding.line} (${finding.kind})`)
      .join("\n")}`,
  );
});

test("raw OpenAI construction is confined to the Node-safe factory", () => {
  const escaped = productionFindings()
    .filter((finding) => finding.kind === "raw-client" && !finding.governed);
  assert.deepEqual(
    escaped,
    [],
    `Raw OpenAI client escaped factory boundary:\n${escaped
      .map((finding) => `${finding.file}:${finding.line}`)
      .join("\n")}`,
  );
});
