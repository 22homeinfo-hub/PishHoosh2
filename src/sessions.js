// مدیریت نشست (session) هر کاربر در حافظه
// هر کاربر (تلگرام یا وب) یک session دارد شامل:
// - پروژه انتخابی
// - شیء Chat فعال با Gemini
// - وضعیت مکالمه
// - شماره ردیف لید ثبت‌شده در شیت (برای اصلاح بعدی)
// - اطلاعات تماس (نام و شماره) که از قبل گرفته شده (مثلاً از دکمه اشتراک مخاطب تلگرام)
//
// تغییرات نسبت به نسخه قبل:
// ۱) زمان «آخرین فعالیت» نگه داشته می‌شود؛ قبلاً پاک‌سازی بر اساس زمان ساخت بود و
//    یک مکالمهٔ در جریان بعد از ۲ ساعت وسط کار حذف می‌شد.
// ۲) تایمر پاک‌سازی unref شده تا جلوی خروج طبیعی پروسه را نگیرد.
// ۳) یک قفل ساده برای هر کاربر هست تا پیام‌های پشت‌سرهم به‌صورت موازی پردازش نشوند
//    و ترتیب تاریخچهٔ مکالمه به هم نریزد.
// ۴) فیلد contact اضافه شد: اطلاعات تماسی که از قبل (مثلاً دکمه اشتراک مخاطب تلگرام یا
//    فرم لندینگ‌پیج) گرفته شده و دیگر نیازی نیست AI در پایان مکالمه آن را بپرسد.
//
// توجه: این داده‌ها فقط در حافظه‌اند؛ با restart شدن سرویس همه مکالمه‌های نیمه‌تمام پاک می‌شوند.
// اگر سرویس را بیش از یک instance مقیاس می‌دهید، باید از Redis یا دیتابیس استفاده کنید.

const sessions = new Map();
const locks = new Map();

const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MINUTES || 120) * 60 * 1000;
const CLEANUP_INTERVAL_MS = 30 * 60 * 1000;

function newSession() {
  const now = Date.now();
  return {
    state: "choosing_project", // choosing_project | chatting | followup
    project: null,
    chat: null,
    leadRowNumber: null,
    savedLead: null,
    contact: null, // { customerName, phone } - وقتی از قبل گرفته شده
    createdAt: now,
    lastActivityAt: now,
  };
}

export function getSession(key) {
  let session = sessions.get(key);
  if (!session) {
    session = newSession();
    sessions.set(key, session);
  }
  session.lastActivityAt = Date.now();
  return session;
}

export function resetSession(key) {
  sessions.delete(key);
}

// خواندن نشست «بدون» ساختن آن.
// چرا لازم است؟ getSession برای هر کلید ناشناخته یک نشست جدید می‌سازد و زمان
// آخرین فعالیتش را به‌روز می‌کند. وقتی مینی‌اپ می‌خواهد بداند کاربر قبلاً در چت بات
// شماره‌اش را به اشتراک گذاشته یا نه، نباید یک نشست خالی و بی‌استفاده برای او بسازیم.
export function peekSession(key) {
  return sessions.get(key);
}

// اجرای تابع به‌صورت سریالی برای هر کاربر (جلوگیری از پردازش موازی پیام‌ها)
export function withSessionLock(key, fn) {
  const previous = locks.get(key) ?? Promise.resolve();
  const run = previous.then(() => fn(), () => fn());
  const tail = run.then(
    () => {},
    () => {}
  );
  locks.set(key, tail);
  tail.then(() => {
    if (locks.get(key) === tail) locks.delete(key);
  });
  return run;
}

export function sessionStats() {
  const byState = {};
  for (const session of sessions.values()) byState[session.state] = (byState[session.state] ?? 0) + 1;
  return { total: sessions.size, byState };
}

const cleanupTimer = setInterval(() => {
  const cutoff = Date.now() - SESSION_TTL_MS;
  let removed = 0;
  for (const [key, session] of sessions.entries()) {
    if ((session.lastActivityAt ?? session.createdAt) < cutoff) {
      sessions.delete(key);
      removed++;
    }
  }
  if (removed) console.log(`🧹 ${removed} نشست قدیمی پاک شد. نشست‌های فعال: ${sessions.size}`);
}, CLEANUP_INTERVAL_MS);

// اجازه می‌دهد پروسه بدون منتظر ماندن برای این تایمر خارج شود
cleanupTimer.unref?.();
