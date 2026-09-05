import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 254,
    },
    password: {
      type: String,
      required: false,
      minlength: 6,
      select: false,
      default: null,
    },
    googleId: {
      type: String,
      sparse: true,
      unique: true,
    },
    avatar: {
      type: String,
      default: undefined,
    },
    providers: {
      type: [String],
      enum: ['email', 'google'],
      default: undefined,
    },
    role: {
      type: String,
      enum: ['user', 'creator', 'admin'],
      default: 'creator',
    },
    status: {
      type: String,
      enum: ['active', 'banned'],
      default: 'active',
      index: true,
    },
    totalAppViews: {
      type: Number,
      default: 0,
      min: 0,
    },
    payableViews: {
      type: Number,
      default: 0,
      min: 0,
    },
    /** OG Earn — remapped-link earnings (90% share) */
    ogEarnViews: {
      type: Number,
      default: 0,
      min: 0,
    },
    ogEarnBalanceUsd: {
      type: Number,
      default: 0,
      min: 0,
    },
    /** OG Earn — royalty as original creator (10%) */
    ogRoyaltyViews: {
      type: Number,
      default: 0,
      min: 0,
    },
    ogRoyaltyBalanceUsd: {
      type: Number,
      default: 0,
      min: 0,
    },
    referralCode: {
      type: String,
      unique: true,
      sparse: true,
      uppercase: true,
      trim: true,
      maxlength: 16,
    },
    referredBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    referralAppliedAt: {
      type: Date,
      default: null,
    },
    /** Model 1 bonus balance — separate from creator earnings */
    referralBalanceUsd: {
      type: Number,
      default: 0,
      min: 0,
    },
    referralLifetimeUsd: {
      type: Number,
      default: 0,
      min: 0,
    },
    /** Creator social / external links (saved for later public display) */
    socialLinks: {
      type: [
        {
          title: { type: String, trim: true, maxlength: 80, default: '' },
          url: { type: String, trim: true, maxlength: 500, required: true },
          platform: { type: String, trim: true, maxlength: 32, default: 'link' },
        },
      ],
      default: [],
      validate: {
        validator(v) {
          return !v || v.length <= 8;
        },
        message: 'You can add at most 8 social links.',
      },
    },
    /** Account-level: allow viewers to download this creator's videos in the app */
    allowVideoDownload: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

userSchema.pre('save', async function hashPassword(next) {
  if (!this.isModified('password') || !this.password) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

userSchema.methods.comparePassword = function comparePassword(candidate) {
  if (!this.password) return Promise.resolve(false);
  return bcrypt.compare(candidate, this.password);
};

const User = mongoose.model('User', userSchema);

export default User;
