// تطبیق ورودی کاربر با یکی از پروژه‌ها (منطق خالص، بدون دسترسی به شیت)
//
// چرا یک ماژول جدا؟ چون قبلاً کاربر مجبور بود اسم پروژه را «دقیقاً» تایپ کند:
// - اگر شمارهٔ لیست را می‌فرست («1») پروژه پیدا نمی‌شد، با اینکه لیست شماره‌دار نمایش داده بودیم
// - اگر «ی» عربی یا «ک» عربی یا نیم‌فاصله در تایپش بود، تطبیق شکست می‌خورد
// اینجا هر سه حالت پوشش داده شده و قابل تست است.
//
// [رفع باگ] وقتی ورودی کاربر ناقص است (مثلاً «نارنجستان» به‌جای «نارنجستان ۵») و
// با بیش از یک پروژه هم‌زمان تطبیق پیدا می‌کند (مثلاً «نارنجستان ۵» و «نارنجستان ۶»)،
// قبلاً find() فقط اولین مورد را بی‌صدا برمی‌گرداند و مشتری می‌توانست ناخواسته فایلش
// را برای پروژهٔ اشتباه ثبت کند. حالا در این حالت null برگردانده می‌شود و
// یک AmbiguousMatchError با لیست پروژه‌های محتمل پرتاب می‌شود تا لایهٔ بالاتر
// از کاربر بخواهد دقیق‌تر مشخص کند.

import { normalizeForMatch, parseChoice, similarityScore } from "./text.js";

// خطای اختصاصی برای وقتی ورودی با چند پروژه هم‌زمان تطبیق دارد
export class AmbiguousMatchError extends Error {
  constructor(candidates) {
    super(`ورودی با بیش از یک پروژه تطبیق دارد: ${candidates.map((p) => p.name).join("، ")}`);
    this.name = "AmbiguousMatchError";
    this.candidates = candidates;
  }
}

/**
 * پیدا کردن پروژه از روی متن کاربر.
 * @param {Array<{name:string}>} projects لیست پروژه‌های فعال
 * @param {string} input متن کاربر
 * @param {{allowChoice?:boolean}} [options]
 *   allowChoice=false یعنی «۱/۲/گزینه ۳» به عنوان انتخاب شماره‌ای تفسیر نشود؛
 *   برای سوییچ پروژه وسط مکالمه لازم است، چون جواب کاربر به سوال ربات («۵»)
 *   نباید اشتباهاً پروژهٔ پنجم را انتخاب کند.
 * @returns {object|null} پروژهٔ پیدا‌شده یا null
 * @throws {AmbiguousMatchError} وقتی ورودی با بیش از یک پروژه هم‌زمان تطبیق دارد
 */
export function matchProject(projects, input, options = {}) {
  const { allowChoice = true } = options;
  if (!Array.isArray(projects) || !projects.length) return null;
  const text = String(input ?? "").trim();
  if (!text) return null;

  if (allowChoice) {
    const index = parseChoice(text, projects.length);
    if (index !== null) return projects[index] ?? null;
  }

  const needle = normalizeForMatch(text);

  // تطبیق دقیق (تطبیق دقیق همیشه یکتاست، نیازی به چک ابهام نیست)
  let hit = projects.find((p) => normalizeForMatch(p.name) === needle);
  if (hit) return hit;

  // شامل بودن (دوطرفه) - اگر بیش از یک پروژه match شد، این ابهام را گزارش بده
  const containsMatches = projects.filter((p) => {
    const name = normalizeForMatch(p.name);
    return name && (name.includes(needle) || needle.includes(name));
  });
  if (containsMatches.length === 1) return containsMatches[0];
  if (containsMatches.length > 1) throw new AmbiguousMatchError(containsMatches);

  // تطبیق بدون توجه به فاصله‌ها («ساختمان‌نگین» در برابر «ساختمان نگین»)
  const compact = needle.replace(/\s+/g, "");
  if (compact) {
    const compactMatches = projects.filter((p) => normalizeForMatch(p.name).replace(/\s+/g, "") === compact);
    if (compactMatches.length === 1) return compactMatches[0];
    if (compactMatches.length > 1) throw new AmbiguousMatchError(compactMatches);
  }

  // شباهت کلمه‌ای (آستانهٔ ۰.۵ تا پروژهٔ اشتباه انتخاب نشود)
  // اگر چند پروژه امتیاز مشابه و بالایی داشتند (اختلاف کمتر از ۰.05)، این هم ابهام است.
  const scored = projects
    .map((project) => ({ project, score: similarityScore(text, project.name) }))
    .filter((s) => s.score >= 0.5)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) return null;
  if (scored.length > 1 && scored[0].score - scored[1].score < 0.05) {
    throw new AmbiguousMatchError(scored.map((s) => s.project));
  }
  return scored[0].project;
}
