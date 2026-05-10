const fs = require("fs");
const path = require("path");
const parser = require("@babel/parser");
const traverse = require("@babel/traverse").default;

// ✅ import resolver (DON’T redefine it)
const { resolveFile } = require("./resolveFile");


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

function buildGraph(entryFile) {
      const visited = new Set(); // ✅ move here
  const stack = [entryFile];

  while (stack.length) {
    const current = stack.pop();

    if (!current || visited.has(current)) continue;
    visited.add(current);

    const dir = path.dirname(current);

    let imports = [];
    try {
      imports = extractImports(current);
    } catch {
      continue;
    }

    imports.forEach((imp) => {
      const resolved = resolveFile(imp, dir); // ✅ correct usage

      if (resolved && !visited.has(resolved)) {
        stack.push(resolved);
      }
    });
  }

  return Array.from(visited);
}

module.exports = { buildGraph };