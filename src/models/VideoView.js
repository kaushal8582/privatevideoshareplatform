import mongoose from 'mongoose';

/**
 * One viewing session per device per video (rolling 24h window).
 * Payable at most once per device/video per 24h when watchedSeconds >= threshold.
 */
const videoViewSchema = new mongoose.Schema(
  {
    video: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Video',
      required: true,
      index: true,
    },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    deviceId: {
      type: String,
      required: true,
      trim: true,
      maxlength: 128,
      index: true,
    },
    source: {
      type: String,
      enum: ['app'],
      required: true,
      default: 'app',
    },
    watchedSeconds: {
      type: Number,
      default: 0,
      min: 0,
    },
    counted: {
      type: Boolean,
      default: false,
      index: true,
    },
    payable: {
      type: Boolean,
      default: false,
      index: true,
    },
    payableAt: {
      type: Date,
      default: null,
    },
    lastHeartbeatAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  { timestamps: true }
);

videoViewSchema.index({ video: 1, deviceId: 1, lastHeartbeatAt: -1 });
videoViewSchema.index({ video: 1, deviceId: 1, payable: 1, payableAt: -1 });

const VideoView = mongoose.model('VideoView', videoViewSchema);

export default VideoView;
