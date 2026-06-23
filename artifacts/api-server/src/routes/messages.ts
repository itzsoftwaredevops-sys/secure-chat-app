import { Router, type IRouter } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { MessageModel } from "../models/Message.js";
import { authMiddleware, type AuthRequest } from "../middlewares/auth.js";
import { encryptMessage, decryptMessage } from "../lib/encryption.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

const sendMessageSchema = z.object({
  receiverId: z.string().min(1),
  message: z.string().min(1),
  timer: z.number().int().positive().nullable().optional(),
});

function formatMessage(msg: InstanceType<typeof MessageModel>) {
  const plainText = decryptMessage(msg.encryptedMessage);
  return {
    id: msg._id.toString(),
    senderId: msg.senderId.toString(),
    receiverId: msg.receiverId.toString(),
    encryptedMessage: msg.encryptedMessage,
    plainText: plainText || null,
    timer: msg.timer ?? null,
    expiresAt: msg.expiresAt ? msg.expiresAt.toISOString() : null,
    isRead: msg.isRead,
    createdAt: (msg as any).createdAt?.toISOString?.() ?? new Date().toISOString(),
  };
}

router.get("/messages/:userId", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const currentUserId = new mongoose.Types.ObjectId(req.userId);
    const otherUserId = new mongoose.Types.ObjectId(req.params["userId"] as string);

    const messages = await MessageModel.find({
      $or: [
        { senderId: currentUserId, receiverId: otherUserId },
        { senderId: otherUserId, receiverId: currentUserId },
      ],
    }).sort({ createdAt: 1 });

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
    const encryptedMessage = encryptMessage(message);

    let expiresAt: Date | null = null;
    if (timer && timer > 0) {
      expiresAt = new Date(Date.now() + timer * 1000);
    }

    const msg = await MessageModel.create({
      senderId: new mongoose.Types.ObjectId(req.userId),
      receiverId: new mongoose.Types.ObjectId(receiverId),
      encryptedMessage,
      timer: timer ?? null,
      expiresAt,
      isRead: false,
    });

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
    const msg = await MessageModel.findOneAndUpdate(
      { _id: req.params["id"], receiverId: new mongoose.Types.ObjectId(req.userId) },
      { isRead: true },
      { new: true },
    );

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
    const msg = await MessageModel.findOneAndDelete({
      _id: req.params["id"],
      $or: [
        { senderId: new mongoose.Types.ObjectId(req.userId) },
        { receiverId: new mongoose.Types.ObjectId(req.userId) },
      ],
    });

    if (!msg) {
      res.status(404).json({ error: "Message not found" });
      return;
    }

    const io = (req as any).io;
    if (io) {
      io.to(msg.senderId.toString()).emit("messageExpired", { id: req.params["id"] });
      io.to(msg.receiverId.toString()).emit("messageExpired", { id: req.params["id"] });
    }

    res.json({ success: true, message: "Message deleted" });
  } catch (err) {
    logger.error({ err }, "DeleteMessage error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export { formatMessage };
export default router;
