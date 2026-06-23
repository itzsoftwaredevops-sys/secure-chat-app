import { Router, type IRouter } from "express";
import { UserModel } from "../models/User.js";
import { authMiddleware, type AuthRequest } from "../middlewares/auth.js";
import { formatUser } from "./auth.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

router.get("/users/online", authMiddleware, async (_req: AuthRequest, res) => {
  try {
    const onlineUsers = await UserModel.find({ isOnline: true }).select("_id");
    const onlineUserIds = onlineUsers.map((u) => u._id.toString());
    res.json({ onlineUserIds });
  } catch (err) {
    logger.error({ err }, "GetOnlineUsers error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/users", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const search = req.query["search"] as string | undefined;
    const query = search
      ? {
          $or: [
            { username: { $regex: search, $options: "i" } },
            { email: { $regex: search, $options: "i" } },
          ],
          _id: { $ne: req.userId },
        }
      : { _id: { $ne: req.userId } };

    const users = await UserModel.find(query).limit(20);
    res.json(users.map(formatUser));
  } catch (err) {
    logger.error({ err }, "GetUsers error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/users/:id", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const user = await UserModel.findById(req.params["id"]);
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
