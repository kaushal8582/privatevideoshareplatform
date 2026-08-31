import crypto from 'crypto';
import User from '../models/User.js';

export const generateReferralCodeCandidate = (name = '') => {
  const slug =
    String(name)
      .replace(/[^a-zA-Z0-9]/g, '')
      .slice(0, 4)
      .toUpperCase() || 'MP';
  const rand = crypto.randomBytes(3).toString('hex').toUpperCase().slice(0, 4);
  return `${slug}${rand}`;
};

export async function ensureReferralCode(userDoc) {
  if (userDoc.referralCode) return userDoc.referralCode;

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const code = generateReferralCodeCandidate(userDoc.name);
    const exists = await User.exists({ referralCode: code });
    if (!exists) {
      userDoc.referralCode = code;
      await userDoc.save();
      return code;
    }
  }

  const fallback = `MP${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  userDoc.referralCode = fallback;
  await userDoc.save();
  return fallback;
}
