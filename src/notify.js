// اطلاع‌رسانی به مدیر (اختیاری)
// اگر ADMIN_CHAT_ID تنظیم شود، بات تلگرام یک notifier ثبت می‌کند تا
// رویدادهای مهم (مثل شکست ثبت لید در شیت) برای مدیر ارسال شود و اطلاعات مشتری گم نشود.

let notifier = null;

export function setNotifier(fn) {
  notifier = typeof fn === "function" ? fn : null;
}

export async function notifyAdmin(message) {
  if (!notifier) return false;
  try {
    await notifier(message);
    return true;
  } catch (err) {
    console.error("❌ ارسال اطلاعیه به مدیر ناموفق بود:", err.message);
    return false;
  }
}
