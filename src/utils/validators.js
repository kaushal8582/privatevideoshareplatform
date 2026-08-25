const ALLOWED_MIME_TYPES = [
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-matroska',
  'video/mkv',
];

const ALLOWED_EXTENSIONS = ['.mp4', '.webm', '.mov', '.mkv'];

export const getMaxVideoSizeBytes = () => {
  const maxMb = Number(process.env.MAX_VIDEO_SIZE_MB) || 500;
  return maxMb * 1024 * 1024;
};

export const getMaxVideoSizeMb = () => {
  return Number(process.env.MAX_VIDEO_SIZE_MB) || 500;
};

export const isAllowedMimeType = (mimeType = '') => {
  return ALLOWED_MIME_TYPES.includes(mimeType.toLowerCase());
};

export const isAllowedExtension = (filename = '') => {
  const lower = filename.toLowerCase();
  return ALLOWED_EXTENSIONS.some((ext) => lower.endsWith(ext));
};

export const validateVideoFile = (file) => {
  if (!file) {
    return { valid: false, message: 'No video file provided. Use field name "video".' };
  }

  if (!isAllowedMimeType(file.mimetype)) {
    return {
      valid: false,
      message: 'Unsupported video type. Allowed: MP4, WebM, MOV, MKV.',
    };
  }

  if (!isAllowedExtension(file.originalname)) {
    return {
      valid: false,
      message: 'Unsupported file extension. Allowed: .mp4, .webm, .mov, .mkv.',
    };
  }

  const maxBytes = getMaxVideoSizeBytes();
  if (file.size > maxBytes) {
    return {
      valid: false,
      message: `File too large. Maximum size is ${getMaxVideoSizeMb()} MB.`,
    };
  }

  return { valid: true };
};

/**
 * Derive a human-readable title from the original filename.
 * e.g. "my-awesome-video.mp4" → "My Awesome Video"
 */
export const deriveTitleFromFilename = (filename = '') => {
  const withoutExt = filename.replace(/\.[^/.]+$/, '');
  const cleaned = withoutExt
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) {
    return 'Untitled Video';
  }

  return cleaned
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
};

export const buildShareUrl = (shareToken) => {
  const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(
    /\/$/,
    ''
  );
  return `${frontendUrl}/v/${shareToken}`;
};

export { ALLOWED_MIME_TYPES, ALLOWED_EXTENSIONS };
