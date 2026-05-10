const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const config = require("../debug.config");
const { buildGraph } = require("./importGraph");

const input = process.argv[2];

if (!input) {
  console.error("❌ Provide path, keyword, or 'diff'");
  process.exit(1);
}

// 🔥 Normalize input (IMPORTANT)
const cleanedInput = input.replace(/\s+/g, "");

// 🔥 git diff mode (FIXED)
function getGitChangedFiles() {
  try {
    const output = execSync("git diff --name-only HEAD", {
      encoding: "utf-8",
    });

    return output
      .split("\n")
      .map((f) => f.trim())
      .filter(
        (f) =>
          f &&
          (f.endsWith(".js") ||
            f.endsWith(".ts") ||
            f.endsWith(".jsx") ||
            f.endsWith(".tsx")),
      );
  } catch {
    return [];
  }
}

// 🔥 Smart file resolver (CRITICAL FIX)
function resolveSmartFile(part) {
  const possible = [part, `app/${part}`, `lib/${part}`, `models/${part}`];

  for (const p of possible) {
    if (fs.existsSync(p) && fs.lstatSync(p).isFile()) {
      return p;
    }
  }

  return null;
}

let parts = [];

// 🔥 diff mode
if (cleanedInput === "diff") {
  console.log("🧠 Using git diff mode...");

  const changedFiles = getGitChangedFiles();

  if (!changedFiles.length) {
    console.error("❌ No changed files");
    process.exit(1);
  }

  parts = changedFiles;
} else {
  parts = cleanedInput.split(/[,|]/).filter(Boolean);
}

let includePaths = [];

// 🔥 full app only if explicitly requested
if (parts.includes("app")) {
  includePaths.push("app/**");
}

parts.forEach((part) => {
  // ✅ 1. FILE MODE (SMART)
  if (
    part.endsWith(".js") ||
    part.endsWith(".ts") ||
    part.endsWith(".jsx") ||
    part.endsWith(".tsx")
  ) {
    const resolvedFile = resolveSmartFile(part);

    if (resolvedFile) {
      console.log("🧠 Building import graph for:", resolvedFile);

      const files = buildGraph(path.resolve(resolvedFile));

      const relativeFiles = files.map((f) =>
        path.relative(process.cwd(), f).replace(/\\/g, "/"),
      );

      includePaths.push(...relativeFiles);
      return;
    }
  }

  // ✅ 2. DIRECT FILE PATH
  if (fs.existsSync(part) && fs.lstatSync(part).isFile()) {
    console.log("🧠 Building import graph for:", part);

    const files = buildGraph(path.resolve(part));

    const relativeFiles = files.map((f) =>
      path.relative(process.cwd(), f).replace(/\\/g, "/"),
    );

    includePaths.push(...relativeFiles);
    return;
  }

  // ✅ 3. DIRECTORY MODE
  if (fs.existsSync(part) && fs.lstatSync(part).isDirectory()) {
    includePaths.push(part + "/**");
    return;
  }

  // ✅ 4. APP PATH MODE
  if (part.startsWith("app/")) {
    includePaths.push(part + "/**");
    return;
  }
  // 🔥 DOMAIN MODE (NEW)
  if (config.domains && config.domains[part]) {
    console.log("🧠 Using domain config for:", part);
    includePaths.push(...config.domains[part]);
    return;
  }
  // ✅ 5. KEYWORD MODE
  includePaths.push(`app/api/${part}/**`);
  includePaths.push(`app/admin/${part}/**`);
  includePaths.push(`app/member/${part}/**`);
  includePaths.push(`app/superadmin/${part}/**`);
  includePaths.push(`app/${part}/**`);
});

// ✅ shared (minimal, not heavy)
includePaths.push(...(config.shared?.include || []));

// ✅ middleware safety
if (fs.existsSync("middleware.js")) includePaths.push("middleware.js");
if (fs.existsSync("middleware.ts")) includePaths.push("middleware.ts");

// ✅ cleanup
includePaths = [...new Set(includePaths)].filter(Boolean);

// ✅ normalize paths
const normalizedPaths = includePaths.map((p) => p.replace(/\\/g, "/"));

const includeArg = normalizedPaths.join(",");
const ignoreArg = config.baseIgnore;

console.log("INCLUDE:", includeArg);

const safeName = input.replace(/[^\w]/g, "_");
const outputFile = `${safeName}_DEBUG.txt`;
const command = `npx repomix@latest --output "${outputFile}" --ignore "${ignoreArg}" --include "${includeArg}"`;

console.log("🚀 Running:", command);

try {
  execSync(command, { stdio: "inherit" });

  // 🔥 attach error log
  if (fs.existsSync("error.log")) {
    console.log("📎 Attaching error.log...");

    fs.appendFileSync(outputFile, "\n\n=== ERROR LOG ===\n");
    fs.appendFileSync(outputFile, fs.readFileSync("error.log", "utf-8"));
  }

  console.log(`\n✅ Context generated: ${outputFile}`);
} catch {
  console.error("❌ Failed");
}
