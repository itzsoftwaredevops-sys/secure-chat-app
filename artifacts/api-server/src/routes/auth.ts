import { Router, type IRouter } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { db } from "../lib/db.js";
import { usersTable } from "@workspace/db";
import { eq, or } from "drizzle-orm";
import { generateToken, authMiddleware, type AuthRequest } from "../middlewares/auth.js";
import { logger } from "../lib/logger.js";
import type { User } from "@workspace/db";

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

export function formatUser(user: User) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    profilePicture: user.profilePicture ?? null,
    isOnline: user.isOnline,
    lastSeen: user.lastSeen ? user.lastSeen.toISOString() : null,
    createdAt: user.createdAt.toISOString(),
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

    const existing = await db
      .select()
      .from(usersTable)
      .where(or(eq(usersTable.email, email), eq(usersTable.username, username)))
      .limit(1);

    if (existing.length > 0) {
      res.status(400).json({ error: "Username or email already taken" });
      return;
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const [user] = await db
      .insert(usersTable)
      .values({ username, email, passwordHash: hashedPassword, profilePicture: profilePicture ?? null })
      .returning();

    const token = generateToken(user.id);
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
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, email))
      .limit(1);

    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }

    await db
      .update(usersTable)
      .set({ isOnline: true })
      .where(eq(usersTable.id, user.id));

    const token = generateToken(user.id);
    res.json({ token, user: formatUser({ ...user, isOnline: true }) });
  } catch (err) {
    logger.error({ err }, "Login error");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/auth/me", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, req.userId!))
      .limit(1);

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

export default router;
