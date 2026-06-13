import { createServer } from "http";
import { parse } from "url";
import next from "next";
import { initSocketServer } from "./lib/socket-server.js";

const dev = process.env.NODE_ENV !== "production";
const app = next({ dev });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url, true);
    const start = Date.now();
    res.on("finish", () => {
      const ms = Date.now() - start;
      const color = res.statusCode >= 500 ? "\x1b[31m" : res.statusCode >= 400 ? "\x1b[33m" : "\x1b[32m";
      console.log(`${color}${res.statusCode}\x1b[0m ${req.method} ${req.url} \x1b[90m${ms}ms\x1b[0m`);
    });
    handle(req, res, parsedUrl);
  });

  // Init Socket.IO attached to same HTTP server
  initSocketServer(server);

  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log(`> Server running on http://localhost:${PORT}`);
  });
});
