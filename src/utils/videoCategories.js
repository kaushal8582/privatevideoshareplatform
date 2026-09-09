export const VIDEO_CATEGORIES = [
  'movie',
  'web_series',
  'adult',
  'porn',
  'other',
];

export const DEFAULT_VIDEO_CATEGORY = 'adult';

/** Never appear in Telegram group search bot results. Publish to Telegram is still allowed. */
export const TELEGRAM_SEARCH_BLOCKED_CATEGORIES = ['adult', 'porn'];

export const TELEGRAM_SEARCH_ALLOWED_CATEGORIES = VIDEO_CATEGORIES.filter(
  (c) => !TELEGRAM_SEARCH_BLOCKED_CATEGORIES.includes(c)
);

export function normalizeVideoCategory(raw) {
  const value = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

  if (VIDEO_CATEGORIES.includes(value)) return value;
  return DEFAULT_VIDEO_CATEGORY;
}

export function isTelegramSearchBlockedCategory(category) {
  return TELEGRAM_SEARCH_BLOCKED_CATEGORIES.includes(
    normalizeVideoCategory(category)
  );
}
