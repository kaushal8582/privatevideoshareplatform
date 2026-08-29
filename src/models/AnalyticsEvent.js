import mongoose from 'mongoose';

const ALLOWED_EVENTS = [
  'link_open',
  'open_app_click',
  'play_start',
  'play_store_redirect',
  'ad_impression',
  'ad_opened',
  'ad_closed',
  'ad_reward',
  'ad_error',
  'ad_capped',
];

const analyticsEventSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      enum: ALLOWED_EVENTS,
      index: true,
    },
    shareToken: {
      type: String,
      default: null,
      index: true,
    },
    source: {
      type: String,
      enum: ['web', 'app', 'unknown'],
      default: 'unknown',
      index: true,
    },
    path: {
      type: String,
      default: null,
    },
    meta: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

analyticsEventSchema.index({ createdAt: -1 });
analyticsEventSchema.index({ name: 1, createdAt: -1 });

const AnalyticsEvent = mongoose.model('AnalyticsEvent', analyticsEventSchema);

export { ALLOWED_EVENTS };
export default AnalyticsEvent;
