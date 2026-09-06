/**
 * Telegram helpers — env flags, chat allowlist, HTML escaping, link detection.
 */

const TRUTHY = new Set(['1', 'true', 'yes', 'on']);

export function envFlag(name, defaultValue = false) {
  const raw = process.env[name];
  if (raw == null || raw === '') return defaultValue;
  return TRUTHY.has(String(raw).trim().toLowerCase());
}

export function getTelegramConfig() {
  const enabled = envFlag('TELEGRAM_BOT_ENABLED', false);
  const token = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const mode = String(process.env.TELEGRAM_BOT_MODE || 'polling').trim().toLowerCase();
  const deleteLinks = envFlag('TELEGRAM_DELETE_LINKS', true);
  const searchEnabled = envFlag('TELEGRAM_SEARCH_ENABLED', true);
  const searchLimit = Math.max(1, Math.min(10, Number(process.env.TELEGRAM_SEARCH_LIMIT) || 5));
  const allowedChatIds = String(process.env.TELEGRAM_ALLOWED_CHAT_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n));

  return {
    enabled,
    token,
    mode,
    deleteLinks,
    searchEnabled,
    searchLimit,
    allowedChatIds,
  };
}

export function isAllowedChat(chatId, allowedChatIds = []) {
  if (!allowedChatIds || allowedChatIds.length === 0) return true;
  return allowedChatIds.includes(Number(chatId));
}

export function isGroupChat(chat) {
  const type = chat?.type;
  return type === 'group' || type === 'supergroup';
}

/** Normalize search text: "Hero No. 1" / "HERO   NO 1" → "hero no 1" */
export function normalizeSearchText(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function formatUserMention(user) {
  if (!user) return 'someone';
  if (user.username) return `@${escapeHtml(user.username)}`;
  const name =
    [user.first_name, user.last_name].filter(Boolean).join(' ').trim() || 'User';
  return `<a href="tg://user?id=${user.id}">${escapeHtml(name)}</a>`;
}

const LINK_REGEX =
  /(?:https?:\/\/|www\.|t\.me\/)[^\s<>"']+/i;

/**
 * Detect URLs via Telegram entities and fallback regex.
 */
export function messageContainsLink(message) {
  const entities = [
    ...(message?.entities || []),
    ...(message?.caption_entities || []),
  ];
  for (const ent of entities) {
    if (ent?.type === 'url' || ent?.type === 'text_link') return true;
  }
  const text = `${message?.text || ''} ${message?.caption || ''}`;
  return LINK_REGEX.test(text);
}

export function isCommandMessage(message) {
  const text = String(message?.text || '').trim();
  if (!text.startsWith('/')) return false;
  // Telegram bot commands: /start, /help@BotName
  return /^\/[a-z0-9_]+(@\w+)?(\s|$)/i.test(text);
}

const ADMIN_STATUSES = new Set(['creator', 'administrator']);

export function createAdminCache(ttlMs = 5 * 60 * 1000) {
  const cache = new Map();

  return {
    async isAdmin(api, chatId, userId) {
      const key = `${chatId}:${userId}`;
      const hit = cache.get(key);
      if (hit && hit.expiresAt > Date.now()) return hit.isAdmin;

      try {
        const member = await api.getChatMember({ chat_id: chatId, user_id: userId });
        const isAdmin = ADMIN_STATUSES.has(member?.status);
        cache.set(key, { isAdmin, expiresAt: Date.now() + ttlMs });
        return isAdmin;
      } catch (err) {
        console.warn(
          `[telegram] getChatMember failed for chat=${chatId} user=${userId}:`,
          err?.message || err
        );
        cache.set(key, { isAdmin: false, expiresAt: Date.now() + Math.min(ttlMs, 60_000) });
        return false;
      }
    },
    clear() {
      cache.clear();
    },
  };
}

export function createSearchThrottle(minIntervalMs = 2000) {
  const lastAt = new Map();

  return {
    allow(userId) {
      const id = String(userId);
      const now = Date.now();
      const prev = lastAt.get(id) || 0;
      if (now - prev < minIntervalMs) return false;
      lastAt.set(id, now);
      // prune occasionally
      if (lastAt.size > 5000) {
        for (const [k, t] of lastAt) {
          if (now - t > 60_000) lastAt.delete(k);
        }
      }
      return true;
    },
  };
}
