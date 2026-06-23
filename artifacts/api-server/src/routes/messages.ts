import { Router, type IRouter } from "express";
import { z } from "zod";
import { db } from "../lib/db.js";
import { messagesTable } from "@workspace/db";
import { eq, and, or } from "drizzle-orm";
import { authMiddleware, type AuthRequest } from "../middlewares/auth.js";
import { encryptMessage, decryptMessage } from "../lib/encryption.js";
import { logger } from "../lib/logger.js";
import type { Message } from "@workspace/db";

const router: IRouter = Router();

const sendMessageSchema = z.object({
  receiverId: z.string().min(1),
  message: z.string().min(1),
  timer: z.number().int().positive().nullable().optional(),
});

export function formatMessage(msg: Message) {
  return {
    id: msg.id,
    senderId: msg.senderId,
    receiverId: msg.receiverId,
    encryptedMessage: msg.encryptedMessage,
    plainText: decryptMessage(msg.encryptedMessage) || null,
    timer: msg.timer ?? null,
    expiresAt: msg.expiresAt ? msg.expiresAt.toISOString() : null,
    isRead: msg.isRead,
    createdAt: msg.createdAt.toISOString(),
  };
}

router.get("/messages/:userId", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const currentUserId = req.userId!;
    const otherUserId = req.params["userId"] as string;

    const messages = await db
      .select()
      .from(messagesTable)
      .where(
        or(
          and(
            eq(messagesTable.senderId, currentUserId),
            eq(messagesTable.receiverId, otherUserId),
          ),
          and(
            eq(messagesTable.senderId, otherUserId),
            eq(messagesTable.receiverId, currentUserId),
          ),
        ),
      )
      .orderBy(messagesTable.createdAt);

    res.json(messages.map(formatMessage));
  } catch (err) {
    logger.error({ err }, "GetMessages error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/messages", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const body = sendMessageSchema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.issues[0]?.message ?? "Validation error" });
      return;
    }

    const { receiverId, message, timer } = body.data;
    const encrypted = encryptMessage(message);

    const expiresAt = timer && timer > 0
      ? new Date(Date.now() + timer * 1000)
      : null;

    const [msg] = await db
      .insert(messagesTable)
      .values({
        senderId: req.userId!,
        receiverId,
        encryptedMessage: encrypted,
        timer: timer ?? null,
        expiresAt,
      })
      .returning();

    const formatted = formatMessage(msg);

    const io = (req as any).io;
    if (io) {
      io.to(receiverId).emit("newMessage", formatted);
      io.to(req.userId!).emit("newMessage", formatted);
    }

    res.status(201).json(formatted);
  } catch (err) {
    logger.error({ err }, "SendMessage error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/messages/:id/read", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const [msg] = await db
      .update(messagesTable)
      .set({ isRead: true })
      .where(
        and(
          eq(messagesTable.id, req.params["id"] as string),
          eq(messagesTable.receiverId, req.userId!),
        ),
      )
      .returning();

    if (!msg) {
      res.status(404).json({ error: "Message not found" });
      return;
    }
    res.json(formatMessage(msg));
  } catch (err) {
    logger.error({ err }, "MarkMessageRead error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/messages/:id", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const [msg] = await db
      .delete(messagesTable)
      .where(
        and(
          eq(messagesTable.id, req.params["id"] as string),
          or(
            eq(messagesTable.senderId, req.userId!),
            eq(messagesTable.receiverId, req.userId!),
          ),
        ),
      )
      .returning();

    if (!msg) {
      res.status(404).json({ error: "Message not found" });
      return;
    }

    const io = (req as any).io;
    if (io) {
      io.to(msg.senderId).emit("messageExpired", { id: msg.id });
      io.to(msg.receiverId).emit("messageExpired", { id: msg.id });
    }

    res.json({ success: true, message: "Message deleted" });
  } catch (err) {
    logger.error({ err }, "DeleteMessage error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
