// ابزار تشخیص: npm run doctor
// تمام چیزهایی را که می‌تواند باعث خرابی بی‌صدا شود، یک‌جا چک می‌کند:
// متغیرهای محیطی، اتصال به Gemini (نام مدل و سهمیه)، اتصال به گوگل‌شیت،
// نگاشت هدر ستون‌ها، پروژه‌های فعال و آماده‌بودن تب Leads برای ثبت لید.

import "./env.js";

import { describeSheets, getActiveProjects } from "./sheets.js";
import { pingModel, aiConfig } from "./ai.js";
import { parseNumber, splitList, normalizeForMatch } from "./text.js";

const problems = [];
const warnings = [];

function ok(label, detail = "") {
  console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`);
}
function warn(label, detail = "") {
  warnings.push(`${label}${detail ? ` — ${detail}` : ""}`);
  console.log(`⚠️  ${label}${detail ? ` — ${detail}` : ""}`);
}
function fail(label, detail = "") {
  problems.push(`${label}${detail ? ` — ${detail}` : ""}`);
  console.log(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
}

async function checkEnv() {
  console.log("\n── ۱) متغیرهای محیطی ────────────────────────────────");
  const required = [
    ["GEMINI_API_KEY", "کلید Gemini"],
    ["GOOGLE_SHEET_ID", "شناسهٔ گوگل‌شیت"],
    ["GOOGLE_SERVICE_ACCOUNT_EMAIL", "ایمیل سرویس‌اکانت"],
    ["GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY", "کلید خصوصی سرویس‌اکانت"],
  ];
  for (const [key, label] of required) {
    const value = String(process.env[key] ?? "").trim();
    if (!value) fail(`${key} تنظیم نشده`, label);
    else ok(`${key}`, `${label} (${value.length} کاراکتر)`);
  }

  const key = String(process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY ?? "");
  if (key && !key.includes("BEGIN PRIVATE KEY")) {
    fail("کلید خصوصی معتبر نیست", "باید شامل «BEGIN PRIVATE KEY» باشد و «\\n»های آن حفظ شده باشد");
  } else if (key && key.includes("\\n")) {
    ok("کلید خصوصی", "\\nها به‌درستی نگهداری شده‌اند (خودکار به خط جدید تبدیل می‌شوند)");
  }

  if (!process.env.TELEGRAM_BOT_TOKEN?.trim()) warn("TELEGRAM_BOT_TOKEN تنظیم نشده", "فقط API وب فعال خواهد بود");
  if (!process.env.ADMIN_CHAT_ID?.trim()) warn("ADMIN_CHAT_ID تنظیم نشده", "هشدارهای خرابی ثبت لید برای مدیر ارسال نمی‌شود");
  if (!process.env.CORS_ORIGIN?.trim()) warn("CORS_ORIGIN تنظیم نشده", "API وب برای همهٔ دامنه‌ها باز است");
  ok(`مدل هوش مصنوعی: ${aiConfig.model}`, `سطح تفکر: ${aiConfig.thinkingLevel}`);
}

async function checkGemini() {
  console.log("\n── ۲) اتصال به Gemini ────────────────────────────────");
  if (!process.env.GEMINI_API_KEY?.trim()) {
    warn("بررسی Gemini رد شد", "چون کلید تنظیم نشده است");
    return;
  }
  try {
    const result = await pingModel();
    ok(`مدل «${result.model}» پاسخ داد`, `خروجی نمونه: ${result.text || "(خالی)"}`);
  } catch (err) {
    const message = err?.message ?? String(err);
    if (/404|not found|is not supported/i.test(message)) {
      fail(`نام مدل «${aiConfig.model}» معتبر نیست`, message.slice(0, 200));
      console.log("   → GEMINI_MODEL را روی «gemini-3.6-flash» یا «gemini-2.5-flash» بگذارید.");
    } else if (/429|RESOURCE_EXHAUSTED|quota/i.test(message)) {
      warn("سهمیهٔ Gemini تمام شده یا محدود است", message.slice(0, 200));
    } else if (/401|403|API_KEY_INVALID|PERMISSION_DENIED/i.test(message)) {
      fail("کلید Gemini نامعتبر است یا دسترسی ندارد", message.slice(0, 200));
    } else {
      fail("درخواست تست به Gemini ناموفق بود", message.slice(0, 200));
    }
  }
}

async function checkTelegram() {
  console.log("\n── ۳) توکن تلگرام ────────────────────────────────────");
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) {
    warn("TELEGRAM_BOT_TOKEN تنظیم نشده", "بات تلگرام بالا نمی‌آید (فقط API وب)");
    return;
  }
  if (!/^\d{5,}:.+/.test(token)) {
    fail("قالب توکن تلگرام درست نیست", "توکن باید چیزی شبیه «123456789:AA...» باشد");
    return;
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const data = await res.json();
    if (data?.ok) {
      ok(`توکن معتبر است`, `بات: @${data.result.username} (شناسهٔ ${data.result.id})`);
      // اگر بات قبلاً webhook داشته باشد، polling کار نمی‌کند
      const hook = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
      const hookData = await hook.json();
      const url = hookData?.result?.url;
      if (url) {
        fail("برای این بات webhook فعال است", `آدرس: ${url}`);
        console.log("   → چون ربات با polling کار می‌کند، باید webhook را حذف کنید:");
        console.log(`     curl "https://api.telegram.org/bot<TOKEN>/deleteWebhook"`);
        console.log("     (یا در مرورگر همان آدرس را باز کنید)");
      } else {
        ok("webhook فعال نیست", "polling بدون تداخل کار می‌کند");
      }
    } else {
      fail("تلگرام توکن را نپذیرفت", data?.description || `کد ${res.status}`);
      console.log("   → توکن را از BotFather دوباره بگیرید یا با /revoke قبلی را باطل نکنید.");
    }
  } catch (err) {
    fail("ارتباط با api.telegram.org برقرار نشد", err.message);
    console.log("   → اگر روی سرور داخلی هستید، دسترسی خروجی به api.telegram.org را باز کنید.");
  }

  const admin = process.env.ADMIN_CHAT_ID?.trim();
  if (admin && !/^-?\d{5,}$/.test(admin)) {
    warn("ADMIN_CHAT_ID عددی نیست", "باید شناسهٔ عددی چتلد باشد (از @userinfobot)");
  }
}

async function checkSheets() {
  console.log("\n── ۴) اتصال به گوگل‌شیت ──────────────────────────────");
  let report;
  try {
    report = await describeSheets();
  } catch (err) {
    fail("اتصال به گوگل‌شیت ناموفق بود", err.message);
    console.log("   → مطمئن شوید شیت با سرویس‌اکانت به‌عنوان Editor به اشتراک گذاشته شده باشد.");
    return;
  }

  ok("اتصال برقرار شد", `تب‌های موجود: ${report.tabs.join("، ")}`);

  for (const [title, info] of Object.entries({ Projects: report.projects, Leads: report.leads })) {
    console.log(`\n   ▸ تب «${title}»`);
    if (info.error) {
      fail(`تب ${info.tab} پیدا نشد`, info.error);
      continue;
    }
    ok(`هدرها شناسایی شد`, `${info.headers.join(" | ") || "(خالی)"}`);
    if (info.missing?.length) warn(`در ${info.tab} این ستون‌ها پیدا نشد`, info.missing.join("، "));
    if (info.missingRequired?.length) fail(`ستون‌های ضروری ${info.tab} موجود نیست`, info.missingRequired.join("، "));
    const mapped = Object.entries(info.resolved ?? {})
      .map(([key, header]) => `${key}→«${header}»`)
      .join("  ");
    if (mapped) console.log(`      نگاشت: ${mapped}`);
  }
}

async function checkProjects() {
  console.log("\n── ۵) پروژه‌های فعال ─────────────────────────────────");
  let projects;
  try {
    projects = await getActiveProjects({ force: true });
  } catch (err) {
    fail("خواندن پروژه‌ها ناموفق بود", err.message);
    return;
  }

  if (!projects.length) {
    fail("هیچ پروژهٔ فعالی پیدا نشد", "ربات به کاربر می‌گوید «پروژه فعالی تعریف نشده»");
    console.log("   → ستون «فعال؟» را با مقدار «بله» پر کنید.");
    return;
  }

  ok(`${projects.length} پروژهٔ فعال`);
  for (const project of projects) {
    const issues = [];
    if (!project.fields.length) issues.push("فیلدی تعریف نشده (ربات نمی‌تواند سوال بپرسد)");
    if (project.pricePerMeter === null) issues.push("قیمت پایه خوانده نشد (هوش مصنوعی بدون قیمت می‌ماند)");
    if (!project.notes) issues.push("توضیحات/فرمول قیمت‌گذاری خالی است");

    if (issues.length) fail(`پروژه «${project.name}»`, issues.join("؛ "));
    else ok(`پروژه «${project.name}»`, `${project.fields.length} فیلد | قیمت پایه: ${(project.pricePerMeter ?? 0).toLocaleString("en-US")}`);
  }

  // چک نمونه‌خواندن اعداد و لیست‌ها
  console.log("\n   ▸ تست ابزارهای پارس");
  const samples = [
    ["120,000,000", 120000000],
    ["۱۲۰٬۰۰۰٬۰۰۰", 120000000],
    ["120 میلیون", 120000000],
  ];
  for (const [input, expected] of samples) {
    const actual = parseNumber(input);
    if (actual === expected) ok(`parseNumber("${input}")`, String(actual));
    else fail(`parseNumber("${input}")`, `انتظار ${expected} بود، شد ${actual}`);
  }
  const fieldSample = "متراژ، طبقه، سال ساخت";
  const parsedFields = splitList(fieldSample);
  if (parsedFields.length === 3) ok("splitList با کامای فارسی", parsedFields.join(" / "));
  else fail("splitList با کامای فارسی", `${parsedFields.length} فیلد پیدا شد`);
  if (normalizeForMatch("پارسـيان ۱") === normalizeForMatch("پارسیان 1")) ok("یکسان‌سازی ی/ي و ارقام فارسی");
  else fail("یکسان‌سازی متن فارسی", "تطبیق نام پروژه ممکن است شکست بخورد");
}

function summary() {
  console.log("\n──────────────────────────────────────────────────────");
  if (!problems.length && !warnings.length) {
    console.log("🎉 همه‌چیز سالم است؛ می‌توانید `npm start` را اجرا کنید.");
  } else {
    if (problems.length) {
      console.log(`🚨 ${problems.length} مشکل باید رفع شود:`);
      problems.forEach((p, i) => console.log(`   ${i + 1}. ${p}`));
    }
    if (warnings.length) {
      console.log(`\n⚠️  ${warnings.length} هشدار:`);
      warnings.forEach((w, i) => console.log(`   ${i + 1}. ${w}`));
    }
  }
  console.log("──────────────────────────────────────────────────────\n");
  process.exit(problems.length ? 1 : 0);
}

async function main() {
  console.log("🩺 بررسی سلامت ربات پیش‌هوش");
  console.log(`   نسخهٔ نود: ${process.version}`);
  await checkEnv();
  await checkGemini();
  await checkTelegram();
  await checkSheets();
  await checkProjects();
  summary();
}

main().catch((err) => {
  console.error("❌ اجرای doctor ناموفق بود:", err.message);
  process.exit(1);
});
