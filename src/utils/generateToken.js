import crypto from 'crypto';

/**
 * Generate a cryptographically secure share token.
 * Uses URL-safe base64 characters without padding.
 */
export const generateShareToken = (byteLength = 9) => {
  return crypto.randomBytes(byteLength).toString('base64url');
};
