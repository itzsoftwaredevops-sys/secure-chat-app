import mongoose from "mongoose";
import { logger } from "./logger.js";

export async function connectDB(): Promise<void> {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    logger.warn(
      "MONGODB_URI not set — running without database (some routes will fail)",
    );
    return;
  }

  try {
    await mongoose.connect(uri);
    logger.info("Connected to MongoDB");
  } catch (err) {
    logger.error({ err }, "MongoDB connection failed — server will start but DB routes will fail");
  }
}
