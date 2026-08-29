import AnalyticsEvent, { ALLOWED_EVENTS } from '../models/AnalyticsEvent.js';

/**
 * POST /api/analytics/events
 * Public, fire-and-forget style tracking for funnel events.
 */
export const trackEvent = async (req, res, next) => {
  try {
    const name = String(req.body?.name || '').trim();
    const shareToken = req.body?.shareToken
      ? String(req.body.shareToken).trim().slice(0, 64)
      : null;
    const sourceRaw = String(req.body?.source || 'unknown').toLowerCase();
    const source = ['web', 'app'].includes(sourceRaw) ? sourceRaw : 'unknown';
    const path = req.body?.path ? String(req.body.path).trim().slice(0, 200) : null;
    const meta =
      req.body?.meta && typeof req.body.meta === 'object' && !Array.isArray(req.body.meta)
        ? req.body.meta
        : {};

    if (!ALLOWED_EVENTS.includes(name)) {
      return res.status(400).json({
        success: false,
        message: `Invalid event. Allowed: ${ALLOWED_EVENTS.join(', ')}`,
        error: 'INVALID_EVENT',
      });
    }

    await AnalyticsEvent.create({
      name,
      shareToken,
      source,
      path,
      meta: {
        ...meta,
        userAgent: String(req.headers['user-agent'] || '').slice(0, 300),
      },
    });

    return res.status(201).json({
      success: true,
      message: 'Event recorded',
      data: { name },
    });
  } catch (err) {
    next(err);
  }
};
