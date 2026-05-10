const fs = require("fs");
const path = require("path");

const projectRoot = process.cwd();

const EXTENSIONS = [".js", ".ts", ".jsx", ".tsx"];

// 🔥 resolve @/ alias
function resolveAlias(importPath) {
  if (importPath.startsWith("@/")) {
    return path.join(projectRoot, importPath.replace("@/", ""));
  }
  return null;
}

// 🔥 resolve file with extensions + index fallback
function resolveWithExtensions(basePath) {
  if (!basePath) return null;

  // direct file
  if (fs.existsSync(basePath) && fs.lstatSync(basePath).isFile()) {
    return basePath;
  }

  // try extensions
  for (const ext of EXTENSIONS) {
    const file = basePath + ext;
    if (fs.existsSync(file)) return file;
  }

  // try index files
  for (const ext of EXTENSIONS) {
    const indexFile = path.join(basePath, "index" + ext);
    if (fs.existsSync(indexFile)) return indexFile;
  }

  return null;
}

// 🔥 main resolver
function resolveFile(importPath, baseDir) {
  let basePath = null;

  if (importPath.startsWith("@/")) {
    basePath = resolveAlias(importPath);
  } else if (importPath.startsWith(".")) {
    basePath = path.resolve(baseDir, importPath);
  } else {
    return null; // ignore node_modules
  }

  return resolveWithExtensions(basePath);
}

module.exports = { resolveFile };