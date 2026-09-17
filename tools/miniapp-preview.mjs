// پیش‌نمایش محلی مینی‌اپ تلگرام - بدون کلید Gemini و بدون گوگل‌شیت
//
// اجرا:  npm run miniapp:preview     →  http://localhost:4100/app
//
// چه چیزی واقعی است و چه چیزی نه:
//   ✅ واقعی: همهٔ کد سمت سرور (webApi, conversation, projects, text, sessions)
//             و کل رابط کاربری مینی‌اپ (public/miniapp.html)
//   🔁 جایگزین: گوگل‌شیت (tools/preview-sheets.mjs) و Gemini (شبیه‌ساز سادهٔ
//             قیمت‌گذاری در همین فایل) تا بدون هزینه و بدون کلید، جریان کامل
//             «انتخاب پروژه → گرفتن اطلاعات → اعلام تخمین → ثبت لید» دیده شود.
//
// بیرون از تلگرام، مینی‌اپ به‌جای initData از یک sessionId محلی استفاده می‌کند،
// پس همین صفحه در مرورگر معمولی هم کار می‌کند.

const PORT = Number(process.env.PORT) || 4100;
const HOST = process.env.HOST || "0.0.0.0";

// متغیرهای محیطی لازم برای بالا آمدن ماژول‌ها (مقادیر نمایشی)
process.env.GEMINI_API_KEY ||= "preview-key";
process.env.CORS_ORIGIN ||= "*";
process.env.SESSION_TTL_MINUTES ||= "120";
// در این ابزار بات تلگرام اجرا نمی‌شود؛ این توکن نمایشی فقط برای این است که مسیر
// «مینی‌اپ داخل تلگرام» (راستی‌آزمایی امضای initData) هم قابل تست باشد.
process.env.TELEGRAM_BOT_TOKEN ||= "123456789:PREVIEW";

// ── شبیه‌ساز Gemini ──────────────────────────────────────
// اطلاعات پروژه (نام، قیمت پایه و فیلدها) از systemInstruction واقعیِ ساخته‌شده
// توسط src/ai.js بیرون کشیده می‌شود؛ پس اگر prompt عوض شود، شبیه‌ساز هم همان را می‌بیند.
const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

function toLatinDigits(value) {
  let out = String(value ?? "");
  for (let i = 0; i < 10; i++) out = out.split(FA_DIGITS[i]).join(String(i));
  return out;
}

function parseProjectInfo(body) {
  const instruction = JSON.stringify(body?.system_instruction ?? body?.systemInstruction ?? "");
  // نام پروژه را از متن «دست‌نخورده» می‌گیریم تا ارقام فارسی‌اش عوض نشود
  const name = /پروژه «([^»]+)»/.exec(instruction)?.[1] ?? "پروژه";
  const text = toLatinDigits(instruction);
  const priceRaw = /قیمت پایه هر متر:\s*([\d,]+)/.exec(text)?.[1];
  const pricePerMeter = priceRaw ? Number(priceRaw.replace(/,/g, "")) : null;
  const fields = [...text.matchAll(/\\n\d+\.\s*([^\\"]+)\\n/g)].map((m) => m[1].trim()).filter(Boolean);
  return { name, pricePerMeter, fields };
}

function parseFileInfo(userTexts) {
  const text = toLatinDigits(userTexts.join(" ، "));
  const numbers = [...text.matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
  const area = numbers.find((n) => n >= 20 && n <= 3000) ?? null;
  const floorMatch = /طبقه\s*(\d{1,3})/.exec(text);
  const floor = floorMatch ? Number(floorMatch[1]) : null;
  const yearMatch = /(سال ساخت|ساخت)\s*(\d{2,4})/.exec(text);
  const year = yearMatch ? Number(yearMatch[2]) : null;
  const roomsMatch = /(\d{1,2})\s*(اتاق|خواب)/.exec(text);
  const rooms = roomsMatch ? Number(roomsMatch[1]) : null;

  const parts = [];
  if (area) parts.push(`${area} متر`);
  if (floor !== null) parts.push(`طبقه ${floor}`);
  if (rooms !== null) parts.push(`${rooms} اتاق`);
  if (year !== null) parts.push(`ساخت ${year < 100 ? 1300 + year : year}`);

  return { area, floor, year, rooms, fileInfo: parts.join("، "), complete: Boolean(area) };
}

function simulateModel(body) {
  const { name, pricePerMeter, fields } = parseProjectInfo(body);
  const userTexts = (body?.contents ?? [])
    .filter((c) => c.role === "user")
    .flatMap((c) => (c.parts ?? []).map((p) => p?.text ?? ""));

  const info = parseFileInfo(userTexts.slice(1)); // پیام اولِ کاشته‌شده فقط «سلام» است
  const respond = (payload) =>
    new Response(
      JSON.stringify({
        candidates: [{ content: { role: "model", parts: [{ text: JSON.stringify(payload) }] }, finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 300, candidatesTokenCount: 80, totalTokenCount: 380 },
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );

  if (!info.complete) {
    const wanted = fields.length ? fields.join("، ") : "مشخصات فایل";
    return respond({ reply: `برای تخمین قیمت «${name}» لطفاً ${wanted} را با هم بنویسید.`, done: false, lead: null });
  }

  if (!pricePerMeter) {
    return respond({
      reply: "اطلاعات فایلتان را گرفتم. قیمت پایهٔ این پروژه در سیستم ثبت نشده؛ کارشناس دفتر دیار به‌زودی قیمت را اعلام می‌کند.",
      done: false,
      lead: null,
    });
  }

  const bonus = info.floor !== null && info.floor > 3 ? 1.05 : 1;
  const price = Math.round((info.area * pricePerMeter * bonus) / 1_000_000) * 1_000_000;
  return respond({
    reply: `ممنون 🙏 اطلاعات فایلتان برای «${name}» ثبت شد.\n\nقیمت تخمینی: ${price.toLocaleString("en-US")} تومان\nاین تخمین اولیه است و کارشناس دفتر دیار برای بررسی نهایی با شما تماس می‌گیرد.`,
    done: true,
    lead: { fileInfo: info.fileInfo, estimatedPrice: price },
  });
}

const realFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  if (/generativelanguage\.googleapis\.com/.test(String(url))) {
    await new Promise((r) => setTimeout(r, 350)); // کمی تأخیر تا حالت «در حال نوشتن…» دیده شود
    return simulateModel(JSON.parse(options.body ?? "{}"));
  }
  return realFetch(url, options);
};

// ── بالا آوردن سرور واقعی ────────────────────────────────
const { createWebApp } = await import("../src/webApi.js");
const express = (await import("express")).default;

// اپ اصلی دست‌نخورده می‌ماند؛ فقط در «پیش‌نمایش» یک لایهٔ نازک رویش می‌گذاریم تا
// باز کردن ریشهٔ آدرس (مثلاً در پیش‌نمایش زنده) مستقیماً به خود مینی‌اپ برود.
const app = express();
app.get("/", (req, res) => res.redirect("/app"));
app.use(createWebApp());

app.listen(PORT, HOST, () => {
  console.log("────────────────────────────────────────────────────────");
  console.log("🧪 پیش‌نمایش مینی‌اپ پیش‌هوش (بدون Gemini و گوگل‌شیت واقعی)");
  console.log(`   مینی‌اپ:   http://localhost:${PORT}/app`);
  console.log(`   ویجت دمو: http://localhost:${PORT}/demo`);
  console.log(`   سلامت:    http://localhost:${PORT}/health`);
  console.log("────────────────────────────────────────────────────────");
  console.log("   ۱) در تب «پروژه‌ها» روی یک پروژه بزنید");
  console.log("   ۲) شمارهٔ تماس را وارد کنید (یا «فعلاً بدون شماره»)");
  console.log("   ۳) مثلاً بنویسید: ۱۲۰ متر، طبقه ۵، ساخت ۱۴۰۲");
  console.log("   لیدِ ثبت‌شده در همین کنسول چاپ می‌شود.");
  console.log(`   توکن نمایشی برای ساخت initData معتبر: ${process.env.TELEGRAM_BOT_TOKEN}\n`);
});
