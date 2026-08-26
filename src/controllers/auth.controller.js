import User from '../models/User.js';
import { signToken } from '../middleware/auth.middleware.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const formatUser = (user) => ({
  id: user._id,
  name: user.name,
  email: user.email,
  createdAt: user.createdAt,
});

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

    const existing = await User.findOne({ email }).lean();
    if (existing) {
      return res.status(409).json({
        success: false,
        message: 'An account with this email already exists.',
        error: 'EMAIL_IN_USE',
      });
    }

    const user = await User.create({ name, email, password });
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
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password.',
        error: 'INVALID_CREDENTIALS',
      });
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
