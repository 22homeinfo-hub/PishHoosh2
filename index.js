// نقطه شروع برنامه: هم بات تلگرام رو روشن می‌کنه، هم سرور وب رو

import dotenv from "dotenv";
dotenv.config();

import { startTelegramBot } from "./telegram.js";
import { createWebApp } from "./webApi.js";

// چک اولیه: مطمئن شو متغیرهای محیطی ضروری تنظیم شدن
const required = [
  "GEMINI_API_KEY",
  "GOOGLE_SHEET_ID",
  "GOOGLE_SERVICE_ACCOUNT_EMAIL",
  "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY",
];
const missing = required.filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.error("❌ متغیرهای محیطی زیر تنظیم نشده‌اند:", missing.join(", "));
  console.error("فایل .env را بر اساس .env.example پر کنید.");
  process.exit(1);
}

// شروع بات تلگرام
startTelegramBot();

// شروع سرور وب (برای لندینگ‌پیج)
const app = createWebApp();
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`✅ سرور وب روی پورت ${port} فعال شد`);
});
