import mongoose from 'mongoose';

const telegramConnectionCodeSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      maxlength: 24,
    },
    status: {
      type: String,
      enum: ['pending', 'used', 'expired'],
      default: 'pending',
      index: true,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    usedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

// TTL: delete docs when expiresAt is reached
telegramConnectionCodeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const TelegramConnectionCode = mongoose.model(
  'TelegramConnectionCode',
  telegramConnectionCodeSchema
);

export default TelegramConnectionCode;
