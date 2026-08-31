import mongoose from 'mongoose';

/** Audit log for each OG Earn payable view split (90% owner / 10% creator). */
const ogEarnEventSchema = new mongoose.Schema(
  {
    video: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Video',
      required: true,
      index: true,
    },
    ogShareLink: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'OgShareLink',
      required: true,
      index: true,
    },
    videoView: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'VideoView',
      default: null,
    },
    linkOwner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    originalCreator: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    grossEarningsUsd: {
      type: Number,
      required: true,
      min: 0,
    },
    ownerShareUsd: {
      type: Number,
      required: true,
      min: 0,
    },
    royaltyUsd: {
      type: Number,
      required: true,
      min: 0,
    },
    royaltyRate: {
      type: Number,
      required: true,
      min: 0,
      max: 1,
    },
  },
  { timestamps: true }
);

ogEarnEventSchema.index({ linkOwner: 1, createdAt: -1 });
ogEarnEventSchema.index({ originalCreator: 1, createdAt: -1 });

const OgEarnEvent = mongoose.model('OgEarnEvent', ogEarnEventSchema);

export default OgEarnEvent;
