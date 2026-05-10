const { execSync } = require("child_process");
const fs = require("fs");

const input = process.argv[2];

if (!input) {
  console.error("❌ Provide file(s) or 'diff'");
  process.exit(1);
}

function normalizeFile(file) {
  if (fs.existsSync(file)) return file;

  const guesses = [`app/${file}`, `lib/${file}`, `models/${file}`];

  for (const g of guesses) {
    if (fs.existsSync(g)) return g;
  }

  return null;
}

let files = [];

if (input === "diff") {
  const output = execSync("git diff --name-only HEAD", { encoding: "utf-8" });
  files = output.split("\n").filter(Boolean);
} else {
  files = input
    .split(/[,|]/)
    .map((f) => f.trim())
    .filter(Boolean);
}

let finalDiff = "";

files.forEach((file) => {
  const normalized = normalizeFile(file);

  if (!normalized) {
    console.warn(`⚠️ Skipping invalid file: ${file}`);
    return;
  }

  try {
    const diff = execSync(`git diff HEAD -- "${normalized}"`, {
      encoding: "utf-8",
    });

    if (diff.trim()) {
      finalDiff += `\n\n===== ${normalized} =====\n\n`;
      finalDiff += diff;
    }
  } catch {
    console.warn(`⚠️ Error reading diff: ${file}`);
  }
});

if (!finalDiff.trim()) {
  console.warn("⚠️ No diffs found");
}

const safeName = input.replace(/[^\w]/g, "_");
const outputFile = `${safeName}_DIFF.txt`;

fs.writeFileSync(outputFile, finalDiff);

console.log(`✅ ${outputFile} generated`);
