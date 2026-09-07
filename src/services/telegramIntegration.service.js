import crypto from 'crypto';
import TelegramConnectionCode from '../models/TelegramConnectionCode.js';
import TelegramDestination from '../models/TelegramDestination.js';
import TelegramPublication from '../models/TelegramPublication.js';
import Video from '../models/Video.js';
import storage from '../services/storage/storage.service.js';
import { buildShareUrl } from '../utils/validators.js';
import { escapeHtml } from '../telegram/telegram.utils.js';
import { getTelegramBot } from '../telegram/telegramBot.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function getConnectCodeTtlMinutes() {
  const n = Number(process.env.TELEGRAM_CONNECT_CODE_TTL_MINUTES) || 10;
  return Math.max(1, Math.min(60, n));
}

export function getBotUsername() {
  return String(process.env.TELEGRAM_BOT_USERNAME || '').replace(/^@/, '').trim() || null;
}

export function generateConnectionCode() {
  const bytes = crypto.randomBytes(5);
  let body = '';
  for (let i = 0; i < 5; i += 1) {
    body += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return `MP-${body}`;
}

export async function createConnectionCode(userId) {
  await TelegramConnectionCode.updateMany(
    { userId, status: 'pending' },
    { $set: { status: 'expired' } }
  );

  const ttlMin = getConnectCodeTtlMinutes();
  const expiresAt = new Date(Date.now() + ttlMin * 60 * 1000);

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = generateConnectionCode();
    try {
      const doc = await TelegramConnectionCode.create({
        userId,
        code,
        status: 'pending',
        expiresAt,
      });
      return doc;
    } catch (err) {
      if (err?.code === 11000) continue;
      throw err;
    }
  }
  throw new Error('Could not generate a unique connection code.');
}

export function formatDestination(doc) {
  if (!doc) return null;
  const perms = doc.permissions || {};
  const settings = doc.settings || {};
  const mf = settings.messageFormat || {};
  const type = doc.type;
  let actionRequired = false;
  let actionHint = null;

  if (doc.isActive) {
    if (type === 'channel' && !perms.canPostMessages) {
      actionRequired = true;
      actionHint = 'Bot needs Post Messages permission';
    }
    if ((type === 'group' || type === 'supergroup') && settings.deleteLinks && !perms.canDeleteMessages) {
      actionRequired = true;
      actionHint = 'Bot needs Delete Messages permission';
    }
  }

  return {
    id: String(doc._id),
    title: doc.title,
    username: doc.username || null,
    type: doc.type,
    telegramChatId: doc.telegramChatId,
    memberCount: doc.memberCount,
    botStatus: doc.botStatus,
    permissions: {
      canPostMessages: Boolean(perms.canPostMessages),
      canDeleteMessages: Boolean(perms.canDeleteMessages),
    },
    settings: {
      autoPublish: Boolean(settings.autoPublish),
      deleteLinks: settings.deleteLinks !== false,
      searchEnabled: settings.searchEnabled !== false,
      adminBypass: settings.adminBypass !== false,
      includeThumbnail: settings.includeThumbnail !== false,
      includeDescription: settings.includeDescription !== false,
      messageFormat: {
        beforeTitle: String(mf.beforeTitle || ''),
        afterTitle: String(mf.afterTitle || ''),
        afterLink: String(mf.afterLink || ''),
        footer: String(mf.footer || ''),
      },
    },
    isActive: Boolean(doc.isActive),
    actionRequired,
    actionHint,
    connectedAt: doc.connectedAt,
    disconnectedAt: doc.disconnectedAt,
  };
}

function sanitizeMessageSlot(value, max = 400) {
  if (value == null) return undefined;
  return String(value).trim().slice(0, max);
}

/**
 * Build publish caption from locked core (title + link) + optional slots.
 * Telegram photo caption max ≈ 1024 chars.
 */
export function buildPublishCaption({ title, watchUrl, messageFormat = {} }) {
  const mf = messageFormat || {};
  const parts = [];

  const beforeTitle = sanitizeMessageSlot(mf.beforeTitle);
  if (beforeTitle) parts.push(escapeHtml(beforeTitle));

  parts.push(`🎬 <b>${escapeHtml(title || 'Untitled')}</b>`);

  const afterTitle = sanitizeMessageSlot(mf.afterTitle);
  if (afterTitle) parts.push(escapeHtml(afterTitle));

  const link = String(watchUrl || '').trim();
  if (link) parts.push(link);

  const afterLink = sanitizeMessageSlot(mf.afterLink);
  if (afterLink) parts.push(escapeHtml(afterLink));

  const footer = sanitizeMessageSlot(mf.footer);
  if (footer) parts.push(escapeHtml(footer));

  let caption = parts.join('\n\n');
  const MAX = 1024;
  if (caption.length > MAX) {
    caption = `${caption.slice(0, MAX - 1)}…`;
  }
  return caption;
}

export async function listDestinationsForUser(userId) {
  const docs = await TelegramDestination.find({ userId })
    .sort({ isActive: -1, connectedAt: -1 })
    .lean();
  return docs.map(formatDestination);
}

export async function updateDestinationSettings(userId, destinationId, patch) {
  const boolKeys = [
    'autoPublish',
    'deleteLinks',
    'searchEnabled',
    'adminBypass',
    'includeThumbnail',
    'includeDescription',
  ];
  const $set = {};
  for (const key of boolKeys) {
    if (Object.prototype.hasOwnProperty.call(patch || {}, key)) {
      $set[`settings.${key}`] = Boolean(patch[key]);
    }
  }

  const mf = patch?.messageFormat;
  if (mf && typeof mf === 'object') {
    for (const key of ['beforeTitle', 'afterTitle', 'afterLink', 'footer']) {
      if (Object.prototype.hasOwnProperty.call(mf, key)) {
        $set[`settings.messageFormat.${key}`] = sanitizeMessageSlot(mf[key], 400) || '';
      }
    }
  }

  if (Object.keys($set).length === 0) {
    const err = new Error('No valid settings provided.');
    err.statusCode = 400;
    err.code = 'VALIDATION_ERROR';
    throw err;
  }

  const doc = await TelegramDestination.findOneAndUpdate(
    { _id: destinationId, userId },
    { $set },
    { new: true }
  );
  if (!doc) {
    const err = new Error('Telegram destination not found.');
    err.statusCode = 404;
    err.code = 'NOT_FOUND';
    throw err;
  }
  return formatDestination(doc.toObject());
}

export async function disconnectDestination(userId, destinationId) {
  const doc = await TelegramDestination.findOneAndUpdate(
    { _id: destinationId, userId },
    { $set: { isActive: false, disconnectedAt: new Date() } },
    { new: true }
  );
  if (!doc) {
    const err = new Error('Telegram destination not found.');
    err.statusCode = 404;
    err.code = 'NOT_FOUND';
    throw err;
  }
  return formatDestination(doc.toObject());
}

/**
 * Resolve destinations for publish: selected IDs + autoPublish, owned & active only.
 */
export async function resolvePublishDestinations(userId, selectedIds = []) {
  const ids = Array.isArray(selectedIds)
    ? selectedIds.map(String).filter((id) => /^[a-f\d]{24}$/i.test(id))
    : [];

  const or = [{ userId, isActive: true, 'settings.autoPublish': true }];
  if (ids.length) {
    or.push({ userId, isActive: true, _id: { $in: ids } });
  }

  const docs = await TelegramDestination.find({ $or: or }).lean();
  const byId = new Map();
  for (const d of docs) byId.set(String(d._id), d);
  return [...byId.values()];
}

export async function queueVideoTelegramPublish(userId, videoId, selectedDestinationIds = []) {
  try {
    const destinations = await resolvePublishDestinations(userId, selectedDestinationIds);
    if (!destinations.length) {
      return { queued: 0, publications: [] };
    }

    const publications = [];
    for (const dest of destinations) {
      let pub = await TelegramPublication.findOne({
        videoId,
        telegramDestinationId: dest._id,
      });
      if (!pub) {
        pub = await TelegramPublication.create({
          userId,
          videoId,
          telegramDestinationId: dest._id,
          telegramChatId: dest.telegramChatId,
          status: 'pending',
        });
      }
      publications.push(pub);
    }

    // Non-blocking — upload must not wait on Telegram
    setImmediate(() => {
      void processPublications(publications.map((p) => String(p._id)));
    });

    return {
      queued: publications.length,
      publications: publications.map((p) => ({
        id: String(p._id),
        telegramDestinationId: String(p.telegramDestinationId),
        status: p.status,
      })),
    };
  } catch (err) {
    console.error('[telegram] queue publish failed:', err?.message || err);
    return { queued: 0, publications: [], error: err?.message };
  }
}

async function processPublications(publicationIds) {
  for (const id of publicationIds) {
    try {
      await publishOne(id);
    } catch (err) {
      console.error(`[telegram] publish ${id} failed:`, err?.message || err);
    }
  }
}

export async function publishOne(publicationId) {
  const pub = await TelegramPublication.findById(publicationId);
  if (!pub) return null;
  if (pub.status === 'published') return pub;

  pub.status = 'publishing';
  pub.attempts = (pub.attempts || 0) + 1;
  await pub.save();

  const bot = getTelegramBot();
  if (!bot) {
    pub.status = 'failed';
    pub.error = 'Telegram bot is not running.';
    await pub.save();
    return pub;
  }

  const [video, destination] = await Promise.all([
    Video.findById(pub.videoId).lean(),
    TelegramDestination.findById(pub.telegramDestinationId).lean(),
  ]);

  if (!video || video.status !== 'ready') {
    pub.status = 'failed';
    pub.error = 'Video not available.';
    await pub.save();
    return pub;
  }

  if (!destination || !destination.isActive) {
    pub.status = 'failed';
    pub.error = 'Destination inactive or missing.';
    await pub.save();
    return pub;
  }

  const settings = destination.settings || {};
  const watchUrl = buildShareUrl(video.shareToken);
  const caption = buildPublishCaption({
    title: video.title || 'Untitled',
    watchUrl,
    messageFormat: settings.messageFormat,
  });

  let thumbnailUrl = null;
  if (settings.includeThumbnail !== false) {
    try {
      thumbnailUrl = await storage.getThumbnailUrl(
        video.storage?.thumbnailPublicId,
        video.storage?.publicId
      );
    } catch {
      thumbnailUrl = null;
    }
  }

  try {
    let messageId = null;
    if (thumbnailUrl) {
      try {
        const sent = await bot.api.sendPhoto({
          chat_id: destination.telegramChatId,
          photo: thumbnailUrl,
          caption,
          parse_mode: 'HTML',
          link_preview_options: { is_disabled: true },
        });
        messageId = sent?.message_id;
      } catch (photoErr) {
        console.warn('[telegram] sendPhoto failed, fallback text:', photoErr?.message || photoErr);
        const sent = await bot.api.sendMessage({
          chat_id: destination.telegramChatId,
          text: caption,
          parse_mode: 'HTML',
          link_preview_options: { is_disabled: true },
        });
        messageId = sent?.message_id;
      }
    } else {
      const sent = await bot.api.sendMessage({
        chat_id: destination.telegramChatId,
        text: caption,
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
      });
      messageId = sent?.message_id;
    }

    pub.status = 'published';
    pub.telegramMessageId = messageId != null ? String(messageId) : null;
    pub.publishedAt = new Date();
    pub.error = null;
    await pub.save();
    console.log(
      `[telegram] published video=${video._id} chat=${destination.telegramChatId} msg=${pub.telegramMessageId}`
    );
    return pub;
  } catch (err) {
    pub.status = 'failed';
    pub.error = String(err?.message || err).slice(0, 1000);
    await pub.save();
    console.error('[telegram] publish error:', pub.error);
    return pub;
  }
}

export async function listPublicationsForVideo(userId, videoId) {
  const pubs = await TelegramPublication.find({ userId, videoId })
    .populate('telegramDestinationId', 'title type isActive')
    .sort({ createdAt: 1 })
    .lean();

  return pubs.map((p) => ({
    id: String(p._id),
    status: p.status,
    error: p.error,
    publishedAt: p.publishedAt,
    telegramMessageId: p.telegramMessageId,
    destination: p.telegramDestinationId
      ? {
          id: String(p.telegramDestinationId._id),
          title: p.telegramDestinationId.title,
          type: p.telegramDestinationId.type,
          isActive: p.telegramDestinationId.isActive,
        }
      : null,
  }));
}

export async function findActiveDestinationByChatId(telegramChatId) {
  return TelegramDestination.findOne({
    telegramChatId: String(telegramChatId),
    isActive: true,
  }).lean();
}

/**
 * Complete /connect from inside a Telegram chat. chatId MUST come from Telegram update.
 */
export async function connectDestinationFromTelegram({
  rawCode,
  chat,
  botApi,
  botUserId,
}) {
  const code = String(rawCode || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');

  if (!/^MP-[A-Z0-9]{4,12}$/.test(code)) {
    return { ok: false, message: '❌ Invalid connection code format.' };
  }

  const chatId = String(chat?.id ?? '');
  const chatType = chat?.type;
  if (!chatId || !['group', 'supergroup', 'channel'].includes(chatType)) {
    return {
      ok: false,
      message: '❌ Connect only works inside a Telegram group or channel.',
    };
  }

  const doc = await TelegramConnectionCode.findOne({ code });
  if (!doc || doc.status === 'expired') {
    return { ok: false, message: '❌ Invalid or expired connection code.' };
  }
  if (doc.status === 'used') {
    return { ok: false, message: '❌ This connection code has already been used.' };
  }
  if (doc.expiresAt && doc.expiresAt.getTime() < Date.now()) {
    doc.status = 'expired';
    await doc.save();
    return { ok: false, message: '❌ Invalid or expired connection code.' };
  }

  let botStatus = 'member';
  const permissions = { canPostMessages: false, canDeleteMessages: false };

  try {
    const member = await botApi.getChatMember({
      chat_id: chatId,
      user_id: botUserId,
    });
    botStatus = member?.status || 'unknown';
    if (member?.status === 'administrator' || member?.status === 'creator') {
      permissions.canDeleteMessages = Boolean(
        member.can_delete_messages || member.status === 'creator'
      );
      if (chatType === 'channel') {
        permissions.canPostMessages = Boolean(
          member.can_post_messages || member.status === 'creator'
        );
      } else {
        permissions.canPostMessages = true;
      }
    } else if (chatType !== 'channel') {
      permissions.canPostMessages = true;
    }
  } catch (err) {
    console.warn('[telegram] connect getChatMember failed:', err?.message || err);
  }

  let memberCount = null;
  try {
    memberCount = await botApi.getChatMemberCount({ chat_id: chatId });
  } catch {
    /* optional */
  }

  const title = chat.title || chat.username || 'Telegram chat';
  const username = chat.username || null;

  const destination = await TelegramDestination.findOneAndUpdate(
    { userId: doc.userId, telegramChatId: chatId },
    {
      $set: {
        title,
        username,
        type: chatType,
        botStatus,
        memberCount,
        permissions,
        isActive: true,
        connectedAt: new Date(),
        disconnectedAt: null,
      },
      $setOnInsert: {
        userId: doc.userId,
        telegramChatId: chatId,
        settings: {
          autoPublish: false,
          deleteLinks: true,
          searchEnabled: true,
          adminBypass: true,
          includeThumbnail: true,
          includeDescription: true,
          messageFormat: {
            beforeTitle: '',
            afterTitle: '',
            afterLink: '',
            footer: '',
          },
        },
      },
    },
    { upsert: true, new: true }
  );

  doc.status = 'used';
  doc.usedAt = new Date();
  await doc.save();

  console.log(
    `[telegram] connected chat=${chatId} user=${doc.userId} destination=${destination._id}`
  );

  return {
    ok: true,
    destination,
    message:
      `✅ Connected successfully!\n\n` +
      `<b>${escapeHtml(title)}</b> is now connected to your MastPlayer account.\n\n` +
      `You can publish videos to this destination from Studio → Upload.`,
  };
}

export async function syncDestinationMembership({
  chatId,
  chat,
  newStatus,
  permissions = {},
}) {
  const id = String(chatId);
  const dest = await TelegramDestination.findOne({ telegramChatId: id });
  if (!dest) return null;

  const left = ['left', 'kicked'].includes(newStatus);
  dest.botStatus = newStatus || dest.botStatus;
  if (permissions.canPostMessages != null) {
    dest.permissions.canPostMessages = Boolean(permissions.canPostMessages);
  }
  if (permissions.canDeleteMessages != null) {
    dest.permissions.canDeleteMessages = Boolean(permissions.canDeleteMessages);
  }
  if (chat?.title) dest.title = chat.title;
  if (chat?.username != null) dest.username = chat.username || null;
  if (chat?.type) dest.type = chat.type;

  if (left) {
    dest.isActive = false;
    dest.disconnectedAt = new Date();
  } else if (['administrator', 'creator', 'member'].includes(newStatus)) {
    // Only reactivate if it was previously connected (exists) — keep isActive as user set
    // unless it was kicked; then user must reconnect. If promoted again after kick:
    if (dest.disconnectedAt && !dest.isActive) {
      // Stay inactive until /connect again — safer ownership
    }
  }

  await dest.save();
  return dest;
}
