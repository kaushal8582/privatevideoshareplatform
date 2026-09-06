import mongoose from 'mongoose';

const telegramPublicationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    videoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Video',
      required: true,
      index: true,
    },
    telegramDestinationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TelegramDestination',
      required: true,
      index: true,
    },
    telegramChatId: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ['pending', 'publishing', 'published', 'failed'],
      default: 'pending',
      index: true,
    },
    telegramMessageId: {
      type: String,
      default: null,
    },
    error: {
      type: String,
      default: null,
      maxlength: 1000,
    },
    attempts: {
      type: Number,
      default: 0,
      min: 0,
    },
    publishedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

telegramPublicationSchema.index({ videoId: 1, telegramDestinationId: 1 }, { unique: true });

const TelegramPublication = mongoose.model('TelegramPublication', telegramPublicationSchema);

export default TelegramPublication;
