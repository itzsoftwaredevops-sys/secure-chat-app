import { Router, type IRouter } from "express";
import { db } from "../lib/db.js";
import { messagesTable, usersTable } from "@workspace/db";
import { eq, or, desc } from "drizzle-orm";
import { authMiddleware, type AuthRequest } from "../middlewares/auth.js";
import { formatUser } from "./auth.js";
import { formatMessage } from "./messages.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

router.get("/conversations", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const currentUserId = req.userId!;

    const messages = await db
      .select()
      .from(messagesTable)
      .where(
        or(
          eq(messagesTable.senderId, currentUserId),
          eq(messagesTable.receiverId, currentUserId),
        ),
      )
      .orderBy(desc(messagesTable.createdAt));

    const conversationMap = new Map<
      string,
      { lastMessage: (typeof messages)[0]; unreadCount: number }
    >();

    for (const msg of messages) {
      const otherId =
        msg.senderId === currentUserId ? msg.receiverId : msg.senderId;

      if (!conversationMap.has(otherId)) {
        conversationMap.set(otherId, { lastMessage: msg, unreadCount: 0 });
      }

      if (!msg.isRead && msg.receiverId === currentUserId) {
        conversationMap.get(otherId)!.unreadCount += 1;
      }
    }

    const conversations = await Promise.all(
      Array.from(conversationMap.entries()).map(
        async ([otherId, { lastMessage, unreadCount }]) => {
          const [user] = await db
            .select()
            .from(usersTable)
            .where(eq(usersTable.id, otherId))
            .limit(1);
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
