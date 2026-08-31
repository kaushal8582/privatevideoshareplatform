import mongoose from 'mongoose';

/**
 * OG Earn remapped share link.
 * Same video file, unique token. Link owner earns 90%; original creator gets 10% royalty.
 */
const ogShareLinkSchema = new mongoose.Schema(
  {
    shareToken: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
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
    originalCreator: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    /** Token that was converted (original or another OG link) — audit only */
    sourceShareToken: {
      type: String,
      default: null,
    },
    status: {
      type: String,
      enum: ['active', 'disabled'],
      default: 'active',
      index: true,
    },
    viewCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    payableViewCount: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  { timestamps: true }
);

ogShareLinkSchema.index({ owner: 1, video: 1 }, { unique: true });
ogShareLinkSchema.index({ owner: 1, createdAt: -1 });
ogShareLinkSchema.index({ originalCreator: 1, createdAt: -1 });

const OgShareLink = mongoose.model('OgShareLink', ogShareLinkSchema);

export default OgShareLink;
