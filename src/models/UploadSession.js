import mongoose from 'mongoose';

const uploadSessionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    key: { type: String, required: true },
    thumbnailKey: { type: String, required: true },
    r2UploadId: { type: String, required: true },
    originalName: { type: String, required: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    title: { type: String, default: null },
    category: {
      type: String,
      enum: ['movie', 'web_series', 'adult', 'porn', 'other'],
      default: 'adult',
    },
    partCount: { type: Number, required: true },
    status: {
      type: String,
      enum: ['pending', 'completed', 'aborted'],
      default: 'pending',
    },
    expiresAt: {
      type: Date,
      required: true,
      index: { expireAfterSeconds: 0 },
    },
  },
  { timestamps: true }
);

const UploadSession = mongoose.model('UploadSession', uploadSessionSchema);

export default UploadSession;
