import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { execSync } from "child_process";
import fs from "fs";
// 🔥 Create MCP server
const server = new Server(
  {
    name: "dev-debug-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  },
);
// 🔥 ANALYZE TOOL
server.setRequestHandler("tools/call", async (req) => {
  const { name, arguments: args } = req.params;
  try {
    if (name === "analyze") {
      execSync(`node scripts/analyze.js "${args.input}"`, {
        stdio: "inherit",
      });
      const context = fs.existsSync("DEBUG_SMART.txt")
        ? fs.readFileSync("DEBUG_SMART.txt", "utf-8")
        : "";
      const diff = fs.existsSync("DEBUG_DIFF.txt")
        ? fs.readFileSync("DEBUG_DIFF.txt", "utf-8")
        : "";
      return {
        content: [
          {
            type: "text",
            text: `### CONTEXT ###\n${context}\n\n### DIFF ###\n${diff}`,
          },
        ],
      };
    }
    if (name === "debug") {
      execSync(`node scripts/debug.js "${args.input}"`, {
        stdio: "inherit",
      });
      const context = fs.readFileSync("DEBUG_SMART.txt", "utf-8");
      return {
        content: [{ type: "text", text: context }],
      };
    }
    if (name === "diff") {
      execSync(`node scripts/diff.js "${args.input}"`, {
        stdio: "inherit",
      });
      const diff = fs.readFileSync("DEBUG_DIFF.txt", "utf-8");
      return {
        content: [{ type: "text", text: diff }],
      };
    }
    return {
      content: [{ type: "text", text: "❌ Unknown tool" }],
    };
  } catch (err) {
    return {
      content: [{ type: "text", text: "❌ MCP execution failed" }],
    };
  }
});
// 🔥 Tool definitions (IMPORTANT)
server.setRequestHandler("tools/list", async () => {
  return {
    tools: [
      {
        name: "analyze",
        description: "Run full project analysis (context + diff + graph)",
        inputSchema: {
          type: "object",
          properties: {
            input: { type: "string" },
          },
          required: ["input"],
        },
      },
      {
        name: "debug",
        description: "Generate context only",
        inputSchema: {
          type: "object",
          properties: {
            input: { type: "string" },
          },
          required: ["input"],
        },
      },
      {
        name: "diff",
        description: "Generate git diff",
        inputSchema: {
          type: "object",
          properties: {
            input: { type: "string" },
          },
          required: ["input"],
        },
      },
    ],
  };
});
// 🔥 Start server (stdio mode)
server.listen();
