import { Router, type IRouter } from "express";
import { z } from "zod";
import { UserModel } from "../models/User.js";
import { generateToken, authMiddleware, type AuthRequest } from "../middlewares/auth.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

const registerSchema = z.object({
  username: z.string().min(3).max(30),
  email: z.string().email(),
  password: z.string().min(6),
  profilePicture: z.string().optional().nullable(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

function formatUser(user: InstanceType<typeof UserModel>) {
  return {
    id: user._id.toString(),
    username: user.username,
    email: user.email,
    profilePicture: user.profilePicture ?? null,
    isOnline: user.isOnline,
    lastSeen: user.lastSeen ? user.lastSeen.toISOString() : null,
    createdAt: (user as any).createdAt?.toISOString?.() ?? new Date().toISOString(),
  };
}

router.post("/auth/register", async (req, res) => {
  try {
    const body = registerSchema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.issues[0]?.message ?? "Validation error" });
      return;
    }

    const { username, email, password, profilePicture } = body.data;

    const existing = await UserModel.findOne({ $or: [{ email }, { username }] });
    if (existing) {
      res.status(400).json({ error: "Username or email already taken" });
      return;
    }

    const user = await UserModel.create({
      username,
      email,
      password,
      profilePicture: profilePicture ?? null,
    });

    const token = generateToken(user._id.toString());
    res.status(201).json({ token, user: formatUser(user) });
  } catch (err) {
    logger.error({ err }, "Register error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/auth/login", async (req, res) => {
  try {
    const body = loginSchema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: "Invalid credentials format" });
      return;
    }

    const { email, password } = body.data;
    const user = await UserModel.findOne({ email });

    if (!user || !(await user.comparePassword(password))) {
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }

    user.isOnline = true;
    await user.save();

    const token = generateToken(user._id.toString());
    res.json({ token, user: formatUser(user) });
  } catch (err) {
    logger.error({ err }, "Login error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/auth/me", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const user = await UserModel.findById(req.userId);
    if (!user) {
      res.status(401).json({ error: "User not found" });
      return;
    }
    res.json(formatUser(user));
  } catch (err) {
    logger.error({ err }, "GetMe error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export { formatUser };
export default router;
