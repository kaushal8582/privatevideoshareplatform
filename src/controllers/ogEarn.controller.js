import {
  convertToOgEarnLink,
  getOgEarnSummary,
  listMyOgLinks,
  resolveShareContext,
} from '../services/ogEarn.service.js';

/**
 * POST /api/og-earn/convert
 * Body: { shareToken }
 */
export const convertLink = async (req, res, next) => {
  try {
    const shareToken = String(req.body?.shareToken || '').trim();
    if (!shareToken || shareToken.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'A valid share token or link token is required.',
        error: 'VALIDATION_ERROR',
      });
    }

    const result = await convertToOgEarnLink({
      userId: req.user.id,
      sourceShareToken: shareToken,
    });

    return res.status(result.reused ? 200 : 201).json({
      success: true,
      message: result.reused
        ? 'You already have an OG Earn link for this video.'
        : 'OG Earn link created.',
      data: {
        id: String(result.link._id),
        shareToken: result.link.shareToken,
        shareUrl: result.shareUrl,
        videoTitle: result.videoTitle,
        reused: result.reused,
        royaltyPercent: Math.round(result.royaltyRate * 100),
        ownerSharePercent: Math.round((1 - result.royaltyRate) * 100),
      },
    });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({
        success: false,
        message: err.message,
        error: err.code || 'OG_EARN_ERROR',
      });
    }
    next(err);
  }
};

/**
 * GET /api/og-earn/me
 */
export const getMyOgEarn = async (req, res, next) => {
  try {
    const summary = await getOgEarnSummary(req.user.id);
    if (!summary) {
      return res.status(404).json({
        success: false,
        message: 'User not found.',
        error: 'NOT_FOUND',
      });
    }
    return res.json({ success: true, message: 'OK', data: summary });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/og-earn/links
 */
export const getMyLinks = async (req, res, next) => {
  try {
    const links = await listMyOgLinks(req.user.id);
    return res.json({ success: true, message: 'OK', data: { links } });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/og-earn/preview/:shareToken
 * Public-ish preview for convert UI (auth optional but convert needs auth).
 */
export const previewConvert = async (req, res, next) => {
  try {
    const ctx = await resolveShareContext(req.params.shareToken);
    if (!ctx || ctx.video.status === 'failed') {
      return res.status(404).json({
        success: false,
        message: 'Video not found.',
        error: 'NOT_FOUND',
      });
    }

    const isOwn = req.user?.id && String(req.user.id) === ctx.originalCreatorId;

    return res.json({
      success: true,
      message: 'OK',
      data: {
        title: ctx.video.title,
        kind: ctx.kind,
        canConvert: !isOwn,
        isOriginalCreator: Boolean(isOwn),
      },
    });
  } catch (err) {
    next(err);
  }
};
