import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import chalk from "chalk";

type InitFramework = "nextjs" | "express" | "hono" | "node";

export interface InitOptions {
  dir?: string;
  force?: boolean;
}

type PackageJson = {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

const ENV_TEMPLATE = [
  "SEECOST_INGEST_ENDPOINT=https://seecost.watch/api/tracker/ingest",
  "SEECOST_API_KEY=sc_replace_me",
  "SEECOST_DEBUG=false",
  "SEECOST_APP_NAME=my-app",
];

const INSTRUMENTATION_MARKER = "/* SeeCost instrumentation */";
const BOOTSTRAP_MARKER = "/* SeeCost bootstrap */";
const IMPORT_MARKER = "/* SeeCost import */";

export function buildInstrumentationBlock() {
  return [
    INSTRUMENTATION_MARKER,
    'import { initSeeCostTrackerFromEnv } from "@seecost/tracker";',
    "",
    "function ensureSeeCostTracker() {",
    "  initSeeCostTrackerFromEnv();",
    "}",
    "",
    "export async function register() {",
    '  if (process.env.NEXT_RUNTIME === "nodejs") {',
    "    ensureSeeCostTracker();",
    "  }",
    "}",
    "",
  ].join("\n");
}

function buildEnvLoaderPrelude(isCommonJs: boolean) {
  if (isCommonJs) {
    return [
      'const fs = require("node:fs");',
      'const path = require("node:path");',
      "",
      "function loadSeeCostEnv() {",
      '  const envPath = path.join(process.cwd(), ".env");',
      "  if (!fs.existsSync(envPath)) return;",
      '  const content = fs.readFileSync(envPath, "utf8");',
      "  for (const rawLine of content.split(/\\r?\\n/)) {",
      "    const line = rawLine.trim();",
      '    if (!line || line.startsWith("#")) continue;',
      '    const separatorIndex = line.indexOf("=");',
      "    if (separatorIndex <= 0) continue;",
      "    const key = line.slice(0, separatorIndex).trim();",
      "    if (!key || process.env[key] !== undefined) continue;",
      "    let value = line.slice(separatorIndex + 1).trim();",
      `    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {`,
      "      value = value.slice(1, -1);",
      "    }",
      "    process.env[key] = value;",
      "  }",
      "}",
      "",
      "loadSeeCostEnv();",
      "",
    ].join("\n");
  }

  return [
    'import * as fs from "node:fs";',
    'import * as path from "node:path";',
    "",
    "function loadSeeCostEnv() {",
    '  const envPath = path.join(process.cwd(), ".env");',
    "  if (!fs.existsSync(envPath)) return;",
    '  const content = fs.readFileSync(envPath, "utf8");',
    "  for (const rawLine of content.split(/\\r?\\n/)) {",
    "    const line = rawLine.trim();",
    '    if (!line || line.startsWith("#")) continue;',
    '    const separatorIndex = line.indexOf("=");',
    "    if (separatorIndex <= 0) continue;",
    "    const key = line.slice(0, separatorIndex).trim();",
    "    if (!key || process.env[key] !== undefined) continue;",
    "    let value = line.slice(separatorIndex + 1).trim();",
    `    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {`,
    "      value = value.slice(1, -1);",
    "    }",
    "    process.env[key] = value;",
    "  }",
    "}",
    "",
    "loadSeeCostEnv();",
    "",
  ].join("\n");
}

export function buildBootstrapContent(isCommonJs: boolean) {
  if (isCommonJs) {
    return [
      BOOTSTRAP_MARKER,
      buildEnvLoaderPrelude(true),
      "(async () => {",
      '  const { initSeeCostTrackerFromEnv } = await import("@seecost/tracker");',
      "  initSeeCostTrackerFromEnv();",
      "})();",
      "",
    ].join("\n");
  }

  return [
    BOOTSTRAP_MARKER,
    buildEnvLoaderPrelude(false),
    'import { initSeeCostTrackerFromEnv } from "@seecost/tracker";',
    "",
    "initSeeCostTrackerFromEnv();",
    "",
  ].join("\n");
}

export async function initCommand(framework: InitFramework, options: InitOptions): Promise<void> {
  const targetDir = path.resolve(options.dir ?? process.cwd());
  const pkg = await loadPackageJson(targetDir);

  switch (framework) {
    case "nextjs":
      assertNextJsProject(pkg, targetDir);
      await initNextJs(targetDir, options);
      return;
    case "express":
      assertDependencyProject(pkg, targetDir, "express");
      await initServerProject(targetDir, options, "express");
      return;
    case "hono":
      assertDependencyProject(pkg, targetDir, "hono");
      await initServerProject(targetDir, options, "hono");
      return;
    case "node":
      await initServerProject(targetDir, options, "node");
      return;
    default:
      throw new Error(`Unsupported framework: ${framework satisfies never}`);
  }
}

async function initNextJs(targetDir: string, options: InitOptions) {
  const envPath = path.join(targetDir, ".env.local");
  const instrumentationPath = await resolveInstrumentationPath(targetDir);

  await ensureEnvFile(envPath);
  await ensureInstrumentationFile(instrumentationPath, options.force ?? false);

  console.log("");
  console.log(chalk.bold.cyan("SeeCost init complete"));
  console.log(`  project: ${chalk.white(targetDir)}`);
  console.log(`  env: ${chalk.white(path.relative(targetDir, envPath) || ".env.local")}`);
  console.log(
    `  instrumentation: ${chalk.white(path.relative(targetDir, instrumentationPath))}`
  );
  console.log("");
  console.log("Next steps:");
  console.log("  1. Open `.env.local` and replace `SEECOST_API_KEY=sc_replace_me` with a real key.");
  console.log("  2. Restart `next dev` or your server process.");
  console.log("  3. Make one OpenAI / Anthropic / Gemini request and confirm it appears in SeeCost.");
  console.log("");
}

async function initServerProject(
  targetDir: string,
  options: InitOptions,
  framework: "express" | "hono" | "node"
) {
  const envPath = path.join(targetDir, ".env");
  const { entryPath, bootstrapPath } = await resolveServerPaths(targetDir);

  await ensureEnvFile(envPath);
  await ensureServerBootstrapFile(bootstrapPath, options.force ?? false);
  await ensureEntryImport(entryPath, bootstrapPath, options.force ?? false);

  console.log("");
  console.log(chalk.bold.cyan("SeeCost init complete"));
  console.log(`  project: ${chalk.white(targetDir)}`);
  console.log(`  framework: ${chalk.white(framework)}`);
  console.log(`  env: ${chalk.white(path.relative(targetDir, envPath) || ".env")}`);
  console.log(`  bootstrap: ${chalk.white(path.relative(targetDir, bootstrapPath))}`);
  console.log(`  entry: ${chalk.white(path.relative(targetDir, entryPath))}`);
  console.log("");
  console.log("Next steps:");
  console.log("  1. Open the env file and replace `SEECOST_API_KEY=sc_replace_me` with a real key.");
  console.log("  2. Restart your server process.");
  console.log("  3. Make one OpenAI / Anthropic / Gemini request and confirm it appears in SeeCost.");
  console.log("");
}

async function loadPackageJson(targetDir: string): Promise<PackageJson> {
  const packageJsonPath = path.join(targetDir, "package.json");
  let raw: string;

  try {
    raw = await readFile(packageJsonPath, "utf8");
  } catch {
    throw new Error(`package.json not found in ${targetDir}`);
  }

  try {
    return JSON.parse(raw) as PackageJson;
  } catch {
    throw new Error(`package.json in ${targetDir} is not valid JSON`);
  }
}

function assertNextJsProject(pkg: PackageJson, targetDir: string) {
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  if (!deps.next) {
    throw new Error(`No \`next\` dependency found in ${targetDir}. This command currently supports Next.js only.`);
  }
}

function assertDependencyProject(pkg: PackageJson, targetDir: string, dependency: string) {
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  if (!deps[dependency]) {
    throw new Error(`No \`${dependency}\` dependency found in ${targetDir}.`);
  }
}

async function resolveInstrumentationPath(targetDir: string) {
  const srcDir = path.join(targetDir, "src");
  const useSrcDir = await exists(srcDir);
  return path.join(useSrcDir ? srcDir : targetDir, "instrumentation.ts");
}

async function resolveServerPaths(targetDir: string) {
  const candidates = [
    "src/index.ts",
    "src/server.ts",
    "src/app.ts",
    "index.ts",
    "server.ts",
    "app.ts",
    "src/index.mts",
    "src/server.mts",
    "src/app.mts",
    "src/index.cts",
    "src/server.cts",
    "src/app.cts",
    "index.mts",
    "server.mts",
    "app.mts",
    "index.cts",
    "server.cts",
    "app.cts",
    "src/index.js",
    "src/server.js",
    "src/app.js",
    "index.js",
    "server.js",
    "app.js",
    "src/index.mjs",
    "src/server.mjs",
    "src/app.mjs",
    "index.mjs",
    "server.mjs",
    "app.mjs",
    "src/index.cjs",
    "src/server.cjs",
    "src/app.cjs",
    "index.cjs",
    "server.cjs",
    "app.cjs",
  ];

  const entryPath = await findFirstExisting(targetDir, candidates);
  if (!entryPath) {
    throw new Error(
      `Could not find a server entry file. Expected one of: ${candidates.join(", ")}`
    );
  }

  const extension = path.extname(entryPath);
  const baseDir = path.dirname(entryPath);
  const bootstrapPath = path.join(baseDir, `seecost.bootstrap${extension}`);

  return { entryPath, bootstrapPath };
}

async function ensureEnvFile(envPath: string) {
  const existing = (await exists(envPath)) ? await readFile(envPath, "utf8") : "";
  const nextContent = appendMissingLines(existing, ENV_TEMPLATE);
  if (nextContent !== existing) {
    await writeFile(envPath, nextContent, "utf8");
  }
}

async function ensureInstrumentationFile(filePath: string, force: boolean) {
  await mkdir(path.dirname(filePath), { recursive: true });

  const block = buildInstrumentationBlock();

  if (!(await exists(filePath))) {
    await writeFile(filePath, block, "utf8");
    return;
  }

  const current = await readFile(filePath, "utf8");
  if (current.includes(INSTRUMENTATION_MARKER)) {
    return;
  }

  if (!force) {
    throw new Error(
      `${path.basename(filePath)} already exists. Re-run with --force to append SeeCost registration.`
    );
  }

  const merged = mergeInstrumentationIntoExistingFile(current);
  await writeFile(filePath, merged, "utf8");
}

async function ensureServerBootstrapFile(filePath: string, force: boolean) {
  await mkdir(path.dirname(filePath), { recursive: true });

  const ext = path.extname(filePath);
  const isCommonJs = ext === ".cjs" || ext === ".cts";
  const content = buildBootstrapContent(isCommonJs);

  if (!(await exists(filePath))) {
    await writeFile(filePath, content, "utf8");
    return;
  }

  const current = await readFile(filePath, "utf8");
  if (current.includes(BOOTSTRAP_MARKER)) return;

  if (!force) {
    throw new Error(
      `${path.basename(filePath)} already exists. Re-run with --force to append SeeCost bootstrap.`
    );
  }

  await writeFile(filePath, current.trimEnd() + "\n\n" + content, "utf8");
}

async function ensureEntryImport(entryPath: string, bootstrapPath: string, force: boolean) {
  const current = await readFile(entryPath, "utf8");
  if (current.includes(IMPORT_MARKER)) {
    return;
  }

  const ext = path.extname(entryPath);
  const isCommonJs = ext === ".cjs" || ext === ".cts";
  const importPath = relativeImportPath(entryPath, bootstrapPath, isCommonJs);
  const statement = isCommonJs
    ? `${IMPORT_MARKER}\nrequire("${importPath}");\n\n`
    : `${IMPORT_MARKER}\nimport "${importPath}";\n\n`;

  if (!force && hasTopLevelSeeCostConflict(current)) {
    throw new Error(
      `${path.basename(entryPath)} already contains SeeCost-related code. Re-run with --force to prepend the bootstrap import.`
    );
  }

  await writeFile(entryPath, prependSafely(current, statement), "utf8");
}

function mergeInstrumentationIntoExistingFile(current: string) {
  const registerPattern = /export\s+(?:async\s+)?function\s+register\s*\(\)\s*\{/;
  if (registerPattern.test(current)) {
    let next = current;

    if (!current.includes('import { initSeeCostTrackerFromEnv } from "@seecost/tracker";')) {
      next = `${INSTRUMENTATION_MARKER}\nimport { initSeeCostTrackerFromEnv } from "@seecost/tracker";\n\n${next}`;
    }

    if (!next.includes("initSeeCostTrackerFromEnv();")) {
      next = next.replace(registerPattern, (match) => `${match}\n  ${INSTRUMENTATION_MARKER}\n  if (process.env.NEXT_RUNTIME === "nodejs") {\n    initSeeCostTrackerFromEnv();\n  }`);
    }

    return next;
  }

  return current.trimEnd() + "\n\n" + buildInstrumentationBlock();
}

function hasTopLevelSeeCostConflict(content: string) {
  return content.includes("@seecost/tracker") || content.includes("initSeeCostTracker");
}

function relativeImportPath(fromPath: string, toPath: string, preserveExtension = false) {
  let relativePath = path.relative(path.dirname(fromPath), toPath).replace(/\\/g, "/");
  if (!relativePath.startsWith(".")) {
    relativePath = `./${relativePath}`;
  }
  if (preserveExtension) {
    return relativePath;
  }
  return relativePath.replace(/\.(ts|js|mts|mjs|cjs|cts)$/, "");
}

function prependSafely(current: string, statement: string) {
  let insertionIndex = 0;

  if (current.startsWith("#!")) {
    const newlineIndex = current.indexOf("\n");
    if (newlineIndex === -1) {
      return `${current}\n${statement}`;
    }
    insertionIndex = newlineIndex + 1;
  }

  const directivePattern = /^(?:\s*)(['"]use strict['"];?\s*)/;
  const remaining = current.slice(insertionIndex);
  const directiveMatch = remaining.match(directivePattern);
  if (directiveMatch && directiveMatch.index === 0) {
    insertionIndex += directiveMatch[0].length;
    if (!remaining.slice(directiveMatch[0].length).startsWith("\n")) {
      statement = `\n${statement}`;
    }
  }

  return `${current.slice(0, insertionIndex)}${statement}${current.slice(insertionIndex)}`;
}

async function findFirstExisting(targetDir: string, candidates: string[]) {
  for (const candidate of candidates) {
    const fullPath = path.join(targetDir, candidate);
    if (await exists(fullPath)) {
      return fullPath;
    }
  }

  return null;
}

function appendMissingLines(existing: string, lines: string[]) {
  const normalized = existing;
  const missing = lines.filter((line) => !normalized.includes(line.split("=")[0] + "="));
  if (missing.length === 0) {
    return existing;
  }

  const separator = existing.length === 0 ? "" : existing.endsWith("\n") ? "" : "\n";
  return existing + separator + missing.join("\n") + "\n";
}

async function exists(filePath: string) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}
