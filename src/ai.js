// ماژول هوش مصنوعی (Gemini)
//
// تغییرات کلیدی نسبت به نسخه قبلی:
// ۱) مهاجرت از پکیج deprecated «@google/generative-ai» به SDK رسمی «@google/genai».
// ۲) استفاده از systemInstruction واقعی به‌جای جا زدن prompt در نقش «کاربر».
// ۳) حذف temperature (در gemini-3.6-flash به بعد نادیده گرفته می‌شود) و استفاده از thinkingLevel.
// ۴) به‌جای ۳ درخواست برای هر پیام کاربر (پاسخ + تشخیص پایان + استخراج JSON)،
//    حالا فقط «یک» درخواست می‌زنیم و مدل هم‌زمان پاسخ، وضعیت پایان و اطلاعات لید را
//    در قالب JSON ساخت‌یافته (structured output) برمی‌گرداند.
//    این کار هزینه/تأخیر را یک‌سوم می‌کند و تاریخچه مکالمه را از پیام‌های متا پاک نگه می‌دارد.
// ۵) قیمت نهایی زیر یک میلیون تومان گرد می‌شود و توضیح محاسبه به کاربر داده نمی‌شود.
// ۶) همه فیلدهای موردنیاز طی یک سوال ترکیبی پرسیده می‌شوند (نه یکی‌یکی).
// ۷) نام و شماره تماس دیگر توسط مدل پرسیده نمی‌شود - این اطلاعات از قبل توسط تلگرام
//    (دکمه اشتراک مخاطب) یا فرم لندینگ‌پیج گرفته شده و مستقیماً به مدل داده می‌شود.

import "./env.js";
import { GoogleGenAI } from "@google/genai";
import { formatToman } from "./text.js";

const MODEL = process.env.GEMINI_MODEL?.trim() || "gemini-3.1-flash-lite";
const VALID_THINKING_LEVELS = ["minimal", "low", "medium", "high"];
const REQUESTED_LEVEL = (process.env.GEMINI_THINKING_LEVEL?.trim() || "low").toLowerCase();
const THINKING_LEVEL = VALID_THINKING_LEVELS.includes(REQUESTED_LEVEL) ? REQUESTED_LEVEL : "low";

let client = null;
function getClient() {
  if (!client) {
    if (!process.env.GEMINI_API_KEY) {
      throw new AiError("GEMINI_API_KEY تنظیم نشده است.", "سرویس هوش مصنوعی فعال نیست. لطفاً با پشتیبانی تماس بگیرید.", false);
    }
    client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return client;
}

// خطایی که هم پیام فنی دارد (برای لاگ) و هم پیام کاربری (برای نمایش به مشتری)
export class AiError extends Error {
  constructor(message, userMessage = "متاسفانه خطایی پیش اومد. لطفاً دوباره امتحان کنید.", retryable = true, cause = null) {
    super(message);
    this.name = "AiError";
    this.userMessage = userMessage;
    this.retryable = retryable;
    if (cause) this.cause = cause;
  }
}

// قیمت نهایی را زیر یک میلیون تومان گرد می‌کند (مثلاً ۳٬۸۲۵٬۴۳۲٬۰۰۰ → ۳٬۸۲۵٬۰۰۰٬۰۰۰)
function roundToMillion(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return num;
  return Math.round(num / 1_000_000) * 1_000_000;
}

// اسکیمای خروجی ساخت‌یافته: مدل همیشه در این قالب جواب می‌دهد
const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    reply: {
      type: "string",
      description:
        "متن کامل و نهایی پیامی که عیناً به کاربر نمایش داده می‌شود (فارسی، بدون JSON، بدون مارک‌داون). هرگز جزئیات فرمول یا نحوه محاسبه قیمت را توضیح نده - فقط عدد نهایی را اعلام کن.",
    },
    done: {
      type: "boolean",
      description: "فقط وقتی true که تمام فیلدهای فایل گرفته شده و قیمت تخمینی اعلام شده باشد.",
    },
    lead: {
      type: "object",
      nullable: true,
      description: "فقط وقتی done=true پر شود؛ در غیر این صورت null.",
      properties: {
        fileInfo: { type: "string", description: "خلاصه یک‌خطی و کامل از همه اطلاعات فایل، با جداکننده «،»" },
        estimatedPrice: {
          type: "number",
          description: "قیمت تخمینی کل به تومان، فقط عدد بدون واحد و بدون جداکننده، گرد شده به نزدیک‌ترین یک میلیون تومان",
        },
      },
    },
  },
  required: ["reply", "done"],
  propertyOrdering: ["reply", "done", "lead"],
};

function buildSystemInstruction(project) {
  const fields = project.fields?.length ? project.fields : ["مشخصات کلی فایل"];
  const priceLine =
    project.pricePerMeter !== null && project.pricePerMeter !== undefined
      ? `قیمت پایه هر متر: ${formatToman(project.pricePerMeter)} (این عدد قطعی و معتبر است).`
      : "قیمت پایه هر متر در شیت ثبت نشده؛ فقط از فرمول/اعداد موجود در توضیحات زیر استفاده کن و اگر عددی نبود، از کاربر بپرس یا بگو کارشناس اعلام می‌کند. هرگز قیمت را از خودت اختراع نکن.";

  return `تو «پیش‌هوش» هستی، دستیار تخصصی قیمت‌گذاری پروژه‌های پیش‌خرید ملک برای دفتر املاک دیار.
فارسی، محاوره‌ای، مودب و شمرده صحبت کن.

کاربر در حال ثبت اطلاعات فایل خودش برای پروژه «${project.name}» است.

فیلدهایی که باید از کاربر بگیری:
${fields.map((f, i) => `${i + 1}. ${f}`).join("\n")}

توضیحات و قوانین قیمت‌گذاری این پروژه (فقط از همین اطلاعات استفاده کن و چیزی از خودت اضافه نکن):
${project.notes || "توضیح خاصی ثبت نشده."}

${priceLine}

قوانین پرسیدن اطلاعات (بسیار مهم):
- در همان اولین پیامت، تمام فیلدهای بالا را با هم و طی یک سوال ترکیبی از کاربر بپرس (نه یکی‌یکی و نه طی چند پیام جدا). مثلاً: «لطفاً متراژ، تیپ واحد و مبلغ واریزی‌تون رو با هم بفرستید.»
- اگر کاربر همه اطلاعات را یک‌جا داد، دیگر سوال دیگری نپرس و مستقیم برو سراغ اعلام قیمت.
- اگر کاربر فقط بخشی از اطلاعات را داد، فقط دربارهٔ فیلدهای باقی‌مانده (با هم، نه یکی‌یکی) دوباره بپرس.
- هرگز اطلاعاتی که کاربر نگفته را حدس نزن یا جای خالی پر نکن.
- اگر کاربر عدد یا اطلاعات نامعتبر داد (مثلاً متراژ صفر)، مؤدبانه اصلاحش را بخواه.
- اگر کاربر سوال بی‌ربط پرسید، کوتاه و مؤدبانه او را به مسیر ثبت فایل برگردان.
- ایموجی کم و به‌جا استفاده کن.
- جمله‌ها کامل و قابل‌فهم باشند؛ هیچ‌وقت تک‌کلمه یا نصفه‌ولا جواب نده.

قوانین اعلام قیمت (بسیار مهم):
- وقتی همه فیلدها را گرفتی، طبق قوانین قیمت‌گذاری بالا محاسبه کن.
- قیمت نهایی را به نزدیک‌ترین یک میلیون تومان گرد کن (اعداد زیر یک میلیون تومان را حساب نکن).
- فقط عدد نهایی تخمینی را اعلام کن - هرگز فرمول، رتبه، یا نحوه محاسبه را برای کاربر توضیح نده یا شرح نده. فقط بگو قیمت تخمینی فلان‌قدر است.
- همیشه بگو این تخمین «اولیه» است و کارشناس دفتر دیار برای بررسی نهایی تماس می‌گیرد.
- هیچ‌وقت قیمت را صددرصد قطعی و نهایی اعلام نکن.
- نام و شماره تماس کاربر را از او نپرس - این اطلاعات از قبل گرفته شده و در ادامه این پیام به تو داده می‌شود.

قالب خروجی (بسیار مهم):
خروجی تو همیشه یک JSON معتبر با این ساختار است و هیچ چیز دیگری:
{"reply": "متنی که کاربر می‌بیند", "done": false, "lead": null}
- فیلد reply تنها جایی است که متن مکالمه می‌رود؛ داخلش JSON یا بک‌تیک نگذار.
- done فقط زمانی true است که همه فیلدها گرفته شده و قیمت هم اعلام شده باشد.
- وقتی done=true است، lead را با fileInfo و estimatedPrice (عدد گرد شده به تومان) پر کن.

بعد از پایان مکالمه:
- اگر کاربر سوالی پرسید یا اطلاعاتی را اصلاح کرد، کمکش کن و در همان JSON، lead اصلاح‌شده را با done=true برگردان.
- اگر کاربر خواست فایل جدیدی ثبت کند، او را راهنمایی کن که «شروع مجدد» را بفرستد.`;
}

// ساخت سلام اولیه بدون مصرف سهمیه API - همه فیلدها را با هم می‌پرسد
function buildGreeting(project) {
  const fields = project.fields?.length ? project.fields : ["مشخصات کلی فایلتون"];
  const fieldsLine = fields.join("، ");
  return `برای پروژه «${project.name}» شروع می‌کنیم.\nلطفاً ${fieldsLine} رو با هم برام بفرستید؟`;
}

/**
 * شروع یک مکالمه جدید برای یک پروژه.
 * خروجی: { chat, greeting, project }
 * سلام اولیه در history «کاشته» می‌شود تا بدون هزینه API، مدل بداند چه چیزی پرسیده است.
 */
export function startConversation(project) {
  if (!project) throw new AiError("پروژه‌ای برای شروع مکالمه داده نشده.", "پروژه پیدا نشد.", false);
  if (!Array.isArray(project.fields) || project.fields.length === 0) {
    throw new AiError(
      `پروژه «${project.name}» هیچ فیلدی در ستون «فیلدهای موردنیاز» ندارد.`,
      "برای این پروژه هنوز فیلدهای لازم در سیستم تعریف نشده. لطفاً با دفتر دیار تماس بگیرید.",
      false
    );
  }

  const greeting = buildGreeting(project);
  const chat = getClient().chats.create({
    model: MODEL,
    config: {
      systemInstruction: buildSystemInstruction(project),
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
      thinkingConfig: { thinkingLevel: THINKING_LEVEL.toUpperCase() },
    },
    history: [
      { role: "user", parts: [{ text: `سلام، می‌خوام اطلاعات فایلم رو برای پروژه «${project.name}» ثبت کنم.` }] },
      { role: "model", parts: [{ text: JSON.stringify({ reply: greeting, done: false, lead: null }) }] },
    ],
  });

  return { chat, greeting, project };
}

// استخراج متن از پاسخ، حتی وقتی candidate خالی یا بلاک شده است
function extractRawText(response) {
  const candidate = response?.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];
  const text = parts
    .filter((p) => typeof p?.text === "string" && !p?.thought)
    .map((p) => p.text)
    .join("")
    .trim();
  if (text) return text;

  const blockReason = response?.promptFeedback?.blockReason;
  const finishReason = candidate?.finishReason;
  if (blockReason) throw new AiError(`پاسخ مدل بلاک شد: ${blockReason}`, "متاسفانه این پیام پردازش نشد. لطفاً جمله‌بندی رو تغییر بدید.", true);
  if (finishReason && finishReason !== "STOP" && finishReason !== "MAX_TOKENS") {
    throw new AiError(`پاسخ مدل ناقص بود: ${finishReason}`, "متاسفانه پاسخ کامل تولید نشد. لطفاً دوباره امتحان کنید.", true);
  }
  return "";
}

// پارس مقاوم JSON (اگر مدل احیاناً توضیح یا بک‌تیک اضافه کرد هم کار کند)
function parseModelJson(raw) {
  if (!raw) return null;
  const candidates = [raw, raw.replace(/```json|```/gi, "").trim()];
  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) candidates.push(raw.slice(firstBrace, lastBrace + 1));

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      // ادامه به نامزد بعدی
    }
  }
  return null;
}

function classifyError(err) {
  const message = String(err?.message ?? err);
  if (/\b(429|RESOURCE_EXHAUSTED|quota|rate limit)/i.test(message)) {
    return new AiError(message, "سرویس فعلاً شلوغه 🙏 لطفاً یک دقیقه دیگه دوباره امتحان کنید.", true, err);
  }
  if (/\b(400|INVALID_ARGUMENT)\b/.test(message) && /model/i.test(message)) {
    return new AiError(message, "مدل هوش مصنوعی درست تنظیم نشده. لطفاً به پشتیبانی اطلاع بدید.", false, err);
  }
  if (/\b(401|403|API_KEY_INVALID|PERMISSION_DENIED)\b/.test(message)) {
    return new AiError(message, "سرویس هوش مصنوعی فعلاً در دسترس نیست. لطفاً به پشتیبانی اطلاع بدید.", false, err);
  }
  return new AiError(message, "متاسفانه خطایی پیش اومد 🙏 لطفاً دوباره امتحان کنید.", true, err);
}

/**
 * ارسال پیام کاربر و گرفتن پاسخ ساخت‌یافته.
 * خروجی: { reply, done, lead, raw }
 * قیمت تخمینی همیشه به نزدیک‌ترین یک میلیون تومان گرد می‌شود.
 */
export async function sendTurn(chat, userText) {
  let response;
  try {
    response = await chat.sendMessage({ message: String(userText) });
  } catch (err) {
    throw classifyError(err);
  }

  const raw = extractRawText(response);
  const parsed = parseModelJson(raw);

  // اگر مدل به هر دلیلی JSON نداد، همان متن را به‌عنوان پاسخ نشان می‌دهیم
  if (!parsed) {
    const fallback = raw || "متاسفانه پاسخی تولید نشد. لطفاً دوباره امتحان کنید.";
    return { reply: fallback, done: false, lead: null, raw };
  }

  const reply = typeof parsed.reply === "string" && parsed.reply.trim() ? parsed.reply.trim() : "";
  const lead =
    parsed.lead && typeof parsed.lead === "object"
      ? {
          fileInfo: String(parsed.lead.fileInfo ?? "").trim(),
          estimatedPrice: roundToMillion(parsed.lead.estimatedPrice ?? ""),
        }
      : null;

  return {
    reply: reply || "متاسفانه پاسخی تولید نشد. لطفاً دوباره امتحان کنید.",
    done: parsed.done === true,
    lead,
    raw,
  };
}

// فقط برای ابزار تشخیص (npm run doctor): یک درخواست کوچک برای سنجش سلامت کلید و مدل
export async function pingModel() {
  const res = await getClient().models.generateContent({
    model: MODEL,
    contents: "فقط کلمه OK را برگردان.",
    config: { maxOutputTokens: 64, thinkingConfig: { thinkingLevel: THINKING_LEVEL.toUpperCase() } },
  });
  return { model: MODEL, thinkingLevel: THINKING_LEVEL, text: (res.text ?? "").trim().slice(0, 40) };
}

export const aiConfig = { model: MODEL, thinkingLevel: THINKING_LEVEL };
