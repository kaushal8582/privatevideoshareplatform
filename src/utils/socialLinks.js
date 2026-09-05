const MAX_SOCIAL_LINKS = 8;

const PLATFORM_HOSTS = [
  { id: 'instagram', match: /(^|\.)instagram\.com$/i },
  { id: 'youtube', match: /(^|\.)(youtube\.com|youtu\.be)$/i },
  { id: 'facebook', match: /(^|\.)(facebook\.com|fb\.com|fb\.watch)$/i },
  { id: 'x', match: /(^|\.)(twitter\.com|x\.com)$/i },
  { id: 'tiktok', match: /(^|\.)tiktok\.com$/i },
  { id: 'linkedin', match: /(^|\.)linkedin\.com$/i },
  { id: 'whatsapp', match: /(^|\.)(whatsapp\.com|wa\.me)$/i },
  { id: 'telegram', match: /(^|\.)(t\.me|telegram\.me|telegram\.org)$/i },
  { id: 'discord', match: /(^|\.)(discord\.gg|discord\.com)$/i },
  { id: 'github', match: /(^|\.)github\.com$/i },
  { id: 'reddit', match: /(^|\.)reddit\.com$/i },
  { id: 'snapchat', match: /(^|\.)snapchat\.com$/i },
];

export function normalizeSocialUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  return `https://${s}`;
}

export function detectSocialPlatform(url) {
  try {
    const host = new URL(normalizeSocialUrl(url)).hostname.replace(/^www\./i, '');
    for (const p of PLATFORM_HOSTS) {
      if (p.match.test(host)) return p.id;
    }
  } catch {
    /* ignore */
  }
  return 'link';
}

export function sanitizeSocialLinks(input) {
  if (input == null) return null;
  if (!Array.isArray(input)) {
    const err = new Error('Social links must be an array.');
    err.statusCode = 400;
    err.code = 'VALIDATION_ERROR';
    throw err;
  }
  if (input.length > MAX_SOCIAL_LINKS) {
    const err = new Error(`You can add at most ${MAX_SOCIAL_LINKS} social links.`);
    err.statusCode = 400;
    err.code = 'VALIDATION_ERROR';
    throw err;
  }

  const links = [];
  for (const item of input) {
    const title = String(item?.title || '').trim().slice(0, 80);
    const url = normalizeSocialUrl(item?.url);
    if (!url) continue;
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        const err = new Error('Social link URLs must start with http:// or https://.');
        err.statusCode = 400;
        err.code = 'VALIDATION_ERROR';
        throw err;
      }
    } catch (e) {
      if (e.statusCode) throw e;
      const err = new Error('Please enter a valid link URL.');
      err.statusCode = 400;
      err.code = 'VALIDATION_ERROR';
      throw err;
    }
    links.push({
      title,
      url: url.slice(0, 500),
      platform: detectSocialPlatform(url),
    });
  }
  return links;
}
