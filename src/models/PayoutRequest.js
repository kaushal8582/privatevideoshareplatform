import mongoose from 'mongoose';

const payoutRequestSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    amountUsd: {
      type: Number,
      required: true,
      min: 0.01,
    },
    method: {
      type: String,
      enum: ['upi', 'bank'],
      required: true,
    },
    /** Snapshot of payment details at request time */
    paymentSnapshot: {
      upiId: { type: String, default: null },
      accountName: { type: String, default: null },
      accountNumber: { type: String, default: null },
      ifsc: { type: String, default: null },
    },
    status: {
      type: String,
      enum: ['pending', 'paid', 'rejected'],
      default: 'pending',
      index: true,
    },
    adminNote: {
      type: String,
      maxlength: 500,
      default: null,
    },
    processedAt: {
      type: Date,
      default: null,
    },
    processedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { timestamps: true }
);

payoutRequestSchema.index({ status: 1, createdAt: -1 });
payoutRequestSchema.index({ user: 1, status: 1 });

const PayoutRequest = mongoose.model('PayoutRequest', payoutRequestSchema);

export default PayoutRequest;
