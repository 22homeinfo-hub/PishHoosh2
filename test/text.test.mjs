import test from "node:test";
import assert from "node:assert/strict";
import {
  parseNumber,
  splitList,
  normalizeForMatch,
  normalizeHeader,
  chunkText,
  isRestartCommand,
  formatToman,
  normalizePhone,
} from "../src/text.js";

test("parseNumber: ارقام فارسی و جداکننده هزارگان", () => {
  assert.equal(parseNumber("120,000,000"), 120000000);
  assert.equal(parseNumber("۱۲۰٬۰۰۰٬۰۰۰"), 120000000);
  assert.equal(parseNumber("۱۲۰۰۰۰۰۰۰"), 120000000);
  assert.equal(parseNumber("120 میلیون"), 120000000);
  assert.equal(parseNumber(" ۲.۵ میلیارد "), 2500000000);
  assert.equal(parseNumber("85000000 تومان"), 85000000);
});

test("parseNumber: ورودی نامعتبر → null (نه NaN)", () => {
  assert.equal(parseNumber(""), null);
  assert.equal(parseNumber(null), null);
  assert.equal(parseNumber("نامشخص"), null);
  assert.equal(parseNumber("abc"), null);
  assert.equal(parseNumber(undefined), null);
  // هرگز NaN برنمی‌گرداند؛ یا عدد است یا null
  for (const sample of ["", "نامشخص", "120,000,000", "۲.۵ میلیارد"]) {
    const result = parseNumber(sample);
    assert.ok(result === null || Number.isFinite(result), `${sample} → ${result}`);
  }
});

test("splitList: کامای فارسی و انگلیسی و نقطه‌ویرگول", () => {
  assert.deepEqual(splitList("متراژ، طبقه، سال ساخت"), ["متراژ", "طبقه", "سال ساخت"]);
  assert.deepEqual(splitList("متراژ,طبقه,سال ساخت"), ["متراژ", "طبقه", "سال ساخت"]);
  assert.deepEqual(splitList("متراژ؛ طبقه\nسال ساخت"), ["متراژ", "طبقه", "سال ساخت"]);
  assert.deepEqual(splitList(""), []);
});

test("normalizeForMatch: یکسان‌سازی ی/ي، ک/ك، نیم‌فاصله و ارقام", () => {
  assert.equal(normalizeForMatch("پارسـيان ۱"), normalizeForMatch("پارسیان 1"));
  assert.equal(normalizeForMatch("كتـاب"), normalizeForMatch("کتاب"));
  assert.equal(normalizeForMatch("پیش‌هوش"), normalizeForMatch("پیش هوش"));
});

test("normalizeHeader: محتویات پرانتز و «؟» را نادیده می‌گیرد", () => {
  assert.equal(normalizeHeader("قیمت پایه هر متر (تومان)"), normalizeHeader("قیمت پایه هر متر"));
  assert.equal(normalizeHeader("فعال؟"), normalizeHeader("فعال"));
  assert.equal(normalizeHeader("فیلدهای موردنیاز (با کاما جدا کنید)"), normalizeHeader("فیلدهای موردنیاز"));
});

test("chunkText: متن بلند را زیر سقف تلگرام می‌شکند", () => {
  const long = Array.from({ length: 200 }, (_, i) => `خط شماره ${i + 1}`).join("\n");
  const chunks = chunkText(long, 300);
  assert.ok(chunks.length > 1);
  for (const chunk of chunks) assert.ok(chunk.length <= 300);
  assert.equal(chunks.join("").replace(/\s/g, ""), long.replace(/\s/g, ""));
  assert.deepEqual(chunkText("کوتاه"), ["کوتاه"]);
});

test("isRestartCommand: حالت‌های مختلف شروع مجدد", () => {
  for (const text of ["شروع مجدد", "شروع  مجدد", "شروع‌مجدد", "از اول", "/restart", "restart", "مکالمه جدید"]) {
    assert.equal(isRestartCommand(text), true, text);
  }
  for (const text of ["متراژ ۱۲۰", "سلام", ""]) assert.equal(isRestartCommand(text), false, text);
});

test("formatToman: نمایش خوانا با واحد", () => {
  assert.equal(formatToman(15960000000), "15,960,000,000 تومان");
  assert.equal(formatToman(""), "");
});

test("normalizePhone: قالب‌های مختلف شمارهٔ ایران به یک شکل تبدیل می‌شوند", () => {
  assert.equal(normalizePhone("۰۹۱۲ ۱۲۳ ۴۵۶۷"), "09121234567");
  assert.equal(normalizePhone("+989121234567"), "09121234567");
  assert.equal(normalizePhone("98 912 123 4567"), "09121234567");
  assert.equal(normalizePhone("9121234567"), "09121234567");
  assert.equal(normalizePhone("0912-123-4567"), "09121234567");
  // شمارهٔ غیرایرانی با «+» نگه داشته می‌شود
  assert.equal(normalizePhone("+1 (202) 555-0123"), "+12025550123");
});

test("normalizePhone: ورودی نامعتبر → رشتهٔ خالی", () => {
  for (const sample of ["", null, undefined, "abc", "۱۲۳", "شماره ندارم", "12345"]) {
    assert.equal(normalizePhone(sample), "", String(sample));
  }
});
