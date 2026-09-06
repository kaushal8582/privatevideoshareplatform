import { Bot } from 'node-telegram-bot-api';
import { registerTelegramHandlers } from './telegramHandlers.js';
import { getTelegramConfig } from './telegram.utils.js';

let botInstance = null;
let pollingPromise = null;
let started = false;

/**
 * Start Telegram long-polling bot once per process (after Mongo is connected).
 */
export async function startTelegramBot() {
  if (started) {
    console.log('[telegram] already started — skipping duplicate start');
    return botInstance;
  }

  const config = getTelegramConfig();

  if (!config.enabled) {
    console.log('[telegram] disabled (TELEGRAM_BOT_ENABLED=false)');
    return null;
  }

  if (!config.token) {
    console.warn(
      '[telegram] TELEGRAM_BOT_ENABLED=true but TELEGRAM_BOT_TOKEN is missing — bot not started'
    );
    return null;
  }

  if (config.mode !== 'polling') {
    console.warn(
      `[telegram] TELEGRAM_BOT_MODE=${config.mode} is not supported yet — use polling`
    );
    return null;
  }

  started = true;

  try {
    const bot = new Bot(config.token);
    registerTelegramHandlers(bot, config);
    botInstance = bot;

    // Clear any old webhook so long polling can receive updates
    try {
      await bot.api.deleteWebhook({ drop_pending_updates: false });
    } catch (err) {
      console.warn('[telegram] deleteWebhook warning:', err?.message || err);
    }

    // Do not await forever — startPolling resolves only when stopped
    pollingPromise = bot
      .startPolling(undefined, {
        timeout: 30,
        allowedUpdates: ['message', 'channel_post', 'my_chat_member'],
        onError: (err) => {
          console.warn('[telegram] poll retry:', err?.message || err);
        },
      })
      .then(() => {
        console.log('[telegram] polling stopped');
      })
      .catch((err) => {
        console.error('[telegram] polling error:', err?.message || err);
        started = false;
        botInstance = null;
      });

    // Confirm identity without blocking forever
    bot.api
      .getMe()
      .then((me) => {
        console.log(
          `[telegram] bot started as @${me.username || me.id} (polling) deleteLinks=${config.deleteLinks} search=${config.searchEnabled}`
        );
        console.log(
          '[telegram] IMPORTANT: @BotFather → /setprivacy → Disable, then remove+re-add bot to the group'
        );
      })
      .catch((err) => {
        console.error('[telegram] getMe failed:', err?.message || err);
      });

    return bot;
  } catch (err) {
    started = false;
    botInstance = null;
    console.error('[telegram] failed to start:', err?.message || err);
    return null;
  }
}

export async function stopTelegramBot() {
  if (!botInstance) return;
  try {
    if (botInstance.isRunning()) {
      botInstance.stop();
    }
    if (pollingPromise) {
      await Promise.race([
        pollingPromise,
        new Promise((resolve) => setTimeout(resolve, 3000)),
      ]);
    }
    console.log('[telegram] bot stopped');
  } catch (err) {
    console.warn('[telegram] stop error:', err?.message || err);
  } finally {
    botInstance = null;
    pollingPromise = null;
    started = false;
  }
}

export function getTelegramBot() {
  return botInstance;
}
