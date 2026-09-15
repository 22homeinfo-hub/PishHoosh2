// API وب برای لندینگ‌پیج (چت روی سایت)
//
// تغییرات کلیدی نسبت به نسخه قبل:
// ۱) rate limiting ساده (هر کاربر و هر IP) تا کسی نتواند سهمیهٔ Gemini را بسوزاند.
// ۲) CORS از روی متغیر محیطی CORS_ORIGIN تنظیم می‌شود (قبلاً کاملاً باز بود).
// ۳) اعتبارسنجی ورودی‌ها + سقف اندازهٔ بدنهٔ درخواست.
// ۴) لیست پروژه‌ها در /api/welcome برگردانده می‌شود تا ویجت بتواند دکمه بسازد.
// ۵) مسیر /api/reset و یک صفحهٔ دمو برای تست بدون لندینگ‌پیج.

import "./env.js";
import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getWelcomeMessage, handleUserMessage, startOver } from "./conversation.js";
import { sessionStats } from "./sessions.js";

const SOURCE_LABEL = "لندینگ‌پیج";
const MAX_TEXT_LENGTH = Number(process.env.MAX_MESSAGE_LENGTH) || 2000;
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX_PER_SESSION = Number(process.env.RATE_LIMIT_PER_MINUTE) || 12;
const RATE_MAX_PER_IP = Number(process.env.RATE_LIMIT_IP_PER_MINUTE) || 60;

const here = path.dirname(fileURLToPath(import.meta.url));

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

  // صفحهٔ دمو برای تست API بدون لندینگ‌پیج
  app.get("/demo", (req, res) => res.sendFile(path.join(here, "..", "public", "demo.html")));

  app.get("/api/welcome", async (req, res) => {
    try {
      const welcome = await getWelcomeMessage();
      res.json({
        message: welcome.message,
        projects: (welcome.projects ?? []).map((p) => ({ name: p.name, fields: p.fields.length })),
      });
    } catch (err) {
      console.error("❌ /api/welcome:", err.message);
      res.status(503).json({ error: "خطا در دریافت اطلاعات پروژه‌ها. لطفاً بعداً دوباره امتحان کنید." });
    }
  });

  // بدنه: { sessionId: "uuid", text: "متن پیام کاربر" }
  app.post("/api/message", async (req, res) => {
    const { sessionId, text } = req.body ?? {};

    if (!sessionId || typeof sessionId !== "string" || sessionId.length > 128) {
      return res.status(400).json({ error: "sessionId معتبر نیست." });
    }
    if (typeof text !== "string" || !text.trim()) {
      return res.status(400).json({ error: "text الزامی است." });
    }
    if (text.length > MAX_TEXT_LENGTH) {
      return res.status(413).json({ error: `پیام نباید بلندتر از ${MAX_TEXT_LENGTH} کاراکتر باشد.` });
    }
    if (!limitSession(`session:${sessionId}`)) {
      return res.status(429).json({ error: "کمی آهسته‌تر پیام بدهید 🙏" });
    }

    try {
      const result = await handleUserMessage(`web:${sessionId}`, text.trim(), SOURCE_LABEL);
      res.json({ message: result?.message ?? "", projects: result?.projects ?? undefined });
    } catch (err) {
      console.error("❌ /api/message:", err.message);
      res.status(502).json({ error: "متاسفانه خطایی پیش اومد. لطفاً دوباره امتحان کنید." });
    }
  });

  // شروع مجدد مکالمهٔ یک کاربر
  app.post("/api/reset", async (req, res) => {
    const { sessionId } = req.body ?? {};
    if (!sessionId) return res.status(400).json({ error: "sessionId الزامی است." });
    try {
      const result = await startOver(`web:${sessionId}`);
      res.json({ message: result.message, projects: result.projects ?? [] });
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
