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
