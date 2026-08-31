import mongoose from 'mongoose';

const referralCommissionSchema = new mongoose.Schema(
  {
    referrer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    referredUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    videoView: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'VideoView',
      default: null,
    },
    grossEarningsUsd: {
      type: Number,
      required: true,
      min: 0,
    },
    commissionRate: {
      type: Number,
      required: true,
      min: 0,
      max: 1,
    },
    commissionUsd: {
      type: Number,
      required: true,
      min: 0,
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'paid'],
      default: 'pending',
      index: true,
    },
    period: {
      type: String,
      match: /^\d{4}-\d{2}$/,
      index: true,
    },
  },
  { timestamps: true }
);

referralCommissionSchema.index({ referrer: 1, createdAt: -1 });
referralCommissionSchema.index({ referredUser: 1, createdAt: -1 });

const ReferralCommission = mongoose.model('ReferralCommission', referralCommissionSchema);

export default ReferralCommission;
