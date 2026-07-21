import express from "express";
import { spawn } from "child_process";
const app = express();
app.use(express.json());
app.post("/mcp", async (req, res) => {
  // You can proxy MCP logic here
  res.json({ message: "MCP endpoint working" });
});
app.listen(3005, () => {
  console.log("MCP HTTP running on http://localhost:3005/mcp");
});
