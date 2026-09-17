// احراز هویت مینی‌اپ تلگرام (Telegram Mini App)
//
// وقتی کاربر مینی‌اپ را از داخل تلگرام باز می‌کند، تلگرام رشته‌ای به نام initData
// در اختیار صفحه قرار می‌دهد که شامل مشخصات کاربر و یک hash امضاشده است.
// طبق مستندات تلگرام این hash با HMAC-SHA256 و از روی توکن بات ساخته می‌شود:
//
//   secret_key = HMAC_SHA256(key = "WebAppData", msg = BOT_TOKEN)
//   check      = همهٔ فیلدهای initData (به‌جز hash) مرتب‌شده و با «\n» به هم چسبیده
//   hash       = HMAC_SHA256(key = secret_key, msg = check)
//
// با اعتبارسنجی همین رشته روی سرور، سه چیز به دست می‌آید:
//   ۱) درخواست واقعاً از طرف تلگرام آمده (نه از یک اسکریپت تصادفی)
//   ۲) کلید نشست از شناسهٔ کاربر تلگرام ساخته می‌شود؛ یعنی پایدار است و با هر بار
//      باز کردن مینی‌اپ، مکالمهٔ نیمه‌تمام کاربر از اول شروع نمی‌شود
//   ۳) نام کاربر برای ثبت لید، بدون پرسیدن از او، از پروفایل تلگرام پر می‌شود
//
// این ماژول «خالص» است: نه به شیت وصل می‌شود، نه به express؛ برای همین راحت تست می‌شود.

import "./env.js";
import crypto from "node:crypto";

// برچسب منبعی که در ستون «منبع» گوگل‌شیت ثبت می‌شود
export const MINI_APP_SOURCE_LABEL = "مینی‌اپ تلگرام";

const DEFAULT_MAX_AGE_SECONDS = Number(process.env.MINI_APP_INIT_DATA_MAX_AGE_SECONDS || 86400);
const HASH_RE = /^[0-9a-f]{64}$/i;

// حداکثر طول مجاز رشتهٔ initData (جلوگیری از بدنهٔ بیهودهٔ بزرگ)
export const MAX_INIT_DATA_LENGTH = 4096;

/**
 * اعتبارسنجی initData تلگرام.
 * @param {string} initData رشتهٔ خام initData (همان WebApp.initData)
 * @param {{botToken?:string, maxAgeSeconds?:number, now?:number}} [options]
 * @returns {{ok:true, user:object, startParam:string, authDate:number} | {ok:false, reason:string}}
 */
export function verifyInitData(initData, options = {}) {
  const { botToken, maxAgeSeconds = DEFAULT_MAX_AGE_SECONDS, now = Date.now() } = options;
  const raw = String(initData ?? "").trim();

  if (!raw) return { ok: false, reason: "empty" };
  if (raw.length > MAX_INIT_DATA_LENGTH) return { ok: false, reason: "too-long" };
  if (!botToken) return { ok: false, reason: "no-bot-token" };

  let params;
  try {
    params = new URLSearchParams(raw);
  } catch {
    return { ok: false, reason: "malformed" };
  }

  const hash = String(params.get("hash") ?? "").toLowerCase();
  if (!HASH_RE.test(hash)) return { ok: false, reason: "no-hash" };

  // رشتهٔ کنترلی: همهٔ فیلدها به‌جز hash، مرتب‌شده بر اساس نام کلید
  const dataCheckString = [...params.entries()]
    .filter(([key]) => key !== "hash")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const computed = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  // مقایسهٔ زمان‌ثابت تا از حملهٔ timing جلوگیری شود
  const computedBuf = Buffer.from(computed, "hex");
  const givenBuf = Buffer.from(hash, "hex");
  if (givenBuf.length !== computedBuf.length || !crypto.timingSafeEqual(computedBuf, givenBuf)) {
    return { ok: false, reason: "bad-hash" };
  }

  const authDate = Number(params.get("auth_date"));
  if (!Number.isFinite(authDate) || authDate <= 0) return { ok: false, reason: "no-auth-date" };

  const ageSeconds = Math.floor(now / 1000) - authDate;
  if (ageSeconds > maxAgeSeconds) return { ok: false, reason: "expired" };
  // کمی خطای ساعت مجاز است، اما auth_date در آینده یعنی داده دست‌کاری شده
  if (ageSeconds < -120) return { ok: false, reason: "future-auth-date" };

  let user = null;
  try {
    user = JSON.parse(params.get("user") ?? "null");
  } catch {
    user = null;
  }
  if (!user || typeof user !== "object" || !user.id) return { ok: false, reason: "no-user" };

  return { ok: true, user, startParam: params.get("start_param") ?? "", authDate };
}

/**
 * نام نمایشی کاربر تلگرام برای ثبت در ستون «نام مشتری».
 * شمارهٔ تماس در initData تلگرام وجود ندارد؛ آن را یا خود کاربر در مینی‌اپ می‌نویسد
 * یا (اگر قبلاً در چت بات به اشتراک گذاشته باشد) از نشست بات برمی‌داریم.
 */
export function miniAppContact(user) {
  const name = [user?.first_name, user?.last_name]
    .map((part) => String(part ?? "").trim())
    .filter(Boolean)
    .join(" ")
    .slice(0, 80);
  return name ? { customerName: name } : {};
}

// پیام کاربری مناسب برای هر دلیل رد شدن initData
export function initDataRejectionMessage(reason) {
  if (reason === "expired") return "نشست مینی‌اپ منقضی شده؛ لطفاً یک‌بار مینی‌اپ را ببندید و دوباره باز کنید.";
  if (reason === "no-bot-token") return "مینی‌اپ روی سرور پیکربندی نشده (TELEGRAM_BOT_TOKEN).";
  return "نشست تلگرام معتبر نیست؛ لطفاً مینی‌اپ را از داخل تلگرام باز کنید.";
}

// ────────────────────────────────────────────────────────
// ابزار تشخیص: «چرا دکمهٔ مینی‌اپ در تلگرام نمی‌آید؟»
//
// این بخش فقط برای این است که بشود با باز کردن یک آدرس در مرورگر
// (GET /api/miniapp-status) فهمید مشکل از پیکربندی سرویس است یا از سمت تلگرام،
// بدون اینکه لازم باشد کسی لاگ‌ها را بگردد.
// ────────────────────────────────────────────────────────

// نتیجهٔ آخرین تلاش بات برای ثبت دکمهٔ منو (توسط telegram.js پر می‌شود)
const registration = { attempted: false, ok: false, skipped: null, error: null, botUsername: null, at: null };

/**
 * ساختن آدرس مینی‌اپ.
 *
 * چرا این تابع؟ چون شایع‌ترین دلیل «دکمهٔ مینی‌اپ در تلگرام نمی‌آید» این است که
 * MINI_APP_URL اصلاً در سرویس ست نشده. روی Railway نیازی به ست‌کردنش نیست:
 * دامنهٔ عمومی سرویس در متغیر آمادهٔ RAILWAY_PUBLIC_DOMAIN هست و از همان
 * «https://<domain>/app» ساخته می‌شود. یعنی دیپلوی روی Railway بدون هیچ تنظیم
 * اضافه‌ای دکمهٔ مینی‌اپ را می‌سازد.
 *
 * @returns {{url:string, source:"MINI_APP_URL"|"RAILWAY_PUBLIC_DOMAIN"|"PUBLIC_URL"|null}}
 */
export function resolveMiniAppUrl(env = process.env) {
  const clean = (value) =>
    String(value ?? "")
      .trim()
      .replace(/\/+$/, "");

  // آدرس بدون طرح («your-app.up.railway.app/app») را تلگرام در دکمهٔ web_app رد
  // می‌کند و کل پیام با 400 می‌افتد؛ پس طرح جاافتاده را خودمان کامل می‌کنیم.
  const withHttps = (value) => (/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`);

  const explicit = clean(env.MINI_APP_URL);
  if (explicit) return { url: withHttps(explicit), source: "MINI_APP_URL" };

  const railwayDomain = clean(env.RAILWAY_PUBLIC_DOMAIN).replace(/^https?:\/\//i, "");
  if (railwayDomain) return { url: `https://${railwayDomain}/app`, source: "RAILWAY_PUBLIC_DOMAIN" };

  // برخی پلتفرم‌ها (یا ریورس‌پراکسی دستی) دامنهٔ عمومی را در این متغیرها می‌دهند
  const publicUrl = clean(env.PUBLIC_URL || env.APP_URL || env.RENDER_EXTERNAL_URL);
  if (publicUrl) return { url: `${withHttps(publicUrl).replace(/^http:\/\//i, "https://")}/app`, source: "PUBLIC_URL" };

  return { url: "", source: null };
}

export function setMiniAppRegistration(info) {
  Object.assign(registration, info ?? {}, { at: new Date().toISOString() });
}

export function getMiniAppRegistration() {
  return { ...registration };
}

// پیکربندی جاری مینی‌اپ از روی متغیرهای محیطی
export function miniAppConfig() {
  const { url, source } = resolveMiniAppUrl();
  return {
    url,
    source,
    isHttps: /^https:\/\//i.test(url),
    botTokenSet: Boolean(String(process.env.TELEGRAM_BOT_TOKEN ?? "").trim()),
  };
}

const TELEGRAM_CACHE_MS = 30_000;
let telegramCache = { token: null, at: 0, me: null, menuButton: null };

// پرس‌وجوی زنده از خود تلگرام: معتبر بودن توکن (getMe) و وضعیت فعلی دکمهٔ منو
export async function fetchTelegramStatus(botToken) {
  const token = String(botToken ?? "").trim();
  if (!token) return { error: "TELEGRAM_BOT_TOKEN تنظیم نشده است." };
  if (telegramCache.token === token && Date.now() - telegramCache.at < TELEGRAM_CACHE_MS) {
    return { me: telegramCache.me, menuButton: telegramCache.menuButton };
  }

  const call = async (method) => {
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        signal: AbortSignal.timeout(8000),
      });
      return await res.json();
    } catch (err) {
      return { ok: false, description: err?.message ?? String(err) };
    }
  };

  const [me, menuButton] = await Promise.all([call("getMe"), call("getChatMenuButton")]);
  telegramCache = { token, at: Date.now(), me, menuButton };
  return { me, menuButton };
}

/**
 * تشخیص کامل وضعیت مینی‌اپ.
 * @returns {Promise<{ok:boolean, verdict:string, config:object, registration:object, telegram:object, hints:string[]}>}
 */
export async function diagnoseMiniApp() {
  const config = miniAppConfig();
  const reg = getMiniAppRegistration();
  const hints = [];
  let telegram = { me: null, menuButton: null, error: null };

  if (config.botTokenSet) telegram = await fetchTelegramStatus(process.env.TELEGRAM_BOT_TOKEN);

  const menuButton = telegram?.menuButton?.ok ? telegram.menuButton.result : null;
  const configuredUrl = menuButton?.web_app?.url ?? null;

  // شکلِ گزارش در همهٔ مسیرها یکی است: menuButton همیشه «نتیجهٔ باز شده» است
  // (نه پاکت {ok,result} تلگرام) تا لایهٔ وب مجبور نباشد دو حالت را حدس بزند.
  const snapshot = () => ({
    me: telegram?.me ?? null,
    menuButton,
    error: telegram?.error ?? null,
  });

  // ۱) اصلاً پیکربندی نشده
  if (!config.url) {
    return {
      ok: false,
      verdict: "آدرس مینی‌اپ ساخته نشد: نه MINI_APP_URL ست شده و نه دامنهٔ عمومی سرویس پیدا شد.",
      config,
      registration: reg,
      telegram: snapshot(),
      hints: [
        "روی Railway لازم نیست چیزی بگذارید؛ متغیر آمادهٔ RAILWAY_PUBLIC_DOMAIN خودش استفاده می‌شود. اگر این خطا را می‌بینید یعنی Public Networking برای سرویس روشن نیست.",
        "در Railway → سرویس → Settings → Networking یک دامنهٔ عمومی (Generate Domain) بسازید و ری‌دیپلوی کنید.",
        "یا دستی: MINI_APP_URL=https://<دامنهٔ-شما>/app را در Variables بگذارید.",
        "تا آن موقع صفحهٔ /app در مرورگر کار می‌کند و دستور /app هم به بات اضافه شده است.",
      ],
    };
  }

  // ۲) آدرس https نیست
  if (!config.isHttps) {
    return {
      ok: false,
      verdict: `آدرس «${config.url}» با https شروع نمی‌شود و تلگرام آن را رد می‌کند.`,
      config,
      registration: reg,
      telegram: snapshot(),
      hints: ["مقدار MINI_APP_URL باید آدرس عمومی و HTTPS سرویس باشد (Public Networking در Railway روشن باشد)."],
    };
  }

  // ۳) توکن بات مشکل دارد یا سرور به تلگرام نمی‌رسد
  if (telegram?.error || (telegram?.me && telegram.me.ok === false)) {
    const detail = String(telegram?.error || telegram?.me?.description || "نامشخص");
    // «fetch failed» یعنی خودِ سرور نتوانسته به api.telegram.org وصل شود (شبکه/DNS)،
    // که با «Unauthorized» (توکن غلط) کاملاً متفاوت است و راه‌حل دیگری دارد.
    const networkProblem = /fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|timeout|socket/i.test(detail);
    return {
      ok: false,
      verdict: networkProblem
        ? `سرور به api.telegram.org نرسید (${detail})؛ پس وضعیت دکمهٔ منو قابل بررسی نیست.`
        : `تلگرام بات را نپذیرفت: ${detail}`,
      config,
      registration: reg,
      telegram: snapshot(),
      hints: networkProblem
        ? [
            "دسترسی خروجی سرویس به api.telegram.org را چک کنید (فایروال/DNS).",
            "اگر خودِ بات هم پیام‌ها را جواب نمی‌دهد، مشکل از توکن نیست بلکه از شبکهٔ سرویس است.",
          ]
        : [
            "TELEGRAM_BOT_TOKEN را با مقداری که از BotFather گرفته‌اید مقایسه کنید (بدون فاصلهٔ اضافی).",
            "اگر توکن را با /revoke باطل کرده‌اید، توکن جدید بگذارید.",
          ],
    };
  }

  // ۴) دکمهٔ منو درست ست شده
  if (menuButton?.type === "web_app" && configuredUrl === config.url) {
    return {
      ok: true,
      verdict: "سمت تلگرام درست است: دکمهٔ منوی بات روی مینی‌اپ تنظیم شده.",
      config,
      registration: reg,
      telegram: snapshot(),
      hints: [
        "اگر دکمه را نمی‌بینید: تلگرام را کامل ببندید و باز کنید (کلاینت دکمهٔ منو را کش می‌کند).",
        "دکمهٔ منو فقط در «چت خصوصی» با بات است، نه در گروه.",
        "جایش کنار کادر نوشتن پیام است (همان آیکنی که به‌جای گیرهٔ پیوست، منوی بات را باز می‌کند).",
        `بات: @${telegram?.me?.result?.username ?? "?"} — اگر مینی‌اپ را با بات دیگری باز کنید، امضای initData رد می‌شود.`,
      ],
    };
  }

  // ۵) دکمه روی آدرس دیگری ست شده (مثلاً دستی در BotFather)
  if (menuButton?.type === "web_app" && configuredUrl !== config.url) {
    return {
      ok: false,
      verdict: `دکمهٔ منو در تلگرام روی آدرس دیگری ست شده است: ${configuredUrl}`,
      config,
      registration: reg,
      telegram: snapshot(),
      hints: [
        "دکمهٔ منو دستی در BotFather مدیریت می‌شود و سرویس آن را عوض نمی‌کند؛ اگر آدرس سرویس تغییر کرده، دکمه را در BotFather روی آدرس جدید بگذارید.",
        "یا مقدار MINI_APP_URL را با همان آدرسی که در BotFather گذاشته‌اید یکی کنید تا گزارش‌ها درست باشند.",
      ],
    };
  }

  // ۶) دکمه اصلاً ست نشده
  // ورودی مینی‌اپ در تلگرام دستی در BotFather ساخته می‌شود؛ سرویس فقط وضعیت را
  // گزارش می‌کند. پس راهنما مستقیم همان مسیر دستی است.
  hints.push(
    "دکمهٔ منوی مینی‌اپ ست نشده است. سرویس عمداً دکمه‌ای ست نمی‌کند؛ آن را دستی بسازید: BotFather → /mybots → بات → Bot Settings → Menu Button → Configure Menu Button."
  );
  hints.push("نوع دکمه را Web App و آدرس را همان «url» بالا بگذارید (HTTPS و از اینترنت دسترس).");
  hints.push("تا قبل از آن، دستور /app آدرس مینی‌اپ را داخل چت می‌فرستد و صفحهٔ /app در مرورگر کار می‌کند.");

  return {
    ok: false,
    verdict: `دکمهٔ منو در تلگرام ست نشده است (نوع فعلی: ${menuButton?.type ?? "نامشخص"}).`,
    config,
    registration: reg,
    telegram: snapshot(),
    hints,
  };
}
