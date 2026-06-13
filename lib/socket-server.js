import { Server } from "socket.io";
import jwt from "jsonwebtoken";

let io;

export function initSocketServer(httpServer) {
  if (io) return io;

  io = new Server(httpServer, {
    path: "/api/socket",
    cors: {
      origin: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
      methods: ["GET", "POST"],
      credentials: true,
    },
  });

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
