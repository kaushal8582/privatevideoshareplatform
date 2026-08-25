import mongoose from 'mongoose';
import Video from '../models/Video.js';
import storage from '../services/storage/storage.service.js';
import { cleanupTempUpload } from '../utils/cleanupTempFile.js';
import { generateShareToken } from '../utils/generateToken.js';
import {
  validateVideoFile,
  deriveTitleFromFilename,
  buildShareUrl,
} from '../utils/validators.js';

const formatVideoListItem = async (video) => {
  const shareUrl = buildShareUrl(video.shareToken);
  const thumbnailUrl = await storage.getThumbnailUrl(
    video.storage.thumbnailPublicId,
    video.storage.publicId
  );

  return {
    id: video._id,
    title: video.title,
    originalName: video.originalName,
    shareToken: video.shareToken,
    shareUrl,
    videoUrl: await storage.getVideoUrl(video.storage.publicId, video.storage.url),
    thumbnailUrl,
    mimeType: video.mimeType,
    size: video.size,
    duration: video.duration,
    status: video.status,
    createdAt: video.createdAt,
    updatedAt: video.updatedAt,
  };
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

    let shareToken = generateShareToken();
    for (let i = 0; i < 3; i += 1) {
      const existing = await Video.findOne({ shareToken }).lean();
      if (!existing) break;
      shareToken = generateShareToken();
    }

    const title =
      (req.body?.title && String(req.body.title).trim()) ||
      deriveTitleFromFilename(req.file.originalname);

    const video = await Video.create({
      title,
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
        shareToken: video.shareToken,
        shareUrl,
        videoUrl: playbackUrl,
        thumbnailUrl,
        size: video.size,
        duration: video.duration,
        createdAt: video.createdAt,
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

    const [videos, total] = await Promise.all([
      Video.find({ status: { $ne: 'failed' } })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Video.countDocuments({ status: { $ne: 'failed' } }),
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

    const video = await Video.findById(id).lean();

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

    const video = await Video.findOne({ shareToken }).lean();

    if (!video || video.status === 'failed') {
      return res.status(404).json({
        success: false,
        message: 'Video not found. This video may have been deleted or the link may be invalid.',
        error: 'VIDEO_NOT_FOUND',
      });
    }

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
      },
    });
  } catch (err) {
    next(err);
  }
};

/**
 * DELETE /api/videos/:id
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

    const video = await Video.findById(id);

    if (!video) {
      return res.status(404).json({
        success: false,
        message: 'Video not found',
        error: 'VIDEO_NOT_FOUND',
      });
    }

    try {
      await storage.deleteVideo(
        video.storage.publicId,
        video.storage.thumbnailPublicId
      );
    } catch (storageErr) {
      console.error('Storage delete failed:', storageErr.message);
      const error = new Error(
        'Failed to delete video from storage. The video was not removed.'
      );
      error.statusCode = 502;
      error.code = 'STORAGE_DELETE_FAILED';
      throw error;
    }

    await Video.findByIdAndDelete(id);

    return res.json({
      success: true,
      message: 'Video deleted successfully',
      data: { id },
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
