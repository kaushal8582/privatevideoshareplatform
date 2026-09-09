import mongoose from 'mongoose';
import Video from '../models/Video.js';
import User from '../models/User.js';
import UploadSession from '../models/UploadSession.js';
import OgShareLink from '../models/OgShareLink.js';
import TelegramPublication from '../models/TelegramPublication.js';
import VideoView from '../models/VideoView.js';
import storage from '../services/storage/storage.service.js';
import { cleanupTempUpload } from '../utils/cleanupTempFile.js';
import { generateShareToken } from '../utils/generateToken.js';
import {
  validateVideoFile,
  deriveTitleFromFilename,
  buildShareUrl,
  isAllowedMimeType,
  isAllowedExtension,
  getMaxVideoSizeBytes,
  getMaxVideoSizeMb,
} from '../utils/validators.js';
import { resolveShareContext } from '../services/ogEarn.service.js';
import { getOgEarnRules } from '../utils/ogEarnRules.js';
import { queueVideoTelegramPublish } from '../services/telegramIntegration.service.js';
import {
  DEFAULT_VIDEO_CATEGORY,
  normalizeVideoCategory,
} from '../utils/videoCategories.js';

const formatVideoListItem = async (video) => {
  const shareUrl = buildShareUrl(video.shareToken);
  const thumbnailUrl = await storage.getThumbnailUrl(
    video.storage.thumbnailPublicId,
    video.storage.publicId
  );

  return {
    id: video._id,
    title: video.title,
    category: video.category || DEFAULT_VIDEO_CATEGORY,
    originalName: video.originalName,
    shareToken: video.shareToken,
    shareUrl,
    videoUrl: await storage.getVideoUrl(video.storage.publicId, video.storage.url),
    thumbnailUrl,
    mimeType: video.mimeType,
    size: video.size,
    duration: video.duration,
    status: video.status,
    viewCount: video.viewCount || 0,
    payableViewCount: video.payableViewCount || 0,
    createdAt: video.createdAt,
    updatedAt: video.updatedAt,
  };
};

const createUniqueShareToken = async () => {
  let shareToken = generateShareToken();
  for (let i = 0; i < 8; i += 1) {
    const [existingVideo, existingOg] = await Promise.all([
      Video.findOne({ shareToken }).lean(),
      OgShareLink.findOne({ shareToken }).lean(),
    ]);
    if (!existingVideo && !existingOg) return shareToken;
    shareToken = generateShareToken();
  }
  return shareToken;
};

/**
 * POST /api/videos/upload/init
 * Start direct-to-R2 multipart upload (avoids proxy 413).
 */
export const initDirectUpload = async (req, res, next) => {
  try {
    const originalName = String(req.body?.filename || '').trim();
    const mimeType = String(req.body?.mimeType || 'video/mp4').trim();
    const size = Number(req.body?.size);
    const title =
      (req.body?.title && String(req.body.title).trim()) ||
      deriveTitleFromFilename(originalName);
    const category = normalizeVideoCategory(req.body?.category);

    if (!originalName || !isAllowedExtension(originalName)) {
      return res.status(400).json({
        success: false,
        message: 'Unsupported file extension. Allowed: .mp4, .webm, .mov, .mkv.',
        error: 'INVALID_FILE',
      });
    }

    if (!isAllowedMimeType(mimeType)) {
      return res.status(400).json({
        success: false,
        message: 'Unsupported video type. Allowed: MP4, WebM, MOV, MKV.',
        error: 'INVALID_FILE',
      });
    }

    if (!Number.isFinite(size) || size <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid file size.',
        error: 'INVALID_FILE',
      });
    }

    if (size > getMaxVideoSizeBytes()) {
      return res.status(400).json({
        success: false,
        message: `File too large. Maximum size is ${getMaxVideoSizeMb()} MB.`,
        error: 'FILE_TOO_LARGE',
      });
    }

    const partSize = storage.MULTIPART_PART_SIZE;
    const partCount = Math.max(1, Math.ceil(size / partSize));

    if (partCount > 10000) {
      return res.status(400).json({
        success: false,
        message: 'File requires too many parts. Please choose a smaller video.',
        error: 'FILE_TOO_LARGE',
      });
    }

    const direct = await storage.createDirectMultipartUpload({
      originalName,
      mimeType,
      partCount,
    });

    const session = await UploadSession.create({
      user: req.user.id,
      key: direct.key,
      thumbnailKey: direct.thumbnailKey,
      r2UploadId: direct.r2UploadId,
      originalName,
      mimeType,
      size,
      title,
      category,
      partCount,
      status: 'pending',
      expiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000),
    });

    return res.status(201).json({
      success: true,
      message: 'Upload session created',
      data: {
        sessionId: session._id,
        partSize: direct.partSize,
        partCount,
        parts: direct.parts,
        thumbnailUploadUrl: direct.thumbnailUploadUrl,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/videos/upload/complete
 */
export const completeDirectUpload = async (req, res, next) => {
  try {
    const sessionId = req.body?.sessionId;
    const parts = Array.isArray(req.body?.parts) ? req.body.parts : [];
    const durationRaw = req.body?.duration;
    const hasThumbnail = Boolean(req.body?.hasThumbnail);

    if (!sessionId || !mongoose.Types.ObjectId.isValid(sessionId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid upload session.',
        error: 'INVALID_SESSION',
      });
    }

    const session = await UploadSession.findOne({
      _id: sessionId,
      user: req.user.id,
      status: 'pending',
    });

    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Upload session not found or already finished.',
        error: 'SESSION_NOT_FOUND',
      });
    }

    if (parts.length !== session.partCount) {
      return res.status(400).json({
        success: false,
        message: `Expected ${session.partCount} uploaded parts, got ${parts.length}.`,
        error: 'INVALID_PARTS',
      });
    }

    const normalizedParts = parts.map((p) => ({
      PartNumber: Number(p.partNumber ?? p.PartNumber),
      ETag: String((p.etag ?? p.ETag) || '').replace(/"/g, ''),
    }));

    if (normalizedParts.some((p) => !p.PartNumber || !p.ETag)) {
      return res.status(400).json({
        success: false,
        message: 'Each part must include partNumber and etag.',
        error: 'INVALID_PARTS',
      });
    }

    const completeParts = normalizedParts.map((p) => ({
      PartNumber: p.PartNumber,
      ETag: p.ETag.startsWith('"') ? p.ETag : `"${p.ETag}"`,
    }));

    const uploadResult = await storage.completeDirectMultipartUpload({
      key: session.key,
      r2UploadId: session.r2UploadId,
      parts: completeParts,
    });

    const shareToken = await createUniqueShareToken();
    const duration =
      durationRaw != null && Number.isFinite(Number(durationRaw))
        ? Number(durationRaw)
        : null;
    const category = normalizeVideoCategory(
      req.body?.category ?? session.category
    );

    const video = await Video.create({
      user: req.user.id,
      title: session.title || deriveTitleFromFilename(session.originalName),
      category,
      originalName: session.originalName,
      shareToken,
      storage: {
        provider: uploadResult.provider,
        publicId: uploadResult.publicId,
        url: uploadResult.url,
        thumbnailPublicId: hasThumbnail ? session.thumbnailKey : null,
      },
      mimeType: session.mimeType,
      size: session.size,
      duration,
      status: 'ready',
    });

    session.status = 'completed';
    await session.save();

    const shareUrl = buildShareUrl(shareToken);
    const playbackUrl = await storage.getVideoUrl(
      video.storage.publicId,
      video.storage.url
    );
    const thumbnailUrl = await storage.getThumbnailUrl(
      video.storage.thumbnailPublicId,
      video.storage.publicId
    );

    const telegramDestinationIds = Array.isArray(req.body?.telegramDestinationIds)
      ? req.body.telegramDestinationIds
      : [];

    const telegramPublish = await queueVideoTelegramPublish(
      req.user.id,
      video._id,
      telegramDestinationIds
    );

    return res.status(201).json({
      success: true,
      message: 'Video uploaded successfully',
      data: {
        id: video._id,
        title: video.title,
        category: video.category || DEFAULT_VIDEO_CATEGORY,
        shareToken: video.shareToken,
        shareUrl,
        videoUrl: playbackUrl,
        thumbnailUrl,
        size: video.size,
        duration: video.duration,
        createdAt: video.createdAt,
        telegramPublish,
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/videos/upload/abort
 */
export const abortDirectUpload = async (req, res, next) => {
  try {
    const sessionId = req.body?.sessionId;
    if (!sessionId || !mongoose.Types.ObjectId.isValid(sessionId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid upload session.',
        error: 'INVALID_SESSION',
      });
    }

    const session = await UploadSession.findOne({
      _id: sessionId,
      user: req.user.id,
      status: 'pending',
    });

    if (session) {
      await storage.abortDirectMultipartUpload(session.key, session.r2UploadId);
      session.status = 'aborted';
      await session.save();
    }

    return res.json({
      success: true,
      message: 'Upload aborted',
      data: { sessionId },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/videos/upload
 */
export const uploadVideo = async (req, res, next) => {
  try {
    const validation = validateVideoFile(req.file);
    if (!validation.valid) {
      await cleanupTempUpload(req.file);
      const error = new Error(validation.message);
      error.statusCode = 400;
      error.code = 'INVALID_FILE';
      throw error;
    }

    const uploadResult = await storage.uploadVideo(req.file);
    const shareToken = await createUniqueShareToken();

    const title =
      (req.body?.title && String(req.body.title).trim()) ||
      deriveTitleFromFilename(req.file.originalname);
    const category = normalizeVideoCategory(req.body?.category);

    const video = await Video.create({
      user: req.user.id,
      title,
      category,
      originalName: req.file.originalname,
      shareToken,
      storage: {
        provider: uploadResult.provider,
        publicId: uploadResult.publicId,
        url: uploadResult.url,
        thumbnailPublicId: uploadResult.thumbnailPublicId || null,
      },
      mimeType: req.file.mimetype,
      size: uploadResult.bytes || req.file.size,
      duration: uploadResult.duration ?? null,
      status: 'ready',
    });

    const shareUrl = buildShareUrl(shareToken);
    const playbackUrl = await storage.getVideoUrl(
      video.storage.publicId,
      video.storage.url
    );
    const thumbnailUrl = await storage.getThumbnailUrl(
      video.storage.thumbnailPublicId,
      video.storage.publicId
    );

    return res.status(201).json({
      success: true,
      message: 'Video uploaded successfully',
      data: {
        id: video._id,
        title: video.title,
        category: video.category || DEFAULT_VIDEO_CATEGORY,
        shareToken: video.shareToken,
        shareUrl,
        videoUrl: playbackUrl,
        thumbnailUrl,
        size: video.size,
        duration: video.duration,
        createdAt: video.createdAt,
        telegramPublish: await queueVideoTelegramPublish(
          req.user.id,
          video._id,
          Array.isArray(req.body?.telegramDestinationIds)
            ? req.body.telegramDestinationIds
            : []
        ),
      },
    });
  } catch (err) {
    await cleanupTempUpload(req.file);
    if (err.name === 'MongoServerError' || err.name === 'ValidationError') {
      console.error('Database error after upload:', err.message);
    }
    next(err);
  }
};

/**
 * GET /api/videos?page=1&limit=20
 */
export const getVideos = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip = (page - 1) * limit;

    const filter = { user: req.user.id, status: { $ne: 'failed' } };

    const [videos, total] = await Promise.all([
      Video.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Video.countDocuments(filter),
    ]);

    return res.json({
      success: true,
      message: 'Videos retrieved successfully',
      data: {
        videos: await Promise.all(videos.map(formatVideoListItem)),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit) || 1,
        },
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/videos/:id
 */
export const getVideoById = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid video ID',
        error: 'INVALID_ID',
      });
    }

    const video = await Video.findOne({
      _id: id,
      user: req.user.id,
    }).lean();

    if (!video || video.status === 'failed') {
      return res.status(404).json({
        success: false,
        message: 'Video not found',
        error: 'VIDEO_NOT_FOUND',
      });
    }

    return res.json({
      success: true,
      message: 'Video retrieved successfully',
      data: await formatVideoListItem(video),
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/videos/share/:shareToken
 * Resolves original upload links and OG Earn remapped links.
 */
export const getVideoByShareToken = async (req, res, next) => {
  try {
    const { shareToken } = req.params;

    if (!shareToken || shareToken.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Invalid share token',
        error: 'INVALID_SHARE_TOKEN',
      });
    }

    const ctx = await resolveShareContext(shareToken);

    if (!ctx || ctx.video.status === 'failed') {
      return res.status(404).json({
        success: false,
        message: 'Video not found. This video may have been deleted or the link may be invalid.',
        error: 'VIDEO_NOT_FOUND',
      });
    }

    const video = ctx.video;
    const ogRules = getOgEarnRules();
    const creatorId = ctx.originalCreatorId;

    const [creator, relatedDocs] = await Promise.all([
      creatorId
        ? User.findById(creatorId).select('name avatar socialLinks allowVideoDownload').lean()
        : null,
      creatorId
        ? Video.find({
            user: creatorId,
            status: { $ne: 'failed' },
            _id: { $ne: video._id },
          })
            .sort({ viewCount: -1, createdAt: -1 })
            .limit(5)
            .select('title shareToken duration viewCount size createdAt storage originalName')
            .lean()
        : [],
    ]);

    const relatedVideos = await Promise.all(
      (relatedDocs || []).map(async (v) => ({
        title: v.title,
        shareToken: v.shareToken,
        duration: v.duration,
        viewCount: v.viewCount || 0,
        size: v.size,
        createdAt: v.createdAt,
        originalName: v.originalName,
        thumbnailUrl: await storage.getThumbnailUrl(
          v.storage?.thumbnailPublicId,
          v.storage?.publicId
        ),
      }))
    );

    return res.json({
      success: true,
      message: 'Video retrieved successfully',
      data: {
        title: video.title,
        videoUrl: await storage.getVideoUrl(video.storage.publicId, video.storage.url),
        thumbnailUrl: await storage.getThumbnailUrl(
          video.storage.thumbnailPublicId,
          video.storage.publicId
        ),
        originalName: video.originalName,
        size: video.size,
        duration: video.duration,
        createdAt: video.createdAt,
        shareToken: ctx.shareToken,
        linkKind: ctx.kind,
        originalCreatorId: ctx.originalCreatorId,
        creator: creator
          ? {
              id: String(creator._id),
              name: creator.name || 'Creator',
              avatar: creator.avatar || null,
              socialLinks: Array.isArray(creator.socialLinks)
                ? creator.socialLinks.map((l) => ({
                    title: l.title || '',
                    url: l.url || '',
                    platform: l.platform || 'link',
                  }))
                : [],
              allowVideoDownload: creator.allowVideoDownload !== false,
            }
          : null,
        relatedVideos,
        ogEarn: {
          enabled: ogRules.enabled,
          royaltyPercent: Math.round(ogRules.royaltyRate * 100),
          ownerSharePercent: Math.round((1 - ogRules.royaltyRate) * 100),
          isRemapped: ctx.kind === 'og',
        },
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * DELETE /api/videos/:id
 * Order: R2 objects first → then DB + related docs.
 * If R2 fails, DB record is kept so we can retry delete later.
 */
export const deleteVideo = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid video ID',
        error: 'INVALID_ID',
      });
    }

    const video = await Video.findOne({ _id: id, user: req.user.id });

    if (!video) {
      return res.status(404).json({
        success: false,
        message: 'Video not found',
        error: 'VIDEO_NOT_FOUND',
      });
    }

    const publicId = video.storage?.publicId;
    const thumbnailPublicId = video.storage?.thumbnailPublicId || null;

    if (!publicId) {
      return res.status(500).json({
        success: false,
        message: 'Video storage key missing. Cannot delete from R2.',
        error: 'STORAGE_KEY_MISSING',
      });
    }

    let storageResult;
    try {
      storageResult = await storage.deleteVideo(publicId, thumbnailPublicId);
    } catch (storageErr) {
      console.error('[video] R2 delete failed:', storageErr.message);
      return res.status(502).json({
        success: false,
        message: 'Failed to delete video from R2 storage. Database record was kept.',
        error: 'STORAGE_DELETE_FAILED',
      });
    }

    // R2 cleared — remove DB record and related data
    await Video.findByIdAndDelete(id);

    await Promise.all([
      OgShareLink.updateMany({ video: id }, { $set: { status: 'disabled' } }),
      TelegramPublication.deleteMany({ videoId: id }),
      VideoView.deleteMany({ video: id }),
    ]);

    console.log(
      `[video] deleted id=${id} r2=${(storageResult?.requestedKeys || [publicId]).join(',')}`
    );

    return res.json({
      success: true,
      message: 'Video deleted from R2 and database',
      data: {
        id,
        storage: {
          deletedFromR2: true,
          keys: storageResult?.requestedKeys || [publicId],
        },
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/health
 */
export const healthCheck = async (_req, res) => {
  const dbState = mongoose.connection.readyState;
  const dbStatus = dbState === 1 ? 'connected' : 'disconnected';

  return res.json({
    success: true,
    message: 'OK',
    data: {
      status: 'healthy',
      database: dbStatus,
      timestamp: new Date().toISOString(),
    },
  });
};
