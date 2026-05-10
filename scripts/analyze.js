const { execSync } = require("child_process");
const fs = require("fs");
const { exec } = require("child_process");

function openURL(url) {
  try {
    // Windows
    const platform = process.platform;

    if (platform === "win32") {
      exec(`start "" "${url}"`);
    } else if (platform === "darwin") {
      exec(`open "${url}"`);
    } else {
      exec(`xdg-open "${url}"`);
    }
  } catch {
    console.log("⚠️ Failed to open browser");
  }
}
const readline = require("readline-sync");

const input = process.argv[2];

if (!input) {
  console.error("❌ Provide input");
  process.exit(1);
}

try {
  console.log("🔍 Running DEBUG...");
  execSync(`node scripts/debug.js "${input}"`, { stdio: "inherit" });

  console.log("🧾 Generating DIFF...");
  execSync(`node scripts/diff.js "${input}"`, { stdio: "inherit" });

  console.log("📊 Generating GRAPH...");
  const firstTarget = input.split(/[,|]/)[0];
  execSync(`node scripts/graph.js "${firstTarget}"`, {
    stdio: "inherit",
  });
} catch (err) {
  console.error("❌ Error during analyze step");
}

// 🔥 Read files
const safeName = input.replace(/[^\w]/g, "_");

const contextFile = `${safeName}_DEBUG.txt`;
const diffFile = `${safeName}_DIFF.txt`;

const context = fs.existsSync(contextFile)
  ? fs.readFileSync(contextFile, "utf-8")
  : "";

const diff = fs.existsSync(diffFile) ? fs.readFileSync(diffFile, "utf-8") : "";

// 🔥 Build AI prompt
const finalPrompt = `
You are an expert full-stack developer.

### CONTEXT ###
${context}

### DIFF ###
${diff}

### TASK ###
1. Identify root cause
2. Fix the issue
3. Suggest improvements
4. Detect hidden bugs
`;

// ✅ Copy to clipboard
const clipboard = require("clipboardy").default;
clipboard.writeSync(finalPrompt);

console.log("\n📋 Prompt copied to clipboard");

// 🔥 AI selection
console.log("\nWhere do you want to open?");
console.log("1. ChatGPT");
console.log("2. Claude");
console.log("3. Perplexity");
console.log("4. Skip");

const choice = readline.question("\nEnter choice: ");

let url = null;

switch (choice) {
  case "1":
    url = "https://chat.openai.com";
    break;
  case "2":
    url = "https://claude.ai";
    break;
  case "3":
    url = "https://www.perplexity.ai";
    break;
  default:
    console.log("⏭ Skipped opening browser");
}

// 🌐 Open selected platform
if (url) {
  console.log(`🌐 Opening ${url}`);
  openURL(url);
}

console.log("\n✅ ANALYSIS COMPLETE");
console.log("Generated:");
console.log(`- ${contextFile}`);
console.log(`- ${diffFile}`);
console.log("- graph.dot / graph.png");
