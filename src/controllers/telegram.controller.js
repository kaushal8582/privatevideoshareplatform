import {
  createConnectionCode,
  getBotUsername,
  getConnectCodeTtlMinutes,
  listDestinationsForUser,
  updateDestinationSettings,
  disconnectDestination,
  listPublicationsForVideo,
  publishOne,
} from '../services/telegramIntegration.service.js';
import TelegramPublication from '../models/TelegramPublication.js';

/**
 * POST /api/telegram/connect/code
 */
export const createConnectCode = async (req, res, next) => {
  try {
    const doc = await createConnectionCode(req.user.id);
    return res.status(201).json({
      success: true,
      message: 'Connection code created',
      data: {
        code: doc.code,
        expiresAt: doc.expiresAt,
        expiresInMinutes: getConnectCodeTtlMinutes(),
        botUsername: getBotUsername(),
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/telegram/destinations
 */
export const getDestinations = async (req, res, next) => {
  try {
    const data = await listDestinationsForUser(req.user.id);
    return res.json({
      success: true,
      message: 'OK',
      data,
    });
  } catch (err) {
    next(err);
  }
};

/**
 * PATCH /api/telegram/destinations/:id/settings
 */
export const patchDestinationSettings = async (req, res, next) => {
  try {
    const data = await updateDestinationSettings(req.user.id, req.params.id, req.body || {});
    return res.json({
      success: true,
      message: 'Settings updated',
      data,
    });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({
        success: false,
        message: err.message,
        error: err.code || 'ERROR',
      });
    }
    next(err);
  }
};

/**
 * DELETE /api/telegram/destinations/:id
 */
export const deleteDestination = async (req, res, next) => {
  try {
    const data = await disconnectDestination(req.user.id, req.params.id);
    return res.json({
      success: true,
      message: 'Destination disconnected',
      data,
    });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({
        success: false,
        message: err.message,
        error: err.code || 'ERROR',
      });
    }
    next(err);
  }
};

/**
 * GET /api/telegram/publications/:videoId
 */
export const getVideoPublications = async (req, res, next) => {
  try {
    const data = await listPublicationsForVideo(req.user.id, req.params.videoId);
    return res.json({ success: true, message: 'OK', data });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/telegram/publications/:id/retry
 */
export const retryPublication = async (req, res, next) => {
  try {
    const pub = await TelegramPublication.findOne({
      _id: req.params.id,
      userId: req.user.id,
    });
    if (!pub) {
      return res.status(404).json({
        success: false,
        message: 'Publication not found.',
        error: 'NOT_FOUND',
      });
    }
    if (pub.status === 'published') {
      return res.json({
        success: true,
        message: 'Already published',
        data: {
          id: String(pub._id),
          status: pub.status,
          error: null,
        },
      });
    }
    if (pub.status === 'publishing') {
      return res.status(409).json({
        success: false,
        message: 'Publication is already in progress. Wait a moment and try again.',
        error: 'IN_PROGRESS',
      });
    }

    pub.status = 'pending';
    pub.error = null;
    pub.telegramMessageId = null;
    pub.publishedAt = null;
    await pub.save();

    const updated = await publishOne(String(pub._id));
    if (!updated) {
      return res.status(500).json({
        success: false,
        message: 'Retry failed unexpectedly.',
        error: 'RETRY_FAILED',
      });
    }

    return res.json({
      success: true,
      message: updated.status === 'published' ? 'Published successfully' : 'Retry finished with errors',
      data: {
        id: String(updated._id),
        status: updated.status,
        error: updated.error || null,
        publishedAt: updated.publishedAt || null,
      },
    });
  } catch (err) {
    next(err);
  }
};
