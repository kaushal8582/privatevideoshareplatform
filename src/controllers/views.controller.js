import Video from '../models/Video.js';
import VideoView from '../models/VideoView.js';
import User from '../models/User.js';
import { getViewRules } from '../utils/viewRules.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * POST /api/views/heartbeat
 * Body: { shareToken, deviceId, watchedSeconds, source }
 * Public (viewers). source must be "app".
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

    const video = await Video.findOne({ shareToken, status: 'ready' });
    if (!video) {
      return res.status(404).json({
        success: false,
        message: 'Video not found.',
        error: 'NOT_FOUND',
      });
    }

    const ownerId = String(video.user);
    const rules = getViewRules();
    const now = new Date();
    const windowStart = new Date(now.getTime() - DAY_MS);

    const viewerUserId = req.user?.id ? String(req.user.id) : null;
    const isOwner = Boolean(viewerUserId && viewerUserId === ownerId);

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

    if (!session.payable && !isOwner && session.watchedSeconds >= rules.minPayableSeconds) {
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
    }

    if (newlyPayable) {
      await Video.updateOne({ _id: video._id }, { $inc: { payableViewCount: 1 } });
      await User.updateOne({ _id: video.user }, { $inc: { payableViews: 1 } });
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
      },
    });
  } catch (err) {
    next(err);
  }
};
