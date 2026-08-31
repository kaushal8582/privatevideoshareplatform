import User from '../models/User.js';
import { signToken } from '../middleware/auth.middleware.js';
import { verifyGoogleIdToken } from '../utils/googleAuth.js';
import { applyReferralOnSignup } from '../services/referral.service.js';
import { ensureReferralCode } from '../utils/referralCode.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const formatUser = (user) => ({
  id: user._id || user.id,
  name: user.name,
  email: user.email,
  avatar: user.avatar || null,
  providers: user.providers || [],
  role: user.role || 'creator',
  status: user.status || 'active',
  createdAt: user.createdAt,
});

const ensureActive = (user) => {
  if (user.status === 'banned') {
    const error = new Error('This account has been suspended.');
    error.statusCode = 403;
    error.code = 'ACCOUNT_BANNED';
    throw error;
  }
};

/**
 * POST /api/auth/register
 */
export const register = async (req, res, next) => {
  try {
    const name = String(req.body?.name || '').trim();
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');

    if (!name || name.length < 2) {
      return res.status(400).json({
        success: false,
        message: 'Please enter your name (at least 2 characters).',
        error: 'VALIDATION_ERROR',
      });
    }

    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({
        success: false,
        message: 'Please enter a valid email address.',
        error: 'VALIDATION_ERROR',
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters.',
        error: 'VALIDATION_ERROR',
      });
    }

    const referralCode = String(req.body?.referralCode || '').trim();

    const existing = await User.findOne({ email });
    if (existing) {
      if (existing.googleId && !existing.password) {
        return res.status(409).json({
          success: false,
          message: 'This email is linked to Google. Please continue with Google.',
          error: 'USE_GOOGLE',
        });
      }
      return res.status(409).json({
        success: false,
        message: 'An account with this email already exists.',
        error: 'EMAIL_IN_USE',
      });
    }

    const user = await User.create({
      name,
      email,
      password,
      providers: ['email'],
      role: 'creator',
      status: 'active',
    });

    await ensureReferralCode(user);
    await applyReferralOnSignup(user, referralCode);

    const token = signToken(user._id);

    return res.status(201).json({
      success: true,
      message: 'Account created successfully',
      data: { user: formatUser(user), token },
    });
  } catch (err) {
    if (err?.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'An account with this email already exists.',
        error: 'EMAIL_IN_USE',
      });
    }
    next(err);
  }
};

/**
 * POST /api/auth/login
 */
export const login = async (req, res, next) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');

    if (!EMAIL_RE.test(email) || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required.',
        error: 'VALIDATION_ERROR',
      });
    }

    const user = await User.findOne({ email }).select('+password');
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password.',
        error: 'INVALID_CREDENTIALS',
      });
    }

    ensureActive(user);

    if (!user.password) {
      return res.status(401).json({
        success: false,
        message: 'This account uses Google sign-in. Please continue with Google.',
        error: 'USE_GOOGLE',
      });
    }

    if (!(await user.comparePassword(password))) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password.',
        error: 'INVALID_CREDENTIALS',
      });
    }

    // Backfill providers for accounts created before Phase 2
    const providers = new Set(user.providers || []);
    providers.add('email');
    if (user.googleId) providers.add('google');
    const nextProviders = [...providers];
    if (
      nextProviders.length !== (user.providers || []).length ||
      nextProviders.some((p) => !(user.providers || []).includes(p))
    ) {
      user.providers = nextProviders;
      await user.save();
    }

    const token = signToken(user._id);

    return res.json({
      success: true,
      message: 'Logged in successfully',
      data: {
        user: formatUser(user),
        token,
      },
    });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({
        success: false,
        message: err.message,
        error: err.code || 'AUTH_ERROR',
      });
    }
    next(err);
  }
};

/**
 * POST /api/auth/google
 * Body: { idToken }
 * Creates user or links Google to existing email account.
 */
export const googleAuth = async (req, res, next) => {
  try {
    const idToken = String(req.body?.idToken || '').trim();
    const referralCode = String(req.body?.referralCode || '').trim();
    if (!idToken) {
      return res.status(400).json({
        success: false,
        message: 'Google idToken is required.',
        error: 'VALIDATION_ERROR',
      });
    }

    const profile = await verifyGoogleIdToken(idToken);

    let user = await User.findOne({ googleId: profile.googleId });

    if (!user) {
      user = await User.findOne({ email: profile.email }).select('+password');
      if (user) {
        // Link Google to existing email account (same email = same creator)
        user.googleId = profile.googleId;
        if (!user.avatar && profile.avatar) user.avatar = profile.avatar;
        const providers = new Set(user.providers || []);
        if (user.password) providers.add('email');
        providers.add('google');
        user.providers = [...providers];
        await user.save();
      } else {
        user = await User.create({
          name: profile.name.slice(0, 80),
          email: profile.email,
          googleId: profile.googleId,
          avatar: profile.avatar,
          password: null,
          providers: ['google'],
          role: 'creator',
          status: 'active',
        });
        await ensureReferralCode(user);
        await applyReferralOnSignup(user, referralCode);
      }
    } else if (profile.avatar && user.avatar !== profile.avatar) {
      user.avatar = profile.avatar;
      await user.save();
    }

    ensureActive(user);

    const token = signToken(user._id);

    return res.json({
      success: true,
      message: 'Logged in with Google',
      data: { user: formatUser(user), token },
    });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({
        success: false,
        message: err.message,
        error: err.code || 'GOOGLE_AUTH_ERROR',
      });
    }
    if (err.message?.includes('Wrong recipient') || err.message?.includes('Token used too early')) {
      return res.status(401).json({
        success: false,
        message: 'Invalid Google token.',
        error: 'INVALID_GOOGLE_TOKEN',
      });
    }
    next(err);
  }
};

/**
 * GET /api/auth/me
 */
export const me = async (req, res) => {
  return res.json({
    success: true,
    message: 'OK',
    data: { user: req.user },
  });
};

/**
 * PATCH /api/auth/me
 * Update display name (and optional avatar URL).
 */
export const updateMe = async (req, res, next) => {
  try {
    const name = req.body?.name != null ? String(req.body.name).trim() : null;
    const avatar = req.body?.avatar != null ? String(req.body.avatar).trim() : undefined;

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Please log in to continue.',
        error: 'UNAUTHORIZED',
      });
    }

    if (name !== null) {
      if (name.length < 2) {
        return res.status(400).json({
          success: false,
          message: 'Name must be at least 2 characters.',
          error: 'VALIDATION_ERROR',
        });
      }
      user.name = name.slice(0, 80);
    }

    if (avatar !== undefined) {
      user.avatar = avatar || null;
    }

    await user.save();

    return res.json({
      success: true,
      message: 'Profile updated',
      data: { user: formatUser(user) },
    });
  } catch (err) {
    next(err);
  }
};
