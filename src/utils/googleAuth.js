import { OAuth2Client } from 'google-auth-library';

const getGoogleAudiences = () => {
  const ids = [
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_ANDROID_CLIENT_ID,
    process.env.GOOGLE_IOS_CLIENT_ID,
  ]
    .map((v) => (v ? String(v).trim() : ''))
    .filter(Boolean);

  return [...new Set(ids)];
};

/**
 * Verify a Google ID token and return profile fields.
 */
export const verifyGoogleIdToken = async (idToken) => {
  const audiences = getGoogleAudiences();
  if (!audiences.length) {
    const error = new Error('Google sign-in is not configured on the server.');
    error.statusCode = 503;
    error.code = 'GOOGLE_NOT_CONFIGURED';
    throw error;
  }

  const client = new OAuth2Client(audiences[0]);
  const ticket = await client.verifyIdToken({
    idToken,
    audience: audiences,
  });

  const payload = ticket.getPayload();
  if (!payload?.email || !payload.sub) {
    const error = new Error('Invalid Google token.');
    error.statusCode = 401;
    error.code = 'INVALID_GOOGLE_TOKEN';
    throw error;
  }

  if (payload.email_verified === false) {
    const error = new Error('Google email is not verified.');
    error.statusCode = 401;
    error.code = 'EMAIL_NOT_VERIFIED';
    throw error;
  }

  return {
    googleId: payload.sub,
    email: String(payload.email).toLowerCase(),
    name: payload.name || payload.given_name || 'User',
    avatar: payload.picture || null,
  };
};
