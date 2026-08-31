import Video from '../models/Video.js';
import VideoView from '../models/VideoView.js';
import User from '../models/User.js';
import OgShareLink from '../models/OgShareLink.js';
import { getViewRules } from '../utils/viewRules.js';
import { creditReferralBonus } from '../services/referral.service.js';
import { creditOgEarnSplit, resolveShareContext } from '../services/ogEarn.service.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * POST /api/views/heartbeat
 * Body: { shareToken, deviceId, watchedSeconds, source }
 * Public (viewers). source must be "app".
 *
 * Earnings:
 * - Original upload link → 100% to uploader
 * - OG Earn remapped link → 90% link owner + 10% original creator
 * Payable uniqueness: 1 / device / original video / 24h
 */
export const heartbeat = async (req, res, next) => {
  try {
    const source = String(req.body?.source || '').trim().toLowerCase();
    if (source !== 'app') {
      return res.status(403).json({
        success: false,
        message: 'Only app views are counted.',
        error: 'WEB_VIEWS_NOT_COUNTED',
      });
    }

    const shareToken = String(req.body?.shareToken || '').trim();
    const deviceId = String(req.body?.deviceId || '').trim();
    const watchedSeconds = Math.max(0, Math.floor(Number(req.body?.watchedSeconds) || 0));

    if (!shareToken || deviceId.length < 8 || deviceId.length > 128) {
      return res.status(400).json({
        success: false,
        message: 'shareToken and deviceId are required.',
        error: 'VALIDATION_ERROR',
      });
    }

    const ctx = await resolveShareContext(shareToken);
    if (!ctx || ctx.video.status !== 'ready') {
      return res.status(404).json({
        success: false,
        message: 'Video not found.',
        error: 'NOT_FOUND',
      });
    }

    const video = ctx.video;
    const rules = getViewRules();
    const now = new Date();
    const windowStart = new Date(now.getTime() - DAY_MS);

    const viewerUserId = req.user?.id ? String(req.user.id) : null;
    // No payable if link owner or original creator is watching
    const isExcludedViewer = Boolean(
      viewerUserId &&
        (viewerUserId === ctx.linkOwnerId || viewerUserId === ctx.originalCreatorId)
    );

    let session = await VideoView.findOne({
      video: video._id,
      deviceId,
      lastHeartbeatAt: { $gte: windowStart },
    }).sort({ lastHeartbeatAt: -1 });

    if (!session) {
      session = new VideoView({
        video: video._id,
        owner: video.user,
        deviceId,
        source: 'app',
        watchedSeconds: 0,
        counted: false,
        payable: false,
      });
    }

    session.watchedSeconds = Math.max(session.watchedSeconds || 0, watchedSeconds);
    session.lastHeartbeatAt = now;

    let newlyCounted = false;
    let newlyPayable = false;

    if (!session.counted && session.watchedSeconds >= rules.minCountedSeconds) {
      session.counted = true;
      newlyCounted = true;
    }

    if (!session.payable && !isExcludedViewer && session.watchedSeconds >= rules.minPayableSeconds) {
      // Uniqueness is per original video + device (not remapped token)
      const recentPayable = await VideoView.findOne({
        video: video._id,
        deviceId,
        payable: true,
        payableAt: { $gte: windowStart },
      }).lean();

      if (!recentPayable) {
        session.payable = true;
        session.payableAt = now;
        newlyPayable = true;
      }
    }

    await session.save();

    if (newlyCounted) {
      await Video.updateOne({ _id: video._id }, { $inc: { viewCount: 1 } });
      await User.updateOne({ _id: video.user }, { $inc: { totalAppViews: 1 } });
      if (ctx.kind === 'og' && ctx.ogShareLink) {
        await OgShareLink.updateOne({ _id: ctx.ogShareLink._id }, { $inc: { viewCount: 1 } });
      }
    }

    if (newlyPayable) {
      await Video.updateOne({ _id: video._id }, { $inc: { payableViewCount: 1 } });

      if (ctx.kind === 'og' && ctx.ogShareLink) {
        // 90% link owner / 10% original creator (Model 1 referral stacks on owner's share)
        creditOgEarnSplit({
          ogShareLinkId: ctx.ogShareLink._id,
          videoId: video._id,
          videoViewId: session._id,
          linkOwnerId: ctx.linkOwnerId,
          originalCreatorId: ctx.originalCreatorId,
          royaltyRate: ctx.royaltyRate,
        }).catch((err) => {
          console.error('OG Earn split failed:', err.message);
        });
      } else {
        // Original upload link — 100% to uploader
        await User.updateOne({ _id: video.user }, { $inc: { payableViews: 1 } });
        creditReferralBonus({
          referredUserId: video.user,
          videoViewId: session._id,
        }).catch((err) => {
          console.error('Referral bonus credit failed:', err.message);
        });
      }
    }

    return res.json({
      success: true,
      message: 'OK',
      data: {
        counted: session.counted,
        payable: session.payable,
        watchedSeconds: session.watchedSeconds,
        newlyCounted,
        newlyPayable,
        earnKind: ctx.kind,
      },
    });
  } catch (err) {
    next(err);
  }
};
