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
  boundary?: "raw-sdk-adapter";
}

interface WrapperStatus {
  completion: boolean;
  governed: boolean;
}

interface AnalysisContext {
  checker: ts.TypeChecker;
  wrappers: Map<ts.Symbol, WrapperStatus>;
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

function resolvedSymbol(checker: ts.TypeChecker, node: ts.Node): ts.Symbol | undefined {
  const symbol = checker.getSymbolAtLocation(node);
  return symbol && (symbol.flags & ts.SymbolFlags.Alias) !== 0
    ? checker.getAliasedSymbol(symbol)
    : symbol;
}

function declarationInitializer(declaration: ts.Declaration): ts.Expression | undefined {
  if (ts.isVariableDeclaration(declaration)) return declaration.initializer;
  if (ts.isPropertyAssignment(declaration)) return declaration.initializer;
  return undefined;
}

function isCompletionObject(
  expression: ts.Expression,
  context: AnalysisContext,
  seen: Set<ts.Symbol> = new Set(),
): boolean {
  const current = unwrap(expression);
  if (propertyName(current) === "completions") return true;
  if (!ts.isIdentifier(current)) return false;
  const symbol = resolvedSymbol(context.checker, current);
  if (!symbol || seen.has(symbol)) return false;
  seen.add(symbol);
  return symbol.declarations?.some((declaration) => {
    const initializer = declarationInitializer(declaration);
    return initializer ? isCompletionObject(initializer, context, seen) : false;
  }) ?? false;
}

function typeContainsName(
  checker: ts.TypeChecker,
  type: ts.Type,
  expected: string,
): boolean {
  if (type.aliasSymbol?.name === expected || type.symbol?.name === expected) return true;
  if (type.isUnionOrIntersection()) {
    return type.types.some((member) => typeContainsName(checker, member, expected));
  }
  return checker.typeToString(type).includes(expected);
}

function typeNodeReferences(
  typeNode: ts.TypeNode,
  expected: string,
  context: AnalysisContext,
): boolean {
  if (ts.isTypeReferenceNode(typeNode)) {
    return resolvedSymbol(context.checker, typeNode.typeName)?.name === expected;
  }
  return typeContainsName(
    context.checker,
    context.checker.getTypeFromTypeNode(typeNode),
    expected,
  );
}

function isNativeCreateSymbol(symbol: ts.Symbol, context: AnalysisContext): boolean {
  return symbol.declarations?.some((declaration) => {
    if (!("type" in declaration) || !declaration.type) return false;
    return typeContainsName(
      context.checker,
      context.checker.getTypeFromTypeNode(declaration.type),
      "NativeChatCompletionCreate",
    );
  }) ?? false;
}

function isCreateMethod(
  expression: ts.Expression,
  context: AnalysisContext,
  seen: Set<ts.Symbol> = new Set(),
): boolean {
  const current = unwrap(expression);
  if (
    (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current))
    && propertyName(current) === "create"
  ) {
    if (isCompletionObject(current.expression, context)) return true;
    const symbol = resolvedSymbol(context.checker, current.name ?? current.argumentExpression!);
    return symbol ? isNativeCreateSymbol(symbol, context) : false;
  }
  if (
    ts.isCallExpression(current)
    && propertyName(current.expression) === "bind"
    && (ts.isPropertyAccessExpression(unwrap(current.expression))
      || ts.isElementAccessExpression(unwrap(current.expression)))
  ) {
    const bind = unwrap(current.expression) as ts.PropertyAccessExpression | ts.ElementAccessExpression;
    return isCreateMethod(bind.expression, context, seen);
  }
  if (!ts.isIdentifier(current)) return false;
  const symbol = resolvedSymbol(context.checker, current);
  if (!symbol || seen.has(symbol)) return false;
  const wrapper = context.wrappers.get(symbol);
  if (wrapper?.completion) return true;
  if (isNativeCreateSymbol(symbol, context)) return true;
  seen.add(symbol);
  return symbol.declarations?.some((declaration) => {
    const initializer = declarationInitializer(declaration);
    if (initializer) return isCreateMethod(initializer, context, seen);
    if (ts.isBindingElement(declaration)) {
      const sourceName = declaration.propertyName?.getText() ?? declaration.name.getText();
      const variable = declaration.parent.parent;
      return sourceName === "create"
        && ts.isVariableDeclaration(variable)
        && variable.initializer !== undefined
        && isCompletionObject(variable.initializer, context);
    }
    return false;
  }) ?? false;
}

function optionsSupplyRetry(
  call: ts.CallExpression,
  checker: ts.TypeChecker,
): boolean {
  const typeSuppliesRetry = (node: ts.Node): boolean => {
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

function ownCalls(body: ts.ConciseBody): ts.CallExpression[] {
  const calls: ts.CallExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (node !== body && ts.isFunctionLike(node)) return;
    if (ts.isCallExpression(node)) calls.push(node);
    ts.forEachChild(node, visit);
  };
  visit(body);
  return calls;
}

function functionEntries(
  sources: readonly ts.SourceFile[],
  checker: ts.TypeChecker,
): Array<{ symbol: ts.Symbol; body: ts.ConciseBody }> {
  const entries: Array<{ symbol: ts.Symbol; body: ts.ConciseBody }> = [];
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      const symbol = resolvedSymbol(checker, node.name);
      if (symbol) entries.push({ symbol, body: node.body });
    } else if (
      ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && node.initializer
      && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
    ) {
      const symbol = resolvedSymbol(checker, node.name);
      if (symbol) entries.push({ symbol, body: node.initializer.body });
    }
    ts.forEachChild(node, visit);
  };
  for (const source of sources) visit(source);
  return entries;
}

function propertyTypeContains(
  expression: ts.Expression,
  property: string,
  expected: string,
  context: AnalysisContext,
): boolean {
  const ownerType = context.checker.getNonNullableType(context.checker.getTypeAtLocation(expression));
  const symbol = context.checker.getPropertyOfType(ownerType, property);
  if (!symbol) return false;
  const type = context.checker.getTypeOfSymbolAtLocation(symbol, expression);
  return typeContainsName(context.checker, type, expected);
}

function isNativeExecutorCall(call: ts.CallExpression, context: AnalysisContext): boolean {
  const expression = unwrap(call.expression);
  if (
    !(ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression))
    || propertyName(expression) !== "create"
  ) return false;
  const options = call.arguments[1] && unwrap(call.arguments[1]);
  return propertyTypeContains(expression.expression, "create", "NativeChatCompletionCreate", context)
    && propertyTypeContains(expression.expression, "retry", "NativeRequestRetryContext", context)
    && options !== undefined
    && ts.isObjectLiteralExpression(options)
    && options.properties.some((property) => property.name?.getText() === "signal");
}

function nativeExecutorImplementation(
  symbol: ts.Symbol | undefined,
  context: AnalysisContext,
): boolean {
  if (!symbol || symbol.name !== "executeNativeLlmRequest") return false;
  return symbol.declarations?.some((declaration) => ts.isFunctionDeclaration(declaration)
    && declaration.parameters.some((parameter) => parameter.type !== undefined
      && typeNodeReferences(
        parameter.type,
        "NativeLlmExecutionInput",
        context,
      ))) ?? false;
}

function factoryImplementation(
  symbol: ts.Symbol | undefined,
  context: AnalysisContext,
): boolean {
  if (!symbol || symbol.name !== "createNativeLlmClient") return false;
  return symbol.declarations?.some((declaration) => {
    if (!ts.isFunctionDeclaration(declaration) || !declaration.body) return false;
    let delegates = false;
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node)
        && nativeExecutorImplementation(
          resolvedSymbol(context.checker, unwrap(node.expression)),
          context,
        )
      ) delegates = true;
      ts.forEachChild(node, visit);
    };
    visit(declaration.body);
    return delegates;
  }) ?? false;
}

function enclosingFunction(node: ts.Node): ts.FunctionLikeDeclaration | undefined {
  let current: ts.Node | undefined = node.parent;
  while (current && !ts.isFunctionLike(current)) current = current.parent;
  return current as ts.FunctionLikeDeclaration | undefined;
}

function approvedFactoryBinding(call: ts.CallExpression, context: AnalysisContext): boolean {
  if (propertyName(call.expression) !== "bind") return false;
  let initializer: ts.Expression = call;
  while (
    ts.isAsExpression(initializer.parent)
    || ts.isTypeAssertionExpression(initializer.parent)
    || ts.isParenthesizedExpression(initializer.parent)
  ) initializer = initializer.parent;
  const declaration = initializer.parent;
  const assertedType = ts.isAsExpression(initializer) || ts.isTypeAssertionExpression(initializer)
    ? initializer.type
    : undefined;
  if (
    !ts.isVariableDeclaration(declaration)
    || !ts.isIdentifier(declaration.name)
    || declaration.initializer !== initializer
    || (!declaration.type && !assertedType)
    || !typeContainsName(
      context.checker,
      context.checker.getTypeFromTypeNode(declaration.type ?? assertedType!),
      "NativeChatCompletionCreate",
    )
  ) return false;
  const binding = resolvedSymbol(context.checker, declaration.name);
  const owner = enclosingFunction(call);
  if (!binding || !owner?.body) return false;
  return ownCalls(owner.body).some((candidate) => {
    const argument = candidate.arguments[0];
    return argument !== undefined
      && resolvedSymbol(context.checker, unwrap(argument)) === binding
      && factoryImplementation(
        resolvedSymbol(context.checker, unwrap(candidate.expression)),
        context,
      );
  });
}

function callGoverned(call: ts.CallExpression, context: AnalysisContext): boolean {
  const symbol = resolvedSymbol(context.checker, unwrap(call.expression));
  const wrapper = symbol && context.wrappers.get(symbol);
  return optionsSupplyRetry(call, context.checker)
    || isNativeExecutorCall(call, context)
    || approvedFactoryBinding(call, context)
    || wrapper?.governed === true;
}

function isCompletionCall(call: ts.CallExpression, context: AnalysisContext): boolean {
  return isCreateMethod(call.expression, context) || isCreateMethod(call, context);
}

function collectWrappers(sources: readonly ts.SourceFile[], context: AnalysisContext): void {
  const entries = functionEntries(sources, context.checker);
  for (let pass = 0; pass <= entries.length; pass++) {
    let changed = false;
    for (const entry of entries) {
      const delegated = ownCalls(entry.body)
        .filter((call) => isCompletionCall(call, context));
      if (delegated.length === 0) continue;
      const status = {
        completion: true,
        governed: delegated.every((call) => callGoverned(call, context)),
      };
      const prior = context.wrappers.get(entry.symbol);
      if (!prior || prior.governed !== status.governed) {
        context.wrappers.set(entry.symbol, status);
        changed = true;
      }
    }
    if (!changed) break;
  }
}

function approvedRawClient(node: ts.NewExpression, context: AnalysisContext): boolean {
  const declaration = node.parent;
  if (!ts.isVariableDeclaration(declaration) || !ts.isIdentifier(declaration.name)) return false;
  const raw = resolvedSymbol(context.checker, declaration.name);
  const owner = enclosingFunction(node);
  if (!raw || !owner?.body) return false;
  return ownCalls(owner.body).some((call) => {
    if (!approvedFactoryBinding(call, context)) return false;
    const bind = unwrap(call.expression);
    if (!(ts.isPropertyAccessExpression(bind) || ts.isElementAccessExpression(bind))) return false;
    let target = unwrap(bind.expression);
    while (ts.isPropertyAccessExpression(target) || ts.isElementAccessExpression(target)) {
      target = unwrap(target.expression);
    }
    return resolvedSymbol(context.checker, target) === raw;
  });
}

function analyzeProgram(program: ts.Program, files: readonly string[]): Finding[] {
  const checker = program.getTypeChecker();
  const sources = files.map((file) => program.getSourceFile(file)!).filter(Boolean);
  const context: AnalysisContext = { checker, wrappers: new Map() };
  collectWrappers(sources, context);
  const findings: Finding[] = [];
  for (const source of sources) {
    const file = relative(root, source.fileName);
    const visit = (node: ts.Node): void => {
      if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "OpenAI") {
        findings.push({
          file,
          line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
          kind: "raw-client",
          governed: approvedRawClient(node, context),
        });
      }
      if (ts.isCallExpression(node) && isCompletionCall(node, context)) {
        const adapterBoundary = approvedFactoryBinding(node, context);
        findings.push({
          file,
          line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
          kind: "completion",
          governed: callGoverned(node, context),
          ...(adapterBoundary ? { boundary: "raw-sdk-adapter" as const } : {}),
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
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
  return analyzeProgram(program, files);
}

function fixtureFindings(files: Record<string, string>): Finding[] {
  const options: ts.CompilerOptions = {
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022,
  };
  const virtual = new Map(Object.entries(files).map(([file, source]) => [resolve(root, file), source]));
  const base = ts.createCompilerHost(options, true);
  const host: ts.CompilerHost = {
    ...base,
    fileExists: (file) => virtual.has(file) || base.fileExists(file),
    directoryExists: (directory) => [...virtual.keys()].some((file) => file.startsWith(`${directory}/`))
      || base.directoryExists?.(directory)
      || false,
    getCurrentDirectory: () => root,
    readFile: (file) => virtual.get(file) ?? base.readFile(file),
    getSourceFile: (file, languageVersion, onError, shouldCreateNewSourceFile) => {
      const source = virtual.get(file);
      return source === undefined
        ? base.getSourceFile(file, languageVersion, onError, shouldCreateNewSourceFile)
        : ts.createSourceFile(file, source, languageVersion, true, ts.ScriptKind.TS);
    },
  };
  const roots = [...virtual.keys()];
  return analyzeProgram(ts.createProgram(roots, options, host), roots);
}

test("AST detector follows direct, aliased, destructured, bound, and wrapped completion calls", () => {
  const completionFindings = fixtureFindings({ "fixtures/local.ts": `
    declare const client: any;
    declare const params: any;
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
  ` }).filter((finding) => finding.kind === "completion");
  assert.equal(completionFindings.length >= 5, true, JSON.stringify(completionFindings));
});

test("AST detector follows imported wrapper and method aliases across files", () => {
  const findings = fixtureFindings({
    "fixtures/raw-adapter.ts": `
      declare const sdk: { chat: { completions: { create(params: unknown): Promise<unknown> } } };
      export const rawCreate = sdk.chat.completions.create;
      export function rawWrapper(params: unknown) {
        return sdk.chat.completions.create(params);
      }
    `,
    "fixtures/consumer.ts": `
      import { rawCreate as alias, rawWrapper } from "./raw-adapter";
      alias({});
      rawWrapper({});
    `,
  }).filter((finding) => finding.kind === "completion" && finding.file === "fixtures/consumer.ts");

  assert.equal(findings.length, 2, JSON.stringify(findings));
  assert.equal(findings.every((finding) => !finding.governed), true, JSON.stringify(findings));
});

test("approved boundaries are proven by symbols, not privileged file names", () => {
  const findings = fixtureFindings({
    "src/native-llm-executor.ts": `
      declare const client: { chat: { completions: { create(params: unknown): Promise<unknown> } } };
      client.chat.completions.create({});
    `,
    "src/native-openai-client.ts": `
      declare const client: { chat: { completions: { create(params: unknown): Promise<unknown> } } };
      export function bypass() { return client.chat.completions.create({}); }
    `,
    "src/mobile-llm-wrap.ts": `
      declare const client: { chat: { completions: { create(params: unknown): Promise<unknown> } } };
      export const bypass = () => client.chat.completions.create({});
    `,
  }).filter((finding) => finding.kind === "completion");

  assert.equal(findings.length, 3, JSON.stringify(findings));
  assert.equal(findings.every((finding) => !finding.governed), true, JSON.stringify(findings));
});

test("current 13 direct production callsites are all retry-governed", () => {
  const findings = productionFindings();
  const directSyntaxCount = sourceFiles(srcRoot).reduce((count, file) => {
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.ES2022, true);
    const objectAliases = new Set<string>();
    const isCompletionSyntax = (expression: ts.Expression): boolean => {
      const current = unwrap(expression);
      return ts.isIdentifier(current)
        ? objectAliases.has(current.text)
        : propertyName(current) === "completions";
    };
    const collect = (node: ts.Node): void => {
      if (
        ts.isVariableDeclaration(node)
        && ts.isIdentifier(node.name)
        && node.initializer
        && isCompletionSyntax(node.initializer)
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
        && isCompletionSyntax(node.expression.expression)
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
  const findings = productionFindings();
  const rawClients = findings.filter((finding) => finding.kind === "raw-client");
  const rawAdapters = findings.filter((finding) => finding.boundary === "raw-sdk-adapter");
  const escaped = rawClients.filter((finding) => !finding.governed);
  assert.equal(rawClients.length, 1, JSON.stringify(rawClients));
  assert.equal(rawAdapters.length, 1, JSON.stringify(rawAdapters));
  assert.deepEqual(
    escaped,
    [],
    `Raw OpenAI client escaped factory boundary:\n${escaped
      .map((finding) => `${finding.file}:${finding.line}`)
      .join("\n")}`,
  );
});
