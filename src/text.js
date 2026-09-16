// ابزارهای مشترک کار با متن فارسی
// چرا این فایل لازم است؟ چون بخش بزرگی از باگ‌های ربات از تفاوت‌های ظریف متن فارسی بود:
// «ی» عربی در برابر «ی» فارسی، «ک» در برابر «ک»، نیم‌فاصله، اعداد فارسی،
// و جداکننده هزارگان («،» یا «٬») که باعث می‌شد تطبیق نام پروژه و خواندن قیمت از شیت شکست بخورد.

const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";

const INVISIBLE = /[\u200B\u200E\u200F\u2028\u2029\uFEFF]/g; // فاصلهٔ صفر، علامت جهت و BOM
const ZWNJ = /[\u200C\u200D]/g; // نیم‌فاصله
const DIACRITICS = /[\u064B-\u0652\u0670\u0640]/g; // اعراب و کشیده
const PUNCT = /[\u060C\u061B\u061F.,!?;:"'`~@#$%^&*_+=<>|\\/-]/g;

// تبدیل اعداد فارسی/عربی به عدد لاتین
export function toLatinDigits(value) {
  let out = String(value ?? "");
  for (let i = 0; i < 10; i++) {
    out = out.split(FA_DIGITS[i]).join(String(i)).split(AR_DIGITS[i]).join(String(i));
  }
  return out;
}

// یکسان‌سازی حروف عربی/فارسی + حذف کاراکترهای نامرئی
export function normalizeFa(value) {
  return toLatinDigits(value)
    .replace(INVISIBLE, "")
    .replace(ZWNJ, " ")
    .replace(DIACRITICS, "")
    .replace(/[يى]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[ة]/g, "ه")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/\u066C/g, ",") // جداکننده هزارگان عربی
    .replace(/\u066B/g, "."); // جداکننده اعشار عربی
}

// فشرده‌سازی فاصله‌ها
export function collapseSpaces(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

// برای «مقایسه» متن کاربر با داده‌های شیت: بدون نقطه‌گذاری، بدون حساسیت به بزرگی حرف
export function normalizeForMatch(value) {
  return collapseSpaces(normalizeFa(value).replace(PUNCT, " ")).replace(/\s+/g, " ").trim().toLowerCase();
}

// برای «هدر» ستون‌های شیت: علاوه بر یکسان‌سازی، محتویات داخل پرانتز هم حذف می‌شود
// تا «قیمت پایه هر متر (تومان)» و «قیمت پایه هر متر» یکی در نظر گرفته شوند
export function normalizeHeader(value) {
  const withoutParens = normalizeFa(value)
    .replace(/\([^)]*\)/g, " ")
    .replace(/\[[^\]]*\]/g, " ");
  return normalizeForMatch(withoutParens);
}

// جدا کردن لیست فیلدها - هم کامای انگلیسی، هم «،» فارسی، هم «؛» و هم خط جدید
export function splitList(value) {
  return String(value ?? "")
    .split(/[,،;؛\n\r\t]+/)
    .map((item) => collapseSpaces(normalizeFa(item)))
    .filter(Boolean);
}

const UNITS = [
  { re: /میلیارد/g, mul: 1e9 },
  { re: /میلیون/g, mul: 1e6 },
  { re: /هزار/g, mul: 1e3 },
];

// تبدیل مقدار سلول شیت (یا متن کاربر) به عدد.
// «120,000,000» و «۱۲۰٬۰۰۰٬۰۰۰» و «120 میلیون» همه درست کار می‌کنند.
// در صورت شکست null برمی‌گرداند (نه NaN) تا باگ‌های خاموش ایجاد نشود.
export function parseNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;

  let text = collapseSpaces(normalizeFa(value));
  if (!text) return null;

  let multiplier = 1;
  for (const unit of UNITS) {
    if (unit.re.test(text)) {
      multiplier = unit.mul;
      text = text.replace(unit.re, " ");
      break;
    }
  }
  text = text.replace(/(تومان|ریال|﷼|TOMAN|IRT)/gi, " ");
  text = text.replace(/[,،٬\s_]/g, "");

  // فقط یک نقطه اعشار مجاز است
  const parts = text.split(".");
  text = parts.length > 1 ? `${parts[0]}.${parts.slice(1).join("")}` : parts[0];
  text = text.replace(/[^\d.-]/g, "");

  if (!text || text === "-") return null;
  const num = Number(text) * multiplier;
  return Number.isFinite(num) ? num : null;
}

// قالب‌بندی عدد برای نمایش به کاربر (با جداکننده هزارگان فارسی)
export function formatToman(value) {
  const num = parseNumber(value);
  if (num === null) return "";
  return `${Math.round(num).toLocaleString("en-US")} تومان`;
}

// تشخیص انتخاب با شماره از لیست: «1»، «۲»، «گزینه 3»، «پروژه ۲»، «شماره 4»
// مقدار بازگشتی: ایندکس صفر‌مبنا یا null
export function parseChoice(text, itemCount) {
  if (!itemCount) return null;
  const raw = collapseSpaces(toLatinDigits(text));
  const cleaned = raw.replace(/[.،,]/g, "").trim();

  let match = cleaned.match(/^(?:گزینه|شماره|پروژه|ردیف|مورد|number)?\s*(\d{1,3})$/);
  if (!match) match = raw.match(/(?:گزینه|شماره|پروژه|ردیف|مورد|number)\s*(\d{1,3})/);
  if (!match) return null;

  const index = Number(match[1]) - 1;
  return index >= 0 && index < itemCount ? index : null;
}

// امتیاز شباهت ساده برای تطبیق نام پروژه (بر اساس توکن‌های مشترک)
export function similarityScore(userText, candidate) {
  const a = new Set(normalizeForMatch(userText).split(" ").filter((w) => w.length > 1));
  const b = new Set(normalizeForMatch(candidate).split(" ").filter((w) => w.length > 1));
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared++;
  return shared / Math.max(a.size, b.size);
}

// شکستن متن بلند به قطعات کوچک‌تر (سقف تلگرام ۴۰۹۶ کاراکتر است)
export function chunkText(text, max = 3800) {
  const value = String(text ?? "");
  if (value.length <= max) return [value];
  const chunks = [];
  let rest = value;
  while (rest.length > max) {
    let cut = rest.lastIndexOf("\n", max);
    if (cut < max * 0.5) cut = rest.lastIndexOf(" ", max);
    if (cut < max * 0.5) cut = max;
    chunks.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) chunks.push(rest);
  return chunks.filter(Boolean);
}

// یکسان‌سازی شمارهٔ تماس (برای فرم مینی‌اپ و ثبت لید)
// «۰۹۱۲ ۱۲۳ ۴۵۶۷»، «+989121234567» و «9121234567» همه می‌شوند «09121234567».
// شماره‌های غیرایرانی با «+» ابتدایی نگه داشته می‌شوند.
// در صورت نامعتبر بودن، رشتهٔ خالی برمی‌گرداند (نه null و نه مقدار کثیف).
export function normalizePhone(value) {
  const text = collapseSpaces(toLatinDigits(value)).replace(/[^\d+]/g, "");
  if (!text) return "";

  const hasPlus = text.startsWith("+");
  let digits = text.replace(/\D/g, "");
  if (!digits) return "";

  // ۹۸۹۱۲۱۲۳۴۵۶۷ → ۰۹۱۲۱۲۳۴۵۶۷ (موبایل ایران با کد کشور)
  if (/^989\d{9}$/.test(digits)) digits = `0${digits.slice(2)}`;
  // ۹۱۲۱۲۳۴۵۶۷ → ۰۹۱۲۱۲۳۴۵۶۷ (موبایل ایران بدون صفر و بدون کد کشور)
  else if (/^9\d{9}$/.test(digits)) digits = `0${digits}`;

  if (digits.length < 7 || digits.length > 15) return "";
  if (digits.startsWith("0")) return digits;
  return hasPlus ? `+${digits}` : digits;
}

// تشخیص عبارت‌های «شروع مجدد» با حالت‌های مختلف
const RESTART_PATTERNS = ["شروع مجدد", "شروع دوباره", "از اول", "مکالمه جدید", "فایل جدید", "restart", "start over", "new"];
export function isRestartCommand(text) {
  const normalized = normalizeForMatch(text).replace(/^\//, "");
  if (!normalized) return false;
  if (normalized === "start" || normalized === "restart") return true;
  return RESTART_PATTERNS.some((p) => normalized === normalizeForMatch(p));
}
