import { cleanupTempUpload } from '../utils/cleanupTempFile.js';

export const errorHandler = async (err, req, res, _next) => {
  await cleanupTempUpload(req?.file);
  console.error('[Error]', err.message);

  if (err.code === 'LIMIT_FILE_SIZE') {
    const maxMb = process.env.MAX_VIDEO_SIZE_MB || 500;
    return res.status(400).json({
      success: false,
      message: `File too large. Maximum size is ${maxMb} MB.`,
      error: 'FILE_TOO_LARGE',
    });
  }

  if (err.code === 'INVALID_FILE_TYPE' || err.statusCode === 400) {
    return res.status(400).json({
      success: false,
      message: err.message || 'Invalid request',
      error: err.code || 'BAD_REQUEST',
    });
  }

  if (err.name === 'CastError') {
    return res.status(400).json({
      success: false,
      message: 'Invalid video ID',
      error: 'INVALID_ID',
    });
  }

  if (err.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      error: 'VALIDATION_ERROR',
    });
  }

  if (err.code === 'STORAGE_DELETE_FAILED') {
    return res.status(502).json({
      success: false,
      message: 'Failed to delete video from storage. Please try again.',
      error: 'STORAGE_DELETE_FAILED',
    });
  }

  const statusCode = err.statusCode || 500;
  const isProd = process.env.NODE_ENV === 'production';

  return res.status(statusCode).json({
    success: false,
    message:
      statusCode === 500 && isProd
        ? 'Something went wrong. Please try again.'
        : err.message || 'Internal server error',
    error: err.code || 'INTERNAL_ERROR',
  });
};
