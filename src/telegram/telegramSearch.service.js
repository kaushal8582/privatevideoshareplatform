import Video from '../models/Video.js';
import storage from '../services/storage/storage.service.js';
import { buildShareUrl } from '../utils/validators.js';
import { normalizeSearchText } from './telegram.utils.js';

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Search ready (public shareable) videos by title / originalName.
 * Video schema has no description field — originalName is used as short caption fallback.
 */
export async function searchVideosForTelegram(rawQuery, { limit = 5 } = {}) {
  const normalized = normalizeSearchText(rawQuery);
  if (!normalized || normalized.length < 2) {
    return [];
  }

  const tokens = normalized.split(' ').filter(Boolean);
  if (tokens.length === 0) return [];

  // Allow flexible separators between tokens: "hero no 1" matches "Hero No. 1"
  const pattern = tokens.map(escapeRegex).join('[\\s._\\-]*');
  const regex = new RegExp(pattern, 'i');

  const docs = await Video.find({
    status: 'ready',
    $or: [{ title: regex }, { originalName: regex }],
  })
    .sort({ viewCount: -1, createdAt: -1 })
    .limit(limit)
    .select('title originalName shareToken duration viewCount storage createdAt')
    .lean();

  const results = [];
  for (const v of docs) {
    let thumbnailUrl = null;
    try {
      thumbnailUrl = await storage.getThumbnailUrl(
        v.storage?.thumbnailPublicId,
        v.storage?.publicId
      );
    } catch (err) {
      console.warn('[telegram] thumbnail resolve failed:', err?.message || err);
    }

    const title = v.title || v.originalName || 'Untitled';
    let shortDescription = '';
    if (v.originalName && normalizeSearchText(v.originalName) !== normalizeSearchText(title)) {
      shortDescription = String(v.originalName).slice(0, 160);
    }

    results.push({
      title,
      shortDescription,
      shareToken: v.shareToken,
      watchUrl: buildShareUrl(v.shareToken),
      thumbnailUrl: thumbnailUrl || null,
      viewCount: v.viewCount || 0,
      duration: v.duration,
    });
  }

  return results;
}
