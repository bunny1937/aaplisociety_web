const fs = require("fs");
const path = require("path");
const parser = require("@babel/parser");
const traverse = require("@babel/traverse").default;
const { resolveFile } = require("./resolveFile");

const input = process.argv[2];

if (!input) {
  console.error("❌ Provide entry file");
  process.exit(1);
}

const edges = [];

function extractImports(filePath) {
  const code = fs.readFileSync(filePath, "utf-8");

  const ast = parser.parse(code, {
    sourceType: "module",
    plugins: ["jsx", "typescript"],
  });

  const imports = [];

  traverse(ast, {
    ImportDeclaration({ node }) {
      imports.push(node.source.value);
    },
  });

  return imports;
}

function classifyNode(file) {
  const normalized = file.replace(/\\/g, "/"); // 🔥 fix

  if (normalized.includes("/api/")) return "api";
  if (
    normalized.includes("/admin/") ||
    normalized.includes("/member/") ||
    normalized.includes("/superadmin/") ||
    normalized.includes("/auth/")
  )
    return "ui";
  if (normalized.includes("/lib/") || normalized.includes("/models/"))
    return "core";
  return "other";
}

const visited = new Set();
const stackSet = new Set();

function buildGraph(filePath, depth = 0) {
  if (depth > 5) return;
  if (visited.has(filePath)) return;

  visited.add(filePath);
  stackSet.add(filePath);

  const dir = path.dirname(filePath);

  let imports = [];
  try {
    imports = extractImports(filePath);
  } catch {
    return;
  }

  imports.forEach((imp) => {
    const resolved = resolveFile(imp, dir);
    if (!resolved) return;

    edges.push([filePath, resolved]);

    if (stackSet.has(resolved)) {
      console.log("🔁 Circular:", filePath, "→", resolved);
    }

    buildGraph(resolved, depth + 1); // ✅ FIX
  });

  stackSet.delete(filePath);
}

// 🔥 run
const entry = path.resolve(input);
buildGraph(entry);

// 🔥 build DOT graph
let dot = "digraph G {\nrankdir=LR;\n";

// styles
dot += `node [shape=box, style=filled, fontname="Arial"];\n`;

edges.forEach(([from, to]) => {
  const fromType = classifyNode(from);
  const toType = classifyNode(to);

  let color = "black";

  // 🎯 API → UI flow
  if (fromType === "ui" && toType === "api") {
    color = "blue";
  }

  dot += `"${from}" -> "${to}" [color=${color}];\n`;
});

// node coloring
visited.forEach((file) => {
  const type = classifyNode(file);

  let fill = "white";

  if (type === "api") fill = "lightcoral";
  else if (type === "ui") fill = "lightblue";
  else if (type === "core") fill = "lightgreen";

  dot += `"${file}" [fillcolor=${fill}];\n`;
});

dot += "}";

const safeName = input.replace(/[^\w]/g, "_");

fs.writeFileSync(`${safeName}_graph.dot`, dot);

try {
  require("child_process").execSync(
    `dot -Tpng ${safeName}_graph.dot -o ${safeName}_graph.png`,
  );
  console.log(`🖼 ${safeName}_graph.png generated`);
} catch {
  console.log("⚠️ Install Graphviz to generate image");
}

try {
  require("child_process").execSync("dot -Tpng graph.dot -o graph.png");
  console.log("🖼 graph.png generated");
} catch {
  console.log("⚠️ Install Graphviz to generate image");
}
