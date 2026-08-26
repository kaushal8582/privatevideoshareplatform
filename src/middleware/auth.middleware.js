import jwt from 'jsonwebtoken';
import User from '../models/User.js';

const getJwtSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is not configured');
  }
  return secret;
};

export const signToken = (userId) => {
  const expiresIn = process.env.JWT_EXPIRES_IN || '7d';
  return jwt.sign({ sub: String(userId) }, getJwtSecret(), { expiresIn });
};

export const requireAuth = async (req, res, next) => {
  try {
    const header = req.headers.authorization || '';
    const [scheme, token] = header.split(' ');

    if (scheme !== 'Bearer' || !token) {
      return res.status(401).json({
        success: false,
        message: 'Please log in to continue.',
        error: 'UNAUTHORIZED',
      });
    }

    let payload;
    try {
      payload = jwt.verify(token, getJwtSecret());
    } catch {
      return res.status(401).json({
        success: false,
        message: 'Session expired. Please log in again.',
        error: 'INVALID_TOKEN',
      });
    }

    const user = await User.findById(payload.sub).lean();
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Please log in to continue.',
        error: 'UNAUTHORIZED',
      });
    }

    req.user = { id: String(user._id), name: user.name, email: user.email };
    next();
  } catch (err) {
    next(err);
  }
};
