// تطبیق ورودی کاربر با یکی از پروژه‌ها (منطق خالص، بدون دسترسی به شیت)
//
// چرا یک ماژول جدا؟ چون قبلاً کاربر مجبور بود اسم پروژه را «دقیقاً» تایپ کند:
// - اگر شمارهٔ لیست را می‌فرست («1») پروژه پیدا نمی‌شد، با اینکه لیست شماره‌دار نمایش داده بودیم
// - اگر «ی» عربی یا «ک» عربی یا نیم‌فاصله در تایپش بود، تطبیق شکست می‌خورد
// اینجا هر سه حالت پوشش داده شده و قابل تست است.

import { normalizeForMatch, parseChoice, similarityScore } from "./text.js";

/**
 * پیدا کردن پروژه از روی متن کاربر.
 * @param {Array<{name:string}>} projects لیست پروژه‌های فعال
 * @param {string} input متن کاربر
 * @returns {object|null} پروژهٔ پیدا‌شده یا null
 */
export function matchProject(projects, input) {
  if (!Array.isArray(projects) || !projects.length) return null;
  const text = String(input ?? "").trim();
  if (!text) return null;

  const index = parseChoice(text, projects.length);
  if (index !== null) return projects[index] ?? null;

  const needle = normalizeForMatch(text);

  // تطبیق دقیق
  let hit = projects.find((p) => normalizeForMatch(p.name) === needle);
  if (hit) return hit;

  // شامل بودن (دوطرفه)
  hit = projects.find((p) => {
    const name = normalizeForMatch(p.name);
    return name && (name.includes(needle) || needle.includes(name));
  });
  if (hit) return hit;

  // تطبیق بدون توجه به فاصله‌ها («ساختمان‌نگین» در برابر «ساختمان نگین»)
  const compact = needle.replace(/\s+/g, "");
  if (compact) {
    hit = projects.find((p) => normalizeForMatch(p.name).replace(/\s+/g, "") === compact);
    if (hit) return hit;
  }

  // شباهت کلمه‌ای (آستانهٔ ۰.۵ تا پروژهٔ اشتباه انتخاب نشود)
  let best = null;
  let bestScore = 0;
  for (const project of projects) {
    const score = similarityScore(text, project.name);
    if (score > bestScore) {
      bestScore = score;
      best = project;
    }
  }
  return bestScore >= 0.5 ? best : null;
}
