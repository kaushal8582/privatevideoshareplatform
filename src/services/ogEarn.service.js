import Video from '../models/Video.js';
import OgShareLink from '../models/OgShareLink.js';
import OgEarnEvent from '../models/OgEarnEvent.js';
import User from '../models/User.js';
import { generateShareToken } from '../utils/generateToken.js';
import { buildShareUrl } from '../utils/validators.js';
import { getViewRules } from '../utils/viewRules.js';
import { getOgEarnRules, roundUsd } from '../utils/ogEarnRules.js';
import { creditReferralBonusFromUsd } from './referral.service.js';

/**
 * Resolve any public share token to playback + earning context.
 * Returns null if not found / disabled / video deleted.
 */
export async function resolveShareContext(shareToken) {
  const token = String(shareToken || '').trim();
  if (!token || token.length < 6) return null;

  const video = await Video.findOne({ shareToken: token }).lean();
  if (video && video.status !== 'failed') {
    return {
      kind: 'original',
      shareToken: token,
      video,
      linkOwnerId: String(video.user),
      originalCreatorId: String(video.user),
      ogShareLink: null,
      royaltyRate: 0,
    };
  }

  const ogLink = await OgShareLink.findOne({ shareToken: token, status: 'active' }).lean();
  if (!ogLink) return null;

  const ogVideo = await Video.findById(ogLink.video).lean();
  if (!ogVideo || ogVideo.status === 'failed' || ogVideo.status === 'uploading') {
    return null;
  }

  const rules = getOgEarnRules();
  return {
    kind: 'og',
    shareToken: token,
    video: ogVideo,
    linkOwnerId: String(ogLink.owner),
    originalCreatorId: String(ogLink.originalCreator),
    ogShareLink: ogLink,
    royaltyRate: rules.royaltyRate,
  };
}

export async function createUniqueOgShareToken() {
  for (let i = 0; i < 8; i += 1) {
    const shareToken = generateShareToken();
    const [inVideo, inOg] = await Promise.all([
      Video.exists({ shareToken }),
      OgShareLink.exists({ shareToken }),
    ]);
    if (!inVideo && !inOg) return shareToken;
  }
  throw new Error('Could not generate unique OG Earn token');
}

/**
 * Convert a public MastPlayer link into the caller's OG Earn link.
 */
export async function convertToOgEarnLink({ userId, sourceShareToken }) {
  const rules = getOgEarnRules();
  if (!rules.enabled) {
    const err = new Error('OG Earn is currently disabled.');
    err.statusCode = 403;
    err.code = 'OG_EARN_DISABLED';
    throw err;
  }

  const ctx = await resolveShareContext(sourceShareToken);
  if (!ctx) {
    const err = new Error('Video not found. This link may be invalid or the video was deleted.');
    err.statusCode = 404;
    err.code = 'VIDEO_NOT_FOUND';
    throw err;
  }

  if (ctx.video.status !== 'ready') {
    const err = new Error('This video is not ready yet.');
    err.statusCode = 400;
    err.code = 'VIDEO_NOT_READY';
    throw err;
  }

  // Block original creator from converting their own video
  if (String(userId) === ctx.originalCreatorId) {
    const err = new Error('You cannot convert your own video. Share your original upload link instead.');
    err.statusCode = 400;
    err.code = 'SELF_CONVERT_BLOCKED';
    throw err;
  }

  const existing = await OgShareLink.findOne({
    owner: userId,
    video: ctx.video._id,
  });

  if (existing) {
    if (existing.status !== 'active') {
      existing.status = 'active';
      await existing.save();
    }
    return {
      reused: true,
      link: existing,
      shareUrl: buildShareUrl(existing.shareToken),
      videoTitle: ctx.video.title,
      royaltyRate: rules.royaltyRate,
    };
  }

  const shareToken = await createUniqueOgShareToken();
  const link = await OgShareLink.create({
    shareToken,
    video: ctx.video._id,
    owner: userId,
    originalCreator: ctx.originalCreatorId,
    sourceShareToken: String(sourceShareToken).trim(),
    status: 'active',
  });

  return {
    reused: false,
    link,
    shareUrl: buildShareUrl(shareToken),
    videoTitle: ctx.video.title,
    royaltyRate: rules.royaltyRate,
  };
}

/**
 * Credit 90% to link owner + 10% royalty to original creator.
 * Referral bonus applies on the link owner's share (Model 1 stack).
 */
export async function creditOgEarnSplit({
  ogShareLinkId,
  videoId,
  videoViewId,
  linkOwnerId,
  originalCreatorId,
  royaltyRate,
}) {
  const viewRules = getViewRules();
  const gross = roundUsd((1 / 1000) * viewRules.usdPerThousand);
  const royalty = roundUsd(gross * royaltyRate);
  const ownerShare = roundUsd(gross - royalty);

  await OgEarnEvent.create({
    video: videoId,
    ogShareLink: ogShareLinkId,
    videoView: videoViewId,
    linkOwner: linkOwnerId,
    originalCreator: originalCreatorId,
    grossEarningsUsd: gross,
    ownerShareUsd: ownerShare,
    royaltyUsd: royalty,
    royaltyRate,
  });

  await Promise.all([
    User.updateOne(
      { _id: linkOwnerId },
      {
        $inc: {
          ogEarnViews: 1,
          ogEarnBalanceUsd: ownerShare,
        },
      }
    ),
    User.updateOne(
      { _id: originalCreatorId },
      {
        $inc: {
          ogRoyaltyViews: 1,
          ogRoyaltyBalanceUsd: royalty,
        },
      }
    ),
    OgShareLink.updateOne({ _id: ogShareLinkId }, { $inc: { payableViewCount: 1 } }),
  ]);

  // Referral stacks on what the link owner actually earned (90% share)
  if (ownerShare > 0) {
    creditReferralBonusFromUsd({
      referredUserId: linkOwnerId,
      amountUsd: ownerShare,
      videoViewId,
    }).catch((err) => {
      console.error('Referral bonus from OG Earn failed:', err.message);
    });
  }
}

export async function listMyOgLinks(userId) {
  const links = await OgShareLink.find({ owner: userId, status: 'active' })
    .sort({ createdAt: -1 })
    .populate('video', 'title originalName duration size status thumbnailPublicId shareToken')
    .lean();

  return links
    .filter((l) => l.video && l.video.status !== 'failed')
    .map((l) => ({
      id: String(l._id),
      shareToken: l.shareToken,
      shareUrl: buildShareUrl(l.shareToken),
      viewCount: l.viewCount || 0,
      payableViewCount: l.payableViewCount || 0,
      createdAt: l.createdAt,
      video: {
        id: String(l.video._id),
        title: l.video.title,
        duration: l.video.duration,
        size: l.video.size,
        originalShareToken: l.video.shareToken,
      },
    }));
}

export async function getOgEarnSummary(userId) {
  const user = await User.findById(userId)
    .select('ogEarnViews ogEarnBalanceUsd ogRoyaltyViews ogRoyaltyBalanceUsd')
    .lean();
  if (!user) return null;

  const rules = getOgEarnRules();
  const linkCount = await OgShareLink.countDocuments({ owner: userId, status: 'active' });

  return {
    enabled: rules.enabled,
    royaltyRate: rules.royaltyRate,
    royaltyPercent: Math.round(rules.royaltyRate * 100),
    ownerSharePercent: Math.round((1 - rules.royaltyRate) * 100),
    linkCount,
    ogEarnViews: user.ogEarnViews || 0,
    ogEarnBalanceUsd: roundUsd(user.ogEarnBalanceUsd || 0),
    ogRoyaltyViews: user.ogRoyaltyViews || 0,
    ogRoyaltyBalanceUsd: roundUsd(user.ogRoyaltyBalanceUsd || 0),
  };
}
