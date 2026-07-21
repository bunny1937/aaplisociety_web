import { Server } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import jwt from "jsonwebtoken";
import redis from "./redis.js";
let io;
// Attempts a Redis-backed adapter so this socket layer can scale to more
// than one instance (previously single-instance only — see the migration
// audit's Phase 6 finding). Falls back to the in-memory default adapter if
// Redis is unreachable, so a Redis outage degrades this to "single instance
// works, multi-instance realtime doesn't fan out" rather than crashing the
// whole app — the existing `redis.js` client already treats Redis as
// optional (used elsewhere only for caching).
async function attachRedisAdapter(io) {
  try {
    const pubClient = redis.duplicate();
    const subClient = redis.duplicate();
    pubClient.on("error", (err) => console.warn("[socket] Redis pub client error:", err.message));
    subClient.on("error", (err) => console.warn("[socket] Redis sub client error:", err.message));
    await Promise.all([pubClient.connect(), subClient.connect()]);
    io.adapter(createAdapter(pubClient, subClient));
    console.log("[socket] Redis adapter attached — horizontally scalable");
  } catch (err) {
    console.warn("[socket] Redis adapter unavailable, falling back to single-instance in-memory adapter:", err.message);
  }
}
export async function initSocketServer(httpServer) {
  if (io) return io;
  io = new Server(httpServer, {
    path: "/api/socket",
    cors: {
      origin: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
      methods: ["GET", "POST"],
      credentials: true,
    },
  });
  await attachRedisAdapter(io);
  // Auth middleware — validate JWT from handshake auth
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error("Unauthorized"));
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.user = decoded; // attach user to socket
      next();
    } catch {
      next(new Error("Invalid token"));
    }
  });
  io.on("connection", (socket) => {
    const { userId, societyId, memberId, role } = socket.user;
    // Join rooms
    socket.join(`society:${societyId}`); // all members of society
    socket.join(`user:${userId}`); // personal room
    if (role === "Member" && memberId) {
      socket.join(`member:${memberId}`);
    }
    // Wing room — only join if wing is a non-empty string (no cross-society joins)
    socket.on("join:wing", (wing) => {
      if (wing && typeof wing === "string" && wing.length <= 10 && /^[A-Za-z0-9]+$/.test(wing)) {
        socket.join(`wing:${societyId}:${wing}`);
      }
    });
    socket.on("disconnect", () => {});
  });
  return io;
}
export function getIO() {
  return io;
}
// Emit notification to targeted rooms
export function emitNotification(notification) {
  if (!io) return;
  const { societyId, recipientType, recipientIds } = notification;
  const payload = {
    _id: notification._id,
    type: notification.type,
    title: notification.title,
    message: notification.message,
    createdAt: notification.createdAt,
    actionUrl: notification.actionUrl,
    readBy: [],
  };
  if (recipientType === "all") {
    io.to(`society:${societyId}`).emit("notification:new", payload);
  } else if (recipientType === "member") {
    recipientIds.forEach((id) =>
      io.to(`member:${id}`).emit("notification:new", payload),
    );
  } else if (recipientType === "wing") {
    recipientIds.forEach((wing) =>
      io.to(`wing:${societyId}:${wing}`).emit("notification:new", payload),
    );
  } else if (recipientType === "flats") {
    // flatIds map to memberIds — emit to member rooms
    recipientIds.forEach((id) =>
      io.to(`member:${id}`).emit("notification:new", payload),
    );
  }
}
