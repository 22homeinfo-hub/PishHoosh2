// نقطه شروع برنامه: هم بات تلگرام را روشن می‌کند، هم سرور وب را

import "./env.js";

import { startTelegramBot } from "./telegram.js";
import { createWebApp } from "./webApi.js";
import { aiConfig } from "./ai.js";
import { getActiveProjects } from "./sheets.js";

// چک اولیه: متغیرهای محیطی ضروری
const REQUIRED = [
  "GEMINI_API_KEY",
  "GOOGLE_SHEET_ID",
  "GOOGLE_SERVICE_ACCOUNT_EMAIL",
  "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY",
];
const missing = REQUIRED.filter((key) => !process.env[key]);
if (missing.length) {
  console.error("❌ متغیرهای محیطی زیر تنظیم نشده‌اند:", missing.join(", "));
  console.error("   فایل .env.example را به .env کپی کنید و مقادیر واقعی را بگذارید.");
  console.error("   برای بررسی کامل‌تر می‌توانید `npm run doctor` را اجرا کنید.");
  process.exit(1);
}

const rawPrivateKey = String(process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || "");
if (!rawPrivateKey.includes("BEGIN PRIVATE KEY")) {
  console.warn(
    "⚠️ مقدار GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY شامل «BEGIN PRIVATE KEY» نیست؛ احتمالاً کلید درست کپی نشده و اتصال به شیت شکست می‌خورد."
  );
}

// شروع بات تلگرام
const bot = startTelegramBot();

// شروع سرور وب (برای لندینگ‌پیج)
const app = createWebApp();
const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || "0.0.0.0";

const server = app.listen(port, host, () => {
  console.log(`✅ سرور وب روی ${host}:${port} فعال شد`);
  console.log(`   مدل هوش مصنوعی: ${aiConfig.model} | سطح تفکر: ${aiConfig.thinkingLevel}`);
  console.log(`   صفحهٔ تست چت: http://localhost:${port}/demo`);
});

// پیش‌بارگذاری پروژه‌ها تا اولین پیام کاربر معطل خواندن شیت نماند
getActiveProjects()
  .then((projects) => {
    if (projects.length) console.log(`✅ ${projects.length} پروژهٔ فعال از گوگل‌شیت خوانده شد: ${projects.map((p) => p.name).join("، ")}`);
    else console.warn("⚠️ هیچ پروژهٔ فعالی در شیت پیدا نشد. تب Projects و ستون «فعال؟» را چک کنید.");
  })
  .catch((err) => console.error("❌ خواندن پروژه‌ها از گوگل‌شیت ناموفق بود:", err.message));

// خاموش شدن تمیز
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n🛑 دریافت ${signal}؛ در حال خاموش کردن…`);
  const timer = setTimeout(() => process.exit(1), 8000);
  timer.unref?.();

  server.close(async () => {
    try {
      if (bot?.stopPolling) await bot.stopPolling();
    } catch (err) {
      console.error("خطا در توقف polling:", err.message);
    }
    clearTimeout(timer);
    process.exit(0);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// یک ریجکشن رسیدگی‌نشده نباید کل سرویس را بیندازد
process.on("unhandledRejection", (reason) => {
  console.error("⚠️ unhandledRejection:", reason?.message || reason);
});
process.on("uncaughtException", (err) => {
  console.error("❌ uncaughtException:", err?.message || err);
});
