// بارگذاری یک‌بارهٔ فایل .env
//
// چرا یک ماژول جدا؟ چون در ESM همهٔ importها «قبل از» اجرای دستورات ماژول ارزیابی می‌شوند؛
// یعنی الگوی «import dotenv; dotenv.config(); import ...» عملاً دیر اجرا می‌شد و
// ماژول‌هایی مثل ai.js مقدار مدل را قبل از بارگذاری .env می‌خواندند.
// حالا هر ماژولی که به متغیرهای محیطی نیاز دارد، این فایل را «اولین» import خودش قرار می‌دهد.

import dotenv from "dotenv";

dotenv.config();

// خواندن متغیر محیطی با مقدار پیش‌فرض (فاصله‌های اضافی هم پاک می‌شود)
export function env(name, fallback = undefined) {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  return typeof value === "string" ? value.trim() : value;
}

export function envNumber(name, fallback) {
  const value = Number(env(name, fallback));
  return Number.isFinite(value) ? value : fallback;
}
