import { Router, type IRouter } from "express";
import mongoose from "mongoose";
import { MessageModel } from "../models/Message.js";
import { UserModel } from "../models/User.js";
import { authMiddleware, type AuthRequest } from "../middlewares/auth.js";
import { formatUser } from "./auth.js";
import { formatMessage } from "./messages.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

router.get("/conversations", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const currentUserId = new mongoose.Types.ObjectId(req.userId);

    const messages = await MessageModel.find({
      $or: [{ senderId: currentUserId }, { receiverId: currentUserId }],
    }).sort({ createdAt: -1 });

    const conversationMap = new Map<
      string,
      { lastMessage: InstanceType<typeof MessageModel>; unreadCount: number }
    >();

    for (const msg of messages) {
      const otherId =
        msg.senderId.toString() === req.userId
          ? msg.receiverId.toString()
          : msg.senderId.toString();

      if (!conversationMap.has(otherId)) {
        conversationMap.set(otherId, { lastMessage: msg, unreadCount: 0 });
      }

      if (!msg.isRead && msg.receiverId.toString() === req.userId) {
        const entry = conversationMap.get(otherId)!;
        entry.unreadCount += 1;
      }
    }

    const conversations = await Promise.all(
      Array.from(conversationMap.entries()).map(
        async ([otherId, { lastMessage, unreadCount }]) => {
          const user = await UserModel.findById(otherId);
          if (!user) return null;
          return {
            user: formatUser(user),
            lastMessage: formatMessage(lastMessage),
            unreadCount,
          };
        },
      ),
    );

    res.json(conversations.filter(Boolean));
  } catch (err) {
    logger.error({ err }, "GetConversations error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
