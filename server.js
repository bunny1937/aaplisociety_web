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
    handle(req, res, parsedUrl);
  });

  // Init Socket.IO attached to same HTTP server
  initSocketServer(server);

  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log(`> Server running on http://localhost:${PORT}`);
  });
});
