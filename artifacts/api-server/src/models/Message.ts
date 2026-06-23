import mongoose, { type Document, type Model } from "mongoose";

export interface IMessage extends Document {
  _id: mongoose.Types.ObjectId;
  senderId: mongoose.Types.ObjectId;
  receiverId: mongoose.Types.ObjectId;
  encryptedMessage: string;
  timer: number | null;
  expiresAt: Date | null;
  isRead: boolean;
  createdAt: Date;
}

const messageSchema = new mongoose.Schema<IMessage>(
  {
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    receiverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    encryptedMessage: {
      type: String,
      required: true,
    },
    timer: {
      type: Number,
      default: null,
    },
    expiresAt: {
      type: Date,
      default: null,
      index: { expireAfterSeconds: 0 },
    },
    isRead: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true },
);

messageSchema.index({ senderId: 1, receiverId: 1 });
messageSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const MessageModel: Model<IMessage> = mongoose.model<IMessage>(
  "Message",
  messageSchema,
);
