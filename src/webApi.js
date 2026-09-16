// API وب: لندینگ‌پیج + مینی‌اپ تلگرام
//
// تغییرات کلیدی نسبت به نسخه قبل:
// ۱) rate limiting ساده (هر کاربر و هر IP) تا کسی نتواند سهمیهٔ Gemini را بسوزاند.
// ۲) CORS از روی متغیر محیطی CORS_ORIGIN تنظیم می‌شود (قبلاً کاملاً باز بود).
// ۳) اعتبارسنجی ورودی‌ها + سقف اندازهٔ بدنهٔ درخواست.
// ۴) لیست پروژه‌ها در /api/welcome برگردانده می‌شود تا ویجت بتواند دکمه بسازد.
// ۵) مسیر /api/reset و یک صفحهٔ دمو برای تست بدون لندینگ‌پیج.
// ۶) [جدید] مینی‌اپ تلگرام: صفحهٔ /app + چهار مسیر جدید
//    (/api/projects, /api/state, /api/select, /api/contact) و احراز هویت با initData.
//    هویت کاربر مینی‌اپ از شناسهٔ تلگرام ساخته می‌شود، پس با بستن و باز کردن مجدد
//    مینی‌اپ، مکالمهٔ نیمه‌تمام از بین نمی‌رود.

import "./env.js";
import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getWelcomeMessage,
  handleUserMessage,
  startOver,
  listProjects,
  selectProject,
  setContact,
} from "./conversation.js";
import { sessionStats, peekSession } from "./sessions.js";
import { MINI_APP_SOURCE_LABEL, verifyInitData, miniAppContact, initDataRejectionMessage, diagnoseMiniApp } from "./miniapp.js";
import { normalizePhone } from "./text.js";

const SOURCE_LABEL = "لندینگ‌پیج";
const MAX_TEXT_LENGTH = Number(process.env.MAX_MESSAGE_LENGTH) || 2000;
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX_PER_SESSION = Number(process.env.RATE_LIMIT_PER_MINUTE) || 12;
const RATE_MAX_PER_IP = Number(process.env.RATE_LIMIT_IP_PER_MINUTE) || 60;

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, "..", "public");

function createLimiter(windowMs, max) {
  const hits = new Map();
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [key, times] of hits.entries()) {
      const alive = times.filter((t) => now - t < windowMs);
      if (alive.length) hits.set(key, alive);
      else hits.delete(key);
    }
  }, windowMs);
  timer.unref?.();

  return (key) => {
    const now = Date.now();
    const times = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (times.length >= max) {
      hits.set(key, times);
      return false;
    }
    times.push(now);
    hits.set(key, times);
    return true;
  };
}

function buildCorsOptions() {
  const raw = (process.env.CORS_ORIGIN || "").trim();
  if (!raw || raw === "*") {
    console.warn("⚠️ CORS_ORIGIN تنظیم نشده؛ API برای همهٔ دامنه‌ها باز است. برای محیط عملیاتی دامنهٔ سایت را تنظیم کنید.");
    return { origin: true };
  }
  const allowed = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return {
    origin(origin, callback) {
      if (!origin || allowed.includes("*") || allowed.includes(origin)) return callback(null, true);
      return callback(new Error("Origin مجاز نیست"));
    },
  };
}

/**
 * تشخیص هویت درخواست:
 * - اگر initData تلگرام آمده باشد → مینی‌اپ؛ کلید نشست از شناسهٔ کاربر تلگرام ساخته می‌شود
 *   و نام کاربر (و شماره‌ای که قبلاً در چت بات به اشتراک گذاشته) روی نشست اعمال می‌گردد.
 * - در غیر این صورت sessionId لازم است → لندینگ‌پیج/ویجت (رفتار قبلی، بدون تغییر).
 */
function resolveIdentity(body) {
  const initData = typeof body?.initData === "string" ? body.initData.trim() : "";

  if (initData) {
    const verdict = verifyInitData(initData, { botToken: process.env.TELEGRAM_BOT_TOKEN?.trim() });
    if (!verdict.ok) {
      if (verdict.reason !== "expired") console.warn(`⚠️ initData رد شد: ${verdict.reason}`);
      return { error: { status: 403, message: initDataRejectionMessage(verdict.reason) } };
    }

    const contact = miniAppContact(verdict.user);
    // اگر کاربر قبلاً در چت بات شماره‌اش را به اشتراک گذاشته باشد، دوباره نمی‌پرسیم.
    // (در چت خصوصی، شناسهٔ چت همان شناسهٔ کاربر است.)
    const botContact = peekSession(`telegram:${verdict.user.id}`)?.contact;
    if (botContact?.phone && !contact.phone) contact.phone = botContact.phone;
    if (botContact?.customerName && !contact.customerName) contact.customerName = botContact.customerName;

    return {
      key: `miniapp:${verdict.user.id}`,
      source: MINI_APP_SOURCE_LABEL,
      contact: Object.keys(contact).length ? contact : null,
      miniApp: true,
    };
  }

  const sessionId = typeof body?.sessionId === "string" ? body.sessionId.trim() : "";
  if (!sessionId || sessionId.length > 128) {
    return { error: { status: 400, message: "sessionId معتبر نیست." } };
  }
  return { key: `web:${sessionId}`, source: SOURCE_LABEL, contact: null, miniApp: false };
}

export function createWebApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", true);

  app.use(cors(buildCorsOptions()));
  app.use(express.json({ limit: "16kb" }));

  const limitSession = createLimiter(RATE_WINDOW_MS, RATE_MAX_PER_SESSION);
  const limitIp = createLimiter(RATE_WINDOW_MS, RATE_MAX_PER_IP);

  app.use("/api", (req, res, next) => {
    const ip = req.ip || req.socket?.remoteAddress || "unknown";
    if (!limitIp(`ip:${ip}`)) {
      return res.status(429).json({ error: "تعداد درخواست‌ها زیاد است. لطفاً کمی صبر کنید." });
    }
    next();
  });

  app.get("/health", (req, res) => res.json({ status: "ok", sessions: sessionStats(), uptime: Math.round(process.uptime()) }));

  // ابزار تشخیص مینی‌اپ: با باز کردن این آدرس در مرورگر می‌شود فهمید چرا دکمهٔ
  // مینی‌اپ در تلگرام نمی‌آید (پیکربندی سرویس؟ توکن بات؟ سمت تلگرام؟ کش کلاینت؟)
  // پاسخ تلگرام ۳۰ ثانیه کش می‌شود تا کسی نتواند از آن برای حمله به api.telegram.org استفاده کند.
  app.get("/api/miniapp-status", async (req, res) => {
    try {
      const report = await diagnoseMiniApp();
      res.json({
        ok: report.ok,
        verdict: report.verdict,
        hints: report.hints,
        config: report.config,
        registration: report.registration,
        telegram: {
          bot: report.telegram?.me?.ok
            ? { username: report.telegram.me.result?.username, id: report.telegram.me.result?.id }
            : { error: report.telegram?.error ?? report.telegram?.me?.description ?? null },
          // نتیجهٔ باز شدهٔ getChatMenuButton (یا null اگر ست نشده/در دسترس نبود)
          menuButton: report.telegram?.menuButton ?? null,
        },
      });
    } catch (err) {
      console.error("❌ /api/miniapp-status:", err.message);
      res.status(500).json({ error: "بررسی وضعیت مینی‌اپ ناموفق بود." });
    }
  });

  // صفحهٔ دمو برای تست API بدون لندینگ‌پیج
  app.get("/demo", (req, res) => res.sendFile(path.join(publicDir, "demo.html")));

  // مینی‌اپ تلگرام - همین آدرس را در MINI_APP_URL و BotFather وارد می‌کنید
  // no-cache تا بعد از هر دیپلوی، کاربرها نسخهٔ جدید را بگیرند
  app.get(["/app", "/miniapp"], (req, res) =>
    res.sendFile(path.join(publicDir, "miniapp.html"), { headers: { "Cache-Control": "no-cache" } })
  );

  app.get("/api/welcome", async (req, res) => {
    try {
      const welcome = await getWelcomeMessage();
      res.json({ message: welcome.message, projects: welcome.projects ?? [] });
    } catch (err) {
      console.error("❌ /api/welcome:", err.message);
      res.status(503).json({ error: "خطا در دریافت اطلاعات پروژه‌ها. لطفاً بعداً دوباره امتحان کنید." });
    }
  });

  // لیست پروژه‌های فعال برای تب «پروژه‌ها» در مینی‌اپ (بدون نیاز به نشست)
  app.get("/api/projects", async (req, res) => {
    try {
      res.json({ projects: await listProjects() });
    } catch (err) {
      console.error("❌ /api/projects:", err.message);
      res.status(503).json({ error: "خواندن پروژه‌ها از سیستم ممکن نشد. لطفاً کمی دیگر دوباره امتحان کنید." });
    }
  });

  // وضعیت جاری کاربر مینی‌اپ: پروژهٔ نیمه‌تمام، اطلاعات تماس و لیست پروژه‌ها
  // (یک درخواست در لحظهٔ باز شدن مینی‌اپ؛ POST است تا initData در URL و لاگ‌ها نیفتد)
  app.post("/api/state", async (req, res) => {
    const identity = resolveIdentity(req.body ?? {});
    if (identity.error) return res.status(identity.error.status).json({ error: identity.error.message });

    try {
      const session = peekSession(identity.key);
      const contact = session?.contact ?? identity.contact ?? null;
      res.json({
        source: identity.source,
        miniApp: identity.miniApp,
        state: session?.state ?? "new",
        project: session?.project ? { name: session.project.name, fields: session.project.fields ?? [] } : null,
        contact: {
          customerName: contact?.customerName ?? "",
          hasPhone: Boolean(contact?.phone),
        },
        projects: await listProjects(),
      });
    } catch (err) {
      console.error("❌ /api/state:", err.message);
      res.status(503).json({ error: "خطا در دریافت وضعیت. لطفاً دوباره امتحان کنید." });
    }
  });

  // انتخاب پروژه از لیست (کلیک روی کارت پروژه در مینی‌اپ) → شروع مکالمهٔ تخمین قیمت
  app.post("/api/select", async (req, res) => {
    const identity = resolveIdentity(req.body ?? {});
    if (identity.error) return res.status(identity.error.status).json({ error: identity.error.message });

    const project = String(req.body?.project ?? "").trim();
    if (!project || project.length > 200) {
      return res.status(400).json({ error: "project معتبر نیست." });
    }
    if (!limitSession(`session:${identity.key}`)) {
      return res.status(429).json({ error: "کمی آهسته‌تر انتخاب کنید 🙏" });
    }

    try {
      const result = await selectProject(identity.key, project, identity.source, identity.contact);
      res.json({
        message: result?.message ?? "",
        project: result?.project ?? undefined,
        projects: result?.projects ?? undefined,
      });
    } catch (err) {
      console.error("❌ /api/select:", err.message);
      res.status(502).json({ error: "شروع تخمین قیمت ممکن نشد. لطفاً دوباره امتحان کنید." });
    }
  });

  // ذخیرهٔ نام و شمارهٔ تماس (فرم کوچک مینی‌اپ) - بدون مکالمه و بدون مصرف سهمیهٔ AI
  app.post("/api/contact", async (req, res) => {
    const identity = resolveIdentity(req.body ?? {});
    if (identity.error) return res.status(identity.error.status).json({ error: identity.error.message });

    const name = String(req.body?.customerName ?? req.body?.name ?? "").trim().slice(0, 80);
    const rawPhone = String(req.body?.phone ?? "").trim();
    const phone = normalizePhone(rawPhone);

    if (rawPhone && !phone) {
      return res.status(400).json({ error: "شمارهٔ تماس معتبر نیست. لطفاً شمارهٔ موبایل را کامل بنویسید (مثلاً 09121234567)." });
    }
    if (!phone && !name) {
      return res.status(400).json({ error: "نام یا شمارهٔ تماس لازم است." });
    }
    if (!limitSession(`session:${identity.key}`)) {
      return res.status(429).json({ error: "کمی آهسته‌تر 🙏" });
    }

    try {
      const saved = setContact(identity.key, { customerName: name, phone });
      if (!saved) return res.status(400).json({ error: "اطلاعات تماس پذیرفته نشد." });
      console.log(`📇 اطلاعات تماس ثبت شد | نام: ${saved.customerName || "(خالی)"} | شماره: ${saved.phone ? "دارد" : "(خالی)"} | منبع: ${identity.source}`);
      res.json({ ok: true, contact: { customerName: saved.customerName ?? "", hasPhone: Boolean(saved.phone) } });
    } catch (err) {
      console.error("❌ /api/contact:", err.message);
      res.status(500).json({ error: "ثبت اطلاعات تماس ممکن نشد." });
    }
  });

  // بدنه: { initData | sessionId, text } و در لندینگ‌پیج { sessionId, text }
  app.post("/api/message", async (req, res) => {
    const { text } = req.body ?? {};
    const identity = resolveIdentity(req.body ?? {});
    if (identity.error) return res.status(identity.error.status).json({ error: identity.error.message });

    if (typeof text !== "string" || !text.trim()) {
      return res.status(400).json({ error: "text الزامی است." });
    }
    if (text.length > MAX_TEXT_LENGTH) {
      return res.status(413).json({ error: `پیام نباید بلندتر از ${MAX_TEXT_LENGTH} کاراکتر باشد.` });
    }
    if (!limitSession(`session:${identity.key}`)) {
      return res.status(429).json({ error: "کمی آهسته‌تر پیام بدهید 🙏" });
    }

    try {
      const result = await handleUserMessage(identity.key, text.trim(), identity.source, identity.contact);
      res.json({
        message: result?.message ?? "",
        project: result?.project ?? undefined,
        projects: result?.projects ?? undefined,
      });
    } catch (err) {
      console.error("❌ /api/message:", err.message);
      res.status(502).json({ error: "متاسفانه خطایی پیش اومد. لطفاً دوباره امتحان کنید." });
    }
  });

  // شروع مجدد مکالمهٔ یک کاربر
  app.post("/api/reset", async (req, res) => {
    const identity = resolveIdentity(req.body ?? {});
    if (identity.error) return res.status(identity.error.status).json({ error: identity.error.message });

    try {
      const result = await startOver(identity.key, identity.contact ?? peekSession(identity.key)?.contact);
      res.json({ message: result.message, project: null, projects: result.projects ?? [] });
    } catch (err) {
      console.error("❌ /api/reset:", err.message);
      res.status(503).json({ error: "خطا در شروع مجدد." });
    }
  });

  app.use((req, res) => res.status(404).json({ error: "مسیر پیدا نشد." }));

  // هندلر خطای مرکزی (شامل خطای JSON نامعتبر و CORS)
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err?.type === "entity.parse.failed") return res.status(400).json({ error: "بدنهٔ درخواست JSON معتبر نیست." });
    if (err?.type === "entity.too.large") return res.status(413).json({ error: "بدنهٔ درخواست خیلی بزرگ است." });
    console.error("❌ خطای API:", err.message);
    res.status(500).json({ error: "خطای داخلی سرور." });
  });

  return app;
}
