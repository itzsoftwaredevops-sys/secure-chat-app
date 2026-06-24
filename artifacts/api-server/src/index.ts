import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import jwt from "jsonwebtoken";
import app from "./app.js";
import { logger } from "./lib/logger.js";
import { db } from "./lib/db.js";
import { usersTable, messagesTable } from "@workspace/db";
import { eq, lte, and, isNotNull, ne } from "drizzle-orm";

const rawPort = process.env["PORT"];
if (!rawPort) throw new Error("PORT environment variable is required but was not provided.");
const port = Number(rawPort);
if (Number.isNaN(port) || port <= 0) throw new Error(`Invalid PORT value: "${rawPort}"`);

const JWT_SECRET = process.env.JWT_SECRET ?? "fallback-dev-secret-change-in-prod";

const httpServer = createServer(app);

const io = new SocketIOServer(httpServer, {
  cors: { origin: true, credentials: true },
  path: "/socket.io",
});

(app as any).io = io;

io.use((socket, next) => {
  const token = socket.handshake.auth?.["token"] as string | undefined;
  if (!token) { next(new Error("No token")); return; }
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
    (socket as any).userId = decoded.userId;
    next();
  } catch {
    next(new Error("Invalid token"));
  }
});

io.on("connection", async (socket) => {
  const userId = (socket as any).userId as string;
  logger.info({ userId }, "Socket connected");
  socket.join(userId);

  try {
    await db.update(usersTable).set({ isOnline: true }).where(eq(usersTable.id, userId));
    io.emit("userOnline", { userId });

    // Mark all undelivered messages sent TO this user as delivered,
    // then notify each sender so they can upgrade their tick.
    const undelivered = await db
      .update(messagesTable)
      .set({ isDelivered: true })
      .where(
        and(
          eq(messagesTable.receiverId, userId),
          eq(messagesTable.isDelivered, false),
        ),
      )
      .returning({ id: messagesTable.id, senderId: messagesTable.senderId });

    for (const msg of undelivered) {
      // Tell the original sender their message was delivered
      io.to(msg.senderId).emit("messageDelivered", { id: msg.id });
    }
  } catch (err) {
    logger.error({ err }, "Error on socket connect");
  }

  socket.on("typing", ({ receiverId }: { receiverId: string }) => {
    socket.to(receiverId).emit("typing", { userId });
  });

  socket.on("stopTyping", ({ receiverId }: { receiverId: string }) => {
    socket.to(receiverId).emit("stopTyping", { userId });
  });

  socket.on("disconnect", async () => {
    logger.info({ userId }, "Socket disconnected");
    try {
      await db.update(usersTable).set({ isOnline: false, lastSeen: new Date() }).where(eq(usersTable.id, userId));
      io.emit("userOffline", { userId });
    } catch (err) {
      logger.error({ err }, "Error setting user offline");
    }
  });
});

httpServer.listen(port, () => {
  logger.info({ port }, "Server listening");
});

// ── Background sweeper: hard-delete expired self-destructing messages ──
async function sweepExpiredMessages() {
  try {
    const expired = await db
      .delete(messagesTable)
      .where(and(isNotNull(messagesTable.expiresAt), lte(messagesTable.expiresAt, new Date())))
      .returning({ id: messagesTable.id, senderId: messagesTable.senderId, receiverId: messagesTable.receiverId });

    for (const msg of expired) {
      io.to(msg.senderId).emit("messageExpired", { id: msg.id });
      io.to(msg.receiverId).emit("messageExpired", { id: msg.id });
    }

    if (expired.length > 0) {
      logger.info({ count: expired.length }, "Swept expired messages");
    }
  } catch (err) {
    logger.error({ err }, "Sweeper error");
  }
}

setInterval(sweepExpiredMessages, 15_000);
