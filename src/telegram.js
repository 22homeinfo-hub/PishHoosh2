// ماژول بات تلگرام
//
// تغییرات کلیدی نسبت به نسخه قبل:
// ۱) پاسخ‌های بلند به قطعات زیر ۴۰۹۶ کاراکتر شکسته می‌شوند (قبلاً کل پیام با خطای 400 از دست می‌رفت).
// ۲) پاسخ خالی به تلگرام فرستاده نمی‌شود (قبلاً «Bad Request: message text is empty»).
// ۳) نشانگر «در حال نوشتن…» تا پایان پردازش تمدید می‌شود (قبلاً بعد از ۵ ثانیه می‌پرید).
// ۴) کیبورد پیشنهادی با اسم پروژه‌ها نمایش داده می‌شود تا کاربر مجبور نباشد اسم را تایپ کند.
// ۵) هندلر خطای عمومی بات ثبت شده تا یک خطای پیش‌بینی‌نشده کل پروسه را نکشد.
// ۶) در گروه‌ها فقط وقتی ربات mention شود پاسخ می‌دهد (جلوگیری از مصرف بی‌رویه سهمیه).

import "./env.js";
import TelegramBot from "node-telegram-bot-api";
import { handleUserMessage, startOver } from "./conversation.js";
import { setNotifier } from "./notify.js";
import { chunkText } from "./text.js";

const TELEGRAM_MAX_LENGTH = 4096;
const ALLOW_GROUP_CHATS = String(process.env.ALLOW_GROUP_CHATS || "false").toLowerCase() === "true";
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID?.trim() || null;
const SOURCE_LABEL = "تلگرام";

// نشانگر تایپینگ را تا وقتی کار تمام نشده زنده نگه می‌دارد
function keepTyping(bot, chatId) {
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    try {
      await bot.sendChatAction(chatId, "typing");
    } catch {
      /* اهمیت ندارد */
    }
    if (!stopped) setTimeout(tick, 4000).unref?.();
  };
  tick();
  return () => {
    stopped = true;
  };
}

function keyboardMarkup(names) {
  if (!names?.length) return undefined;
  const buttons = names.slice(0, 12).map((name) => [{ text: String(name).slice(0, 60) }]);
  return { keyboard: buttons, resize_keyboard: true, one_time_keyboard: false };
}

async function reply(bot, chatId, result) {
  const text = String(result?.message ?? "").trim();
  if (!text) {
    // هرگز پیام خالی به تلگرام نمی‌فرستیم
    return bot.sendMessage(chatId, "متاسفانه پاسخی تولید نشد 🙏 لطفاً دوباره امتحان کنید.");
  }

  let replyMarkup;
  if (result.removeKeyboard) replyMarkup = { remove_keyboard: true };
  else if (result.keyboard?.length) replyMarkup = keyboardMarkup(result.keyboard);

  const chunks = chunkText(text, TELEGRAM_MAX_LENGTH - 100);
  for (let i = 0; i < chunks.length; i++) {
    const isLast = i === chunks.length - 1;
    await bot.sendMessage(chatId, chunks[i], isLast && replyMarkup ? { reply_markup: replyMarkup } : {});
  }
}

export function startTelegramBot() {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) {
    console.warn("⚠️ TELEGRAM_BOT_TOKEN تنظیم نشده؛ بات تلگرام غیرفعال است (فقط API وب بالا می‌آید).");
    return null;
  }

  const bot = new TelegramBot(token, { polling: { interval: 300, timeout: 20 } });
  let botId = null;

  // اطلاع‌رسانی به مدیر (اگر ADMIN_CHAT_ID تنظیم شده باشد)
  if (ADMIN_CHAT_ID) {
    setNotifier(async (message) => {
      for (const chunk of chunkText(message, TELEGRAM_MAX_LENGTH - 100)) {
        await bot.sendMessage(ADMIN_CHAT_ID, chunk);
      }
    });
  }

  const isUsableChat = (msg) => {
    if (!msg?.chat?.id) return false;
    if (msg.chat.type === "private") return true;
    if (!ALLOW_GROUP_CHATS) return false;
    const username = bot.options?.username;
    const mentioned = username ? msg.text?.includes(`@${username}`) : false;
    const isReplyToBot = botId ? msg.reply_to_message?.from?.id === botId : false;
    return Boolean(mentioned || isReplyToBot);
  };

  const runCommand = async (msg, text) => {
    const chatId = msg.chat.id;
    const key = `telegram:${chatId}`;
    const stopTyping = keepTyping(bot, chatId);
    try {
      const result = text ? await handleUserMessage(key, text, SOURCE_LABEL) : await startOver(key);
      await reply(bot, chatId, result);
    } catch (err) {
      console.error("❌ خطا در پردازش پیام تلگرام:", err.message || err);
      try {
        await bot.sendMessage(chatId, "متاسفانه خطایی پیش اومد 🙏 لطفاً دوباره امتحان کنید یا با دفتر تماس بگیرید.");
      } catch {
        /* ارسال پیام خطا هم شکست خورد؛ چیزی نمانده که بشود انجام داد */
      }
    } finally {
      stopTyping();
    }
  };

  bot.onText(/^\/(start|restart)(@\w+)?(\s.*)?$/i, async (msg, match) => {
    if (!isUsableChat(msg)) return;
    const command = match[1].toLowerCase();
    if (command === "restart") return runCommand(msg, "شروع مجدد");
    return runCommand(msg, null);
  });

  bot.on("message", async (msg) => {
    if (!isUsableChat(msg)) return;
    if (/^\/(start|restart)(@\w+)?/i.test(msg.text || "")) return; // در هندلر بالا پردازش شد
    if (/^\/[a-z]/i.test(msg.text || "")) return; // بقیهٔ دستورات تلگرام را نادیده می‌گیریم

    if (!msg.text) {
      try {
        await bot.sendMessage(msg.chat.id, "لطفاً اطلاعات فایل رو به‌صورت متن بنویسید 🙏");
      } catch {
        /* ignore */
      }
      return;
    }

    await runCommand(msg, msg.text.trim());
  });

  bot.on("polling_error", (err) => {
    const message = err?.message || String(err);
    // خطای 409 یعنی یک نمونهٔ دیگر از بات هم‌زمان polling می‌کند
    if (/409|conflict/i.test(message)) {
      console.error("❌ خطای 409 تلگرام: یک نمونهٔ دیگر از همین بات در حال اجراست. فقط یک instance فعال نگه دارید.");
      return;
    }
    console.error("خطای polling تلگرام:", message);
  });

  // بدون این هندلر، هر رویداد «error» می‌تواند پروسه را بیندازد
  bot.on("error", (err) => console.error("❌ خطای عمومی بات تلگرام:", err?.message || err));

  bot.getMe()
    .then((me) => {
      bot.options.username = me.username;
      botId = me.id;
      console.log(`✅ بات تلگرام فعال شد: @${me.username}`);
      if (ADMIN_CHAT_ID) console.log(`   اطلاع‌رسانی به مدیر فعال است (chat id: ${ADMIN_CHAT_ID})`);
    })
    .catch((err) => {
      console.error("❌ اتصال به تلگرام ناموفق بود (توکن یا شبکه را چک کنید):", err.message);
    });

  return bot;
}
