import { getViewRules } from '../utils/viewRules.js';
import Video from '../models/Video.js';
import User from '../models/User.js';
import storage from '../services/storage/storage.service.js';
import { buildShareUrl } from '../utils/validators.js';
import { roundUsd as roundUsd6 } from '../utils/ogEarnRules.js';

/**
 * GET /api/dashboard/stats
 */
export const getDashboardStats = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const rules = getViewRules();

    const [user, videoCount, recent] = await Promise.all([
      User.findById(userId).lean(),
      Video.countDocuments({ user: userId }),
      Video.find({ user: userId }).sort({ createdAt: -1 }).limit(8).lean(),
    ]);

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Please log in to continue.',
        error: 'UNAUTHORIZED',
      });
    }

    const totalAppViews = user.totalAppViews || 0;
    const payableViews = user.payableViews || 0;
    const uploadEarningsUsd =
      Math.round((payableViews / 1000) * rules.usdPerThousand * 10000) / 10000;
    const ogEarnBalanceUsd = roundUsd6(user.ogEarnBalanceUsd || 0);
    const ogRoyaltyBalanceUsd = roundUsd6(user.ogRoyaltyBalanceUsd || 0);
    const referralBalanceUsd = roundUsd6(user.referralBalanceUsd || 0);
    const estimatedEarningsUsd =
      Math.round(
        (uploadEarningsUsd + ogEarnBalanceUsd + ogRoyaltyBalanceUsd + referralBalanceUsd) *
          10000
      ) / 10000;

    const recentVideos = await Promise.all(
      recent.map(async (video) => {
        const thumbnailUrl = await storage.getThumbnailUrl(
          video.storage?.thumbnailPublicId,
          video.storage?.publicId
        );
        return {
          id: video._id,
          title: video.title,
          shareToken: video.shareToken,
          shareUrl: buildShareUrl(video.shareToken),
          thumbnailUrl,
          duration: video.duration,
          size: video.size,
          viewCount: video.viewCount || 0,
          payableViewCount: video.payableViewCount || 0,
          createdAt: video.createdAt,
        };
      })
    );

    return res.json({
      success: true,
      message: 'OK',
      data: {
        videoCount,
        totalAppViews,
        payableViews,
        uploadEarningsUsd,
        ogEarnBalanceUsd,
        ogRoyaltyBalanceUsd,
        referralBalanceUsd,
        estimatedEarningsUsd,
        usdPerThousand: rules.usdPerThousand,
        recentVideos,
      },
    });
  } catch (err) {
    next(err);
  }
};
