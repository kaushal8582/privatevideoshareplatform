import mongoose from 'mongoose';

const videoSchema = new mongoose.Schema(
  {
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
  },
  {
    timestamps: true,
  }
);

videoSchema.index({ createdAt: -1 });

const Video = mongoose.model('Video', videoSchema);

export default Video;
