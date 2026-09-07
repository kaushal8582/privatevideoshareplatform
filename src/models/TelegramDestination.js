import mongoose from 'mongoose';

const permissionsSchema = new mongoose.Schema(
  {
    canPostMessages: { type: Boolean, default: false },
    canDeleteMessages: { type: Boolean, default: false },
  },
  { _id: false }
);

const settingsSchema = new mongoose.Schema(
  {
    autoPublish: { type: Boolean, default: false },
    deleteLinks: { type: Boolean, default: true },
    searchEnabled: { type: Boolean, default: true },
    adminBypass: { type: Boolean, default: true },
    includeThumbnail: { type: Boolean, default: true },
    includeDescription: { type: Boolean, default: true },
    /** Option A: fixed caption slots around title + watch link */
    messageFormat: {
      beforeTitle: { type: String, trim: true, maxlength: 400, default: '' },
      afterTitle: { type: String, trim: true, maxlength: 400, default: '' },
      afterLink: { type: String, trim: true, maxlength: 400, default: '' },
      footer: { type: String, trim: true, maxlength: 400, default: '' },
    },
  },
  { _id: false }
);

const telegramDestinationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    /** Telegram chat IDs can exceed JS safe integers — store as string */
    telegramChatId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    title: {
      type: String,
      trim: true,
      maxlength: 256,
      default: 'Telegram chat',
    },
    username: {
      type: String,
      trim: true,
      default: null,
    },
    type: {
      type: String,
      enum: ['group', 'supergroup', 'channel'],
      required: true,
    },
    botStatus: {
      type: String,
      default: 'unknown',
      trim: true,
    },
    memberCount: {
      type: Number,
      default: null,
    },
    permissions: {
      type: permissionsSchema,
      default: () => ({}),
    },
    settings: {
      type: settingsSchema,
      default: () => ({}),
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    connectedAt: {
      type: Date,
      default: Date.now,
    },
    disconnectedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

telegramDestinationSchema.index({ userId: 1, telegramChatId: 1 }, { unique: true });

const TelegramDestination = mongoose.model('TelegramDestination', telegramDestinationSchema);

export default TelegramDestination;
