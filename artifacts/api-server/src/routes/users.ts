import { Router, type IRouter } from "express";
import { db } from "../lib/db.js";
import { usersTable } from "@workspace/db";
import { eq, ne, or, ilike } from "drizzle-orm";
import { authMiddleware, type AuthRequest } from "../middlewares/auth.js";
import { formatUser } from "./auth.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

router.get("/users/online", authMiddleware, async (_req: AuthRequest, res) => {
  try {
    const onlineUsers = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.isOnline, true));
    res.json({ onlineUserIds: onlineUsers.map((u) => u.id) });
  } catch (err) {
    logger.error({ err }, "GetOnlineUsers error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/users", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const search = req.query["search"] as string | undefined;

    const users = search
      ? await db
          .select()
          .from(usersTable)
          .where(
            or(
              ilike(usersTable.username, `%${search}%`),
              ilike(usersTable.email, `%${search}%`),
            ),
          )
          .limit(20)
      : await db
          .select()
          .from(usersTable)
          .where(ne(usersTable.id, req.userId!))
          .limit(20);

    res.json(users.filter((u) => u.id !== req.userId).map(formatUser));
  } catch (err) {
    logger.error({ err }, "GetUsers error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/users/:id", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, req.params["id"] as string))
      .limit(1);

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    res.json(formatUser(user));
  } catch (err) {
    logger.error({ err }, "GetUserById error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
