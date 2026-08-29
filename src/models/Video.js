import mongoose from 'mongoose';

const videoSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    originalName: {
      type: String,
      required: true,
    },
    shareToken: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    storage: {
      provider: {
        type: String,
        required: true,
        default: 'r2',
      },
      publicId: {
        type: String,
        required: true,
      },
      url: {
        type: String,
        required: true,
      },
      thumbnailPublicId: {
        type: String,
        default: null,
      },
    },
    mimeType: {
      type: String,
      required: true,
    },
    size: {
      type: Number,
      required: true,
    },
    duration: {
      type: Number,
      default: null,
    },
    status: {
      type: String,
      enum: ['uploading', 'processing', 'ready', 'failed'],
      default: 'ready',
    },
    /** App play sessions that crossed the “counted” threshold */
    viewCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    /** App views that qualify for creator payout (rules applied) */
    payableViewCount: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  {
    timestamps: true,
  }
);

videoSchema.index({ createdAt: -1 });
videoSchema.index({ user: 1, createdAt: -1 });

const Video = mongoose.model('Video', videoSchema);

export default Video;
