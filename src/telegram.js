// ماژول بات تلگرام
//
// تغییرات کلیدی نسبت به نسخه قبل:
// ۱) پاسخ‌های بلند به قطعات زیر ۴۰۹۶ کاراکتر شکسته می‌شوند (قبلاً کل پیام با خطای 400 از دست می‌رفت).
// ۲) پاسخ خالی به تلگرام فرستاده نمی‌شود (قبلاً «Bad Request: message text is empty»).
// ۳) نشانگر «در حال نوشتن…» تا پایان پردازش تمدید می‌شود (قبلاً بعد از ۵ ثانیه می‌پرید).
// ۴) کیبورد پیشنهادی با اسم پروژه‌ها نمایش داده می‌شود تا کاربر مجبور نباشد اسم را تایپ کند.
// ۵) هندلر خطای عمومی بات ثبت شده تا یک خطای پیش‌بینی‌نشده کل پروسه را نکشد.
// ۶) در گروه‌ها فقط وقتی ربات mention شود پاسخ می‌دهد (جلوگیری از مصرف بی‌رویه سهمیه).
// ۷) [جدید] قبل از هر چیزی، از کاربر با یک دکمه اختصاصی تلگرام (request_contact) خواسته
//    می‌شود شماره‌اش را به اشتراک بگذارد. این کار خودکار و بدون تایپ انجام می‌شود.
//    بعد از دریافت شماره، دیگر در طول مکالمه اسم/شماره پرسیده نمی‌شود مگر کاربر خودش
//    بخواهد آن را عوض کند.
// ۸) [جدید] اتصال مینی‌اپ تلگرام: اگر MINI_APP_URL تنظیم شده باشد، دکمهٔ منوی چت
//    (کنار کادر نوشتن) به‌صورت خودکار روی مینی‌اپ تنظیم می‌شود و بعد از به اشتراک
//    گذاشتن شماره، یک دکمهٔ ورود به مینی‌اپ هم برای کاربر فرستاده می‌شود.

import "./env.js";
import TelegramBot from "node-telegram-bot-api";
import { handleUserMessage, startOver, getWelcomeMessage } from "./conversation.js";
import { getSession, resetSession } from "./sessions.js";
import { setNotifier } from "./notify.js";
import { chunkText } from "./text.js";
import { setMiniAppRegistration, resolveMiniAppUrl } from "./miniapp.js";

const TELEGRAM_MAX_LENGTH = 4096;
const ALLOW_GROUP_CHATS = String(process.env.ALLOW_GROUP_CHATS || "false").toLowerCase() === "true";
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID?.trim() || null;
const SOURCE_LABEL = "تلگرام";

// ── مینی‌اپ تلگرام ────────────────────────────────────────
// آدرس عمومی و HTTPS مینی‌اپ. اگر MINI_APP_URL ست نشده باشد، از دامنهٔ عمومی
// Railway (متغیر آمادهٔ RAILWAY_PUBLIC_DOMAIN) ساخته می‌شود؛ یعنی روی Railway
// بدون هیچ تنظیم اضافه‌ای دکمهٔ مینی‌اپ ساخته می‌شود.
const { url: MINI_APP_URL, source: MINI_APP_URL_SOURCE } = resolveMiniAppUrl();
const MINI_APP_TITLE = (process.env.MINI_APP_TITLE?.trim() || "پیش‌هوش").slice(0, 32);
const MINI_APP_MENU_BUTTON = String(process.env.MINI_APP_MENU_BUTTON ?? "true").toLowerCase() !== "false";

// دکمهٔ inline که مینی‌اپ را داخل خود تلگرام باز می‌کند
function miniAppMarkup() {
  if (!MINI_APP_URL) return undefined;
  return { inline_keyboard: [[{ text: `📱 تخمین قیمت در مینی‌اپ`, web_app: { url: MINI_APP_URL } }]] };
}

// دکمهٔ منو را برای «همین چت» هم ست می‌کند.
// چرا؟ setChatMenuButton بدون chat_id فقط «دکمهٔ پیش‌فرض» بات را عوض می‌کند و
// کلاینت بعضی کاربرها آن را دیر می‌گیرد (کش) یا نسخهٔ قدیمی‌تر تلگرام دارد.
// ست‌کردن دکمه برای همان chat_id باعث می‌شود دکمه برای آن کاربر قطعاً ظاهر شود.
const menuButtonChats = new Set();
async function ensureChatMenuButton(bot, chatId) {
  if (!MINI_APP_URL || !MINI_APP_MENU_BUTTON || !/^https:\/\//i.test(MINI_APP_URL)) return;
  if (menuButtonChats.has(chatId)) return;
  try {
    await bot.setChatMenuButton({
      chat_id: chatId,
      menu_button: JSON.stringify({ type: "web_app", text: MINI_APP_TITLE, web_app: { url: MINI_APP_URL } }),
    });
    if (menuButtonChats.size > 5000) menuButtonChats.clear();
    menuButtonChats.add(chatId);
  } catch (err) {
    // بی‌صدا نادیده می‌گیریم: دکمهٔ پیش‌فرض، دکمهٔ زیر پیام خوش‌آمد و دستور /app
    // همچنان راه‌های ورود به مینی‌اپ هستند.
    console.warn(`⚠️ دکمهٔ منوی مینی‌اپ برای چت ${chatId} ست نشد: ${err.message}`);
  }
}

// تنظیم دکمهٔ منوی بات (کنار کادر نوشتن در چت خصوصی) روی مینی‌اپ.
let retryAttempted = false;
// نکتهٔ فنی: کتابخانهٔ node-telegram-bot-api فقط reply_markup را خودش JSON می‌کند،
// پس آبجکت menu_button را باید دستی رشته کنیم وگرنه «[object Object]» فرستاده می‌شود.
// نتیجهٔ هر مسیر در setMiniAppRegistration ثبت می‌شود تا GET /api/miniapp-status
// بتواند دقیقاً بگوید چرا دکمهٔ مینی‌اپ در تلگرام دیده نمی‌شود.
async function registerMiniAppMenuButton(bot) {
  if (!MINI_APP_URL) {
    // بی‌صدا رد نشود: صفحهٔ /app روی سرور وب فعال است ولی هیچ راه ورودی در تلگرام ساخته نمی‌شود
    console.warn(
      "⚠️ MINI_APP_URL تنظیم نشده؛ دکمهٔ ورود به مینی‌اپ در تلگرام ساخته نمی‌شود.\n" +
        "   → آدرس عمومی سرویس را با /app بگذارید، مثلاً: MINI_APP_URL=https://your-app.up.railway.app/app"
    );
    setMiniAppRegistration({ attempted: false, ok: false, skipped: "MINI_APP_URL تنظیم نشده است" });
    return;
  }
  if (!MINI_APP_MENU_BUTTON) {
    console.log(`   📱 مینی‌اپ: ${MINI_APP_URL} (دکمهٔ منو با MINI_APP_MENU_BUTTON=false غیرفعال است)`);
    setMiniAppRegistration({ attempted: false, ok: false, skipped: "MINI_APP_MENU_BUTTON=false" });
    return;
  }
  if (!/^https:\/\//i.test(MINI_APP_URL)) {
    console.warn(`⚠️ MINI_APP_URL باید با https شروع شود (تلگرام آدرس «${MINI_APP_URL}» را قبول نمی‌کند).`);
    setMiniAppRegistration({ attempted: false, ok: false, skipped: "آدرس https نیست" });
    return;
  }
  try {
    await bot.setChatMenuButton({
      menu_button: JSON.stringify({ type: "web_app", text: MINI_APP_TITLE, web_app: { url: MINI_APP_URL } }),
    });
    console.log(`   📱 دکمهٔ منوی مینی‌اپ فعال شد: ${MINI_APP_URL}`);
    console.log(`      (منبع آدرس: ${MINI_APP_URL_SOURCE})`);
    setMiniAppRegistration({
      attempted: true,
      ok: true,
      error: null,
      skipped: null,
      botUsername: bot.options?.username ?? null,
    });
  } catch (err) {
    console.warn(`⚠️ تنظیم دکمهٔ منوی مینی‌اپ ناموفق بود: ${err.message}`);
    console.warn("   → آدرس باید HTTPS و از بیرون دسترس باشد؛ بات هم باید با همین توکن فعال باشد.");
    setMiniAppRegistration({
      attempted: true,
      ok: false,
      error: err.message,
      botUsername: bot.options?.username ?? null,
    });
    // خطای گذرا (شبکه/محدودیت نرخ) را یک‌بار دیگر بعد از ۲۰ ثانیه امتحان می‌کنیم؛
    // خطای اعتبارسنجی (400) فایده‌ای به تکرار ندارد.
    if (!retryAttempted && !/\b400\b|Bad Request/i.test(String(err.message))) {
      retryAttempted = true;
      setTimeout(() => registerMiniAppMenuButton(bot), 20_000).unref?.();
      console.warn("   → ۲۰ ثانیه دیگر یک‌بار دیگر تلاش می‌شود…");
    }
  }
}

const CONTACT_REQUEST_TEXT =
  "سلام 🌷 من پیش‌هوش هستم، دستیار هوشمند دفتر املاک دیار.\n\nبرای شروع، لطفاً با دکمه زیر شماره تماستون رو با من به اشتراک بذارید 👇";

const CONTACT_BUTTON_MARKUP = {
  keyboard: [[{ text: "📱 اشتراک‌گذاری شماره تماس", request_contact: true }]],
  resize_keyboard: true,
  one_time_keyboard: true,
};

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
    return bot.sendMessage(chatId, "متاسفانه پاسخی تولید نشد 🙏 لطفاً دوباره امتحان کنید.");
  }

  let replyMarkup;
  if (result.keyboard?.length) replyMarkup = keyboardMarkup(result.keyboard);
  // وقتی قرار است کیبورد حذف شود و مینی‌اپ فعال باشد، به‌جای remove_keyboard یک
  // دکمهٔ ورود به مینی‌اپ زیر پیام می‌گذاریم. این کار امن است چون تنها کیبورد
  // ماندگاری که بات می‌سازد «اشتراک شماره» با one_time_keyboard است و قبل از این
  // پیام با «ممنون 🙏 شماره‌تون ثبت شد» جمع شده است.
  // چرا؟ چون خیلی از کاربرها (از جمله خودتان) قبلاً شماره را به اشتراک گذاشته‌اند و
  // دیگر آن پیام خوش‌آمدِ اول را نمی‌بینند؛ پس دکمهٔ مینی‌اپ باید سر راهِ هر /start باشد.
  else if (result.removeKeyboard) replyMarkup = miniAppMarkup() ?? { remove_keyboard: true };

  const chunks = chunkText(text, TELEGRAM_MAX_LENGTH - 100);
  for (let i = 0; i < chunks.length; i++) {
    const isLast = i === chunks.length - 1;
    await bot.sendMessage(chatId, chunks[i], isLast && replyMarkup ? { reply_markup: replyMarkup } : {});
  }
}

// آیا این کاربر قبلاً شماره‌اش را به اشتراک گذاشته؟
function hasContact(session) {
  return Boolean(session.contact?.phone);
}

async function askForContact(bot, chatId) {
  await bot.sendMessage(chatId, CONTACT_REQUEST_TEXT, { reply_markup: CONTACT_BUTTON_MARKUP });
}

export function startTelegramBot() {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) {
    console.warn("⚠️ TELEGRAM_BOT_TOKEN تنظیم نشده؛ بات تلگرام غیرفعال است (فقط API وب بالا می‌آید).");
    return null;
  }

  const bot = new TelegramBot(token, { polling: { interval: 300, timeout: 20 } });
  let botId = null;

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
      const result = text ? await handleUserMessage(key, text, SOURCE_LABEL) : await startOver(key, getSession(key).contact);
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

  // دستور /start یا /restart: اگر شماره هنوز گرفته نشده، اول دکمه اشتراک شماره را نشان بده
  bot.onText(/^\/(start|restart)(@\w+)?(\s.*)?$/i, async (msg, match) => {
    if (!isUsableChat(msg)) return;
    const command = match[1].toLowerCase();
    const chatId = msg.chat.id;
    const key = `telegram:${chatId}`;

    // مطمئن شویم دکمهٔ منوی مینی‌اپ برای «همین کاربر» ست شده است (یک‌بار برای هر چت)
    if (msg.chat.type === "private") ensureChatMenuButton(bot, chatId);

    if (command === "restart") {
      resetSession(key);
      await askForContact(bot, chatId);
      return;
    }

    const session = getSession(key);
    if (!hasContact(session)) {
      await askForContact(bot, chatId);
      return;
    }
    return runCommand(msg, null);
  });

  // دستور /app: ورود مستقیم به مینی‌اپ.
  // چرا لازم است؟ چون دکمهٔ منو گاهی در کلاینت تلگرام دیر به‌روز می‌شود یا کاربر
  // پیدایش نمی‌کند؛ این یک راهِ قطعی و همیشه در دسترس برای باز کردن مینی‌اپ است.
  bot.onText(/^\/app(@\w+)?$/i, async (msg) => {
    if (!isUsableChat(msg)) return;
    const chatId = msg.chat.id;
    const markup = miniAppMarkup();
    try {
      if (!markup) {
        await bot.sendMessage(
          chatId,
          "مینی‌اپ برای این بات فعال نشده است.\n(در تنظیمات سرویس، MINI_APP_URL را روی آدرس عمومی و HTTPS بگذارید.)"
        );
        return;
      }
      await bot.sendMessage(chatId, "مینی‌اپ پیش‌هوش 👇 لیست پروژه‌ها و تخمین قیمت", {
        reply_markup: markup,
        disable_web_page_preview: true,
      });
    } catch (err) {
      console.error("❌ خطا در دستور /app:", err.message || err);
    }
  });

  // وقتی کاربر روی دکمه «اشتراک‌گذاری شماره تماس» می‌زند، تلگرام یک پیام با msg.contact می‌فرستد
  bot.on("contact", async (msg) => {
    if (!isUsableChat(msg)) return;
    const chatId = msg.chat.id;
    const key = `telegram:${chatId}`;
    const session = getSession(key);

    if (msg.chat.type === "private") ensureChatMenuButton(bot, chatId);
    const phoneDigits = String(msg.contact?.phone_number || "").replace(/[^\d+]/g, "");
    const name = [msg.contact?.first_name, msg.contact?.last_name].filter(Boolean).join(" ").trim();

    session.contact = { customerName: name || session.contact?.customerName || "", phone: phoneDigits };
    session.state = "choosing_project";

    try {
      await bot.sendMessage(chatId, "ممنون 🙏 شماره‌تون ثبت شد.", { reply_markup: { remove_keyboard: true } });
      // خودِ پیام خوش‌آمد (از طریق reply) دکمهٔ ورود به مینی‌اپ را زیرش می‌گیرد
      const welcome = await getWelcomeMessage();
      await reply(bot, chatId, welcome);
    } catch (err) {
      console.error("❌ خطا بعد از دریافت مخاطب:", err.message || err);
    }
  });

  bot.on("message", async (msg) => {
    if (!isUsableChat(msg)) return;
    if (msg.contact) return; // در هندلر «contact» پردازش شد
    if (/^\/(start|restart)(@\w+)?/i.test(msg.text || "")) return; // در هندلر بالا پردازش شد
    if (/^\/[a-z]/i.test(msg.text || "")) return; // بقیهٔ دستورات تلگرام را نادیده می‌گیریم

    const chatId = msg.chat.id;
    const key = `telegram:${chatId}`;
    const session = getSession(key);

    // اگر شماره هنوز گرفته نشده، هر پیامی که کاربر بفرستد را نادیده بگیر و دوباره دکمه را نشان بده
    if (!hasContact(session)) {
      await askForContact(bot, chatId);
      return;
    }

    if (!msg.text) {
      try {
        await bot.sendMessage(chatId, "لطفاً اطلاعات فایل رو به‌صورت متن بنویسید 🙏");
      } catch {
        /* ignore */
      }
      return;
    }

    await runCommand(msg, msg.text.trim());
  });

  bot.on("polling_error", (err) => {
    const message = err?.message || String(err);
    if (/409|conflict/i.test(message)) {
      console.error("❌ خطای 409 تلگرام: یک نمونهٔ دیگر از همین بات در حال اجراست. فقط یک instance فعال نگه دارید.");
      return;
    }
    console.error("خطای polling تلگرام:", message);
  });

  bot.on("error", (err) => console.error("❌ خطای عمومی بات تلگرام:", err?.message || err));

  bot.getMe()
    .then(async (me) => {
      bot.options.username = me.username;
      botId = me.id;
      console.log(`✅ بات تلگرام فعال شد: @${me.username}`);
      if (ADMIN_CHAT_ID) console.log(`   اطلاع‌رسانی به مدیر فعال است (chat id: ${ADMIN_CHAT_ID})`);
      setMiniAppRegistration({ botUsername: me.username });
      await registerMiniAppMenuButton(bot);
    })
    .catch((err) => {
      console.error("❌ اتصال به تلگرام ناموفق بود (توکن یا شبکه را چک کنید):", err.message);
    });

  return bot;
}
