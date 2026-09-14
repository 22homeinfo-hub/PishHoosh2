// مدیریت نشست (session) هر کاربر در حافظه
// هر کاربر (چه تلگرام چه وب) یک session دارد که شامل:
// - پروژه انتخابی
// - مکالمه فعال با Gemini
// - وضعیت (در حال انتخاب پروژه / در حال گفتگو / پایان یافته)

const sessions = new Map();

// کلید یکتا برای هر کاربر: مثلا "telegram:12345" یا "web:uuid-xxx"
export function getSession(key) {
  if (!sessions.has(key)) {
    sessions.set(key, {
      state: "choosing_project", // choosing_project | chatting | done
      project: null,
      chatSession: null,
      createdAt: Date.now(),
    });
  }
  return sessions.get(key);
}

export function resetSession(key) {
  sessions.delete(key);
}

// پاکسازی خودکار نشست‌های قدیمی‌تر از ۲ ساعت (جلوگیری از نشتی حافظه)
setInterval(() => {
  const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
  for (const [key, session] of sessions.entries()) {
    if (session.createdAt < twoHoursAgo) {
      sessions.delete(key);
    }
  }
}, 30 * 60 * 1000);
