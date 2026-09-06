import { InlineKeyboardBuilder } from 'node-telegram-bot-api';
import { searchVideosForTelegram } from './telegramSearch.service.js';
import {
  connectDestinationFromTelegram,
  findActiveDestinationByChatId,
  syncDestinationMembership,
} from '../services/telegramIntegration.service.js';
import {
  createAdminCache,
  createSearchThrottle,
  escapeHtml,
  formatUserMention,
  isCommandMessage,
  isGroupChat,
  messageContainsLink,
  normalizeSearchText,
} from './telegram.utils.js';

const adminCache = createAdminCache();
const searchThrottle = createSearchThrottle(2000);
const connectThrottle = createSearchThrottle(3000);

let cachedBotId = null;

async function getBotId(api) {
  if (cachedBotId) return cachedBotId;
  const me = await api.getMe();
  cachedBotId = me.id;
  return cachedBotId;
}

export function registerTelegramHandlers(bot, config) {
  bot.catch((err, ctx) => {
    console.error(
      '[telegram] handler error:',
      err?.message || err,
      'update_id=',
      ctx?.update?.update_id
    );
  });

  bot.on('message', async (ctx) => {
    try {
      await handleIncomingChatMessage(ctx, config, 'message');
    } catch (err) {
      console.error('[telegram] message handling failed:', err?.message || err);
    }
  });

  bot.on('channel_post', async (ctx) => {
    try {
      // Channel posts live on update.channel_post
      const post = ctx.update?.channel_post;
      if (!post) return;
      // Adapt to same shape as message handler
      const fakeCtx = {
        ...ctx,
        message: post,
        chat: post.chat,
        from: post.sender_chat || post.from,
        chatId: post.chat?.id,
        api: ctx.api,
        reply: (text, other) =>
          ctx.api.sendMessage({
            chat_id: post.chat.id,
            text,
            ...(other || {}),
          }),
      };
      await handleIncomingChatMessage(fakeCtx, config, 'channel_post');
    } catch (err) {
      console.error('[telegram] channel_post handling failed:', err?.message || err);
    }
  });

  bot.on('my_chat_member', async (ctx) => {
    try {
      await handleMyChatMember(ctx);
    } catch (err) {
      console.error('[telegram] my_chat_member failed:', err?.message || err);
    }
  });
}

async function handleIncomingChatMessage(ctx, config, source) {
  const message = ctx.message;
  if (!message) return;

  const chat = ctx.chat || message.chat;
  const from = ctx.from || message.from;

  console.log(
    `[telegram] inbound source=${source} chatType=${chat?.type || '?'} chatId=${chat?.id} text=${JSON.stringify(String(message?.text || '').slice(0, 80))}`
  );

  if (chat?.type === 'private') {
    const text = String(message.text || '').trim();
    if (/^\/connect/i.test(text)) {
      await ctx.reply(
        'Connect only works inside a group or channel.\n\n1) Add this bot to your group/channel\n2) Send /connect YOUR-CODE there'
      );
      return;
    }
    try {
      await ctx.reply(
        'This bot works in Telegram groups/channels.\n\nStudio → Telegram: generate a code, add me, then send /connect CODE in the group.'
      );
    } catch {
      /* ignore */
    }
    return;
  }

  const text = String(message.text || message.caption || '').trim();

  // /connect CODE
  const connectMatch = text.match(/^\/connect(?:@\w+)?(?:\s+|$)(.+)?$/i);
  if (connectMatch) {
    await handleConnectCommand(ctx, connectMatch[1] || '', from);
    return;
  }

  if (!isGroupChat(chat) && chat?.type !== 'channel') return;
  if (from?.is_bot) return;

  const destination = await findActiveDestinationByChatId(chat.id);

  // Defaults for unconnected chats (preserve existing bot behavior)
  const deleteLinks =
    destination?.settings?.deleteLinks ?? config.deleteLinks;
  const searchEnabled =
    destination?.settings?.searchEnabled ?? config.searchEnabled;
  const adminBypass = destination?.settings?.adminBypass !== false;

  if (deleteLinks && messageContainsLink(message) && from?.id) {
    let isAdmin = false;
    if (adminBypass) {
      isAdmin = await adminCache.isAdmin(ctx.api, chat.id, from.id);
    }
    if (!isAdmin) {
      await deleteUserLinkMessage(ctx, chat.id, message.message_id);
      return;
    }
    return;
  }

  if (!searchEnabled) return;
  if (isCommandMessage(message)) return;
  if (!text) return;
  // Channels usually shouldn't run search on every post
  if (chat?.type === 'channel') return;

  const normalized = normalizeSearchText(text);
  if (normalized.length < 2) return;

  if (from?.id && !searchThrottle.allow(from.id)) {
    console.log(`[telegram] search throttled user=${from.id}`);
    return;
  }

  console.log(`[telegram] search query="${normalized}" chat=${chat.id}`);

  let results = [];
  try {
    results = await searchVideosForTelegram(text, { limit: config.searchLimit });
  } catch (err) {
    console.error('[telegram] search database error:', err?.message || err);
    return;
  }

  if (!results.length) {
    await replyNotFound(ctx, text, from);
    return;
  }

  console.log(`[telegram] results found total=${results.length}`);
  for (let i = 0; i < results.length; i += 1) {
    await replyWithVideoResult(ctx, results[i], from, {
      replyToUser: i === 0,
      index: i + 1,
      total: results.length,
    });
  }
}

async function handleConnectCommand(ctx, rawCode, from) {
  const chat = ctx.chat || ctx.message?.chat;
  if (!rawCode?.trim()) {
    await safeReply(
      ctx,
      'Usage: <code>/connect MP-XXXXX</code>\n\nGenerate a code in MastPlayer Studio → Telegram.',
      true
    );
    return;
  }

  if (from?.id && !connectThrottle.allow(from.id)) {
    await safeReply(ctx, '⏳ Please wait a moment before trying again.');
    return;
  }

  try {
    const botId = await getBotId(ctx.api);
    const result = await connectDestinationFromTelegram({
      rawCode,
      chat,
      botApi: ctx.api,
      botUserId: botId,
    });

    await safeReply(ctx, result.message, true);
  } catch (err) {
    console.error('[telegram] /connect failed:', err?.message || err);
    await safeReply(ctx, '❌ Could not complete connection. Try a new code from Studio.');
  }
}

async function handleMyChatMember(ctx) {
  const update = ctx.update?.my_chat_member;
  if (!update) return;

  const chat = update.chat;
  const newMember = update.new_chat_member;
  const status = newMember?.status;
  const permissions = {
    canPostMessages: Boolean(
      newMember?.can_post_messages || status === 'creator' || chat?.type !== 'channel'
    ),
    canDeleteMessages: Boolean(newMember?.can_delete_messages || status === 'creator'),
  };

  if (chat?.type === 'channel' && status === 'administrator') {
    permissions.canPostMessages = Boolean(newMember?.can_post_messages);
  }

  console.log(
    `[telegram] my_chat_member chat=${chat?.id} status=${status} type=${chat?.type}`
  );

  await syncDestinationMembership({
    chatId: chat.id,
    chat,
    newStatus: status,
    permissions,
  });
}

async function safeReply(ctx, text, html = false) {
  try {
    if (typeof ctx.reply === 'function') {
      await ctx.reply(text, html ? { parse_mode: 'HTML' } : undefined);
      return;
    }
    await ctx.api.sendMessage({
      chat_id: ctx.chatId || ctx.chat?.id || ctx.message?.chat?.id,
      text,
      parse_mode: html ? 'HTML' : undefined,
    });
  } catch (err) {
    console.warn('[telegram] reply failed:', err?.message || err);
  }
}

function isAllowedChatId(chatId, allowedChatIds) {
  if (!allowedChatIds || allowedChatIds.length === 0) return true;
  return allowedChatIds.includes(Number(chatId));
}

async function deleteUserLinkMessage(ctx, chatId, messageId) {
  try {
    await ctx.api.deleteMessage({ chat_id: chatId, message_id: messageId });
    console.log(`[telegram] link deleted chat=${chatId} message=${messageId}`);
  } catch (err) {
    const msg = err?.message || String(err);
    if (/not enough rights|can't delete|CHAT_ADMIN_REQUIRED|MESSAGE_DELETE/i.test(msg)) {
      console.warn(
        '[telegram] Telegram bot cannot delete message. Make sure bot is group admin with Delete Messages permission.'
      );
    } else {
      console.warn('[telegram] link deletion failed:', msg);
    }
  }
}

async function replyNotFound(ctx, requestedTitle, from) {
  const mention = formatUserMention(from);
  const title = escapeHtml(String(requestedTitle || '').trim().slice(0, 120));
  const text =
    `❌ Not found\n\n` +
    `Your request: <b>${title}</b>\n` +
    `${mention}, no matching video was found on MastPlayer.`;

  try {
    await ctx.api.sendMessage({
      chat_id: ctx.chatId || ctx.message?.chat?.id,
      text,
      parse_mode: 'HTML',
      reply_parameters: ctx.message?.message_id
        ? { message_id: ctx.message.message_id, allow_sending_without_reply: true }
        : undefined,
      link_preview_options: { is_disabled: true },
    });
  } catch (err) {
    console.warn('[telegram] not-found reply failed:', err?.message || err);
  }
}

async function replyWithVideoResult(ctx, video, from, options = {}) {
  const { replyToUser = true, index = 1, total = 1 } = options;
  const mention = formatUserMention(from);
  const title = escapeHtml(video.title);
  const desc = video.shortDescription
    ? `\n\n${escapeHtml(video.shortDescription)}`
    : '';
  const counter = total > 1 ? `\nResult ${index}/${total}` : '';

  const caption = `🎬 <b>${title}</b>${desc}\n\nRequested by ${mention}${counter}`;
  const keyboard = new InlineKeyboardBuilder()
    .url('▶️ Watch Now', video.watchUrl)
    .build();

  const chatId = ctx.chatId || ctx.message?.chat?.id;
  const common = {
    chat_id: chatId,
    parse_mode: 'HTML',
    reply_markup: keyboard,
    reply_parameters:
      replyToUser && ctx.message?.message_id
        ? { message_id: ctx.message.message_id, allow_sending_without_reply: true }
        : undefined,
  };

  try {
    if (video.thumbnailUrl) {
      await ctx.api.sendPhoto({
        ...common,
        photo: video.thumbnailUrl,
        caption,
      });
    } else {
      await ctx.api.sendMessage({
        ...common,
        text: caption,
        link_preview_options: { is_disabled: true },
      });
    }
  } catch (err) {
    console.warn('[telegram] send result failed, retrying simple message:', err?.message || err);
    try {
      await ctx.api.sendMessage({
        chat_id: chatId,
        text: caption,
        parse_mode: 'HTML',
        reply_markup: keyboard,
        link_preview_options: { is_disabled: true },
      });
    } catch (err2) {
      console.error('[telegram] send result failed:', err2?.message || err2);
    }
  }
}

// keep export for tests / avoid unused lint if tree-shaken
export { isAllowedChatId };
