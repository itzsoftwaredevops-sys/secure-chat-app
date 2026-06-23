import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import authRouter from "./auth.js";
import usersRouter from "./users.js";
import messagesRouter from "./messages.js";
import conversationsRouter from "./conversations.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(usersRouter);
router.use(messagesRouter);
router.use(conversationsRouter);

export default router;
