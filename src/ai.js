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

import "./env.js";
import { GoogleGenAI } from "@google/genai";
import { formatToman } from "./text.js";

const MODEL = process.env.GEMINI_MODEL?.trim() || "gemini-3.6-flash";
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

// اسکیمای خروجی ساخت‌یافته: مدل همیشه در این قالب جواب می‌دهد
const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    reply: {
      type: "string",
      description: "متن کامل و نهایی پیامی که عیناً به کاربر نمایش داده می‌شود (فارسی، بدون JSON، بدون مارک‌داون).",
    },
    done: {
      type: "boolean",
      description:
        "فقط وقتی true که تمام فیلدهای فایل گرفته شده، قیمت تخمینی اعلام شده و نام و شماره تماس کاربر هم گرفته شده باشد.",
    },
    lead: {
      type: "object",
      nullable: true,
      description: "فقط وقتی done=true پر شود؛ در غیر این صورت null.",
      properties: {
        customerName: { type: "string", description: "نام و نام خانوادگی مشتری" },
        phone: { type: "string", description: "شماره تماس مشتری، فقط رقم‌ها" },
        fileInfo: { type: "string", description: "خلاصه یک‌خطی و کامل از همه اطلاعات فایل، با جداکننده «،»" },
        estimatedPrice: { type: "number", description: "قیمت تخمینی کل به تومان، فقط عدد بدون واحد و بدون جداکننده" },
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

فیلدهایی که باید به‌ترتیب و یکی‌یکی بپرسی:
${fields.map((f, i) => `${i + 1}. ${f}`).join("\n")}

توضیحات و قوانین قیمت‌گذاری این پروژه (فقط از همین اطلاعات استفاده کن و چیزی از خودت اضافه نکن):
${project.notes || "توضیح خاصی ثبت نشده."}

${priceLine}

قوانین پاسخ‌دهی:
- در هر پیام فقط «یک» سوال روشن و کامل بپرس.
- جمله‌ها کامل و قابل‌فهم باشند؛ هیچ‌وقت تک‌کلمه یا نصفه‌ولا جواب نده.
- مختصر بنویس اما به قیمت گنگ شدن جواب، چیزی را حذف نکن.
- اگر کاربر عدد یا اطلاعات نامعتبر داد (مثلاً متراژ صفر)، مؤدبانه اصلاحش را بخواه.
- اگر کاربر سوال بی‌ربط پرسید، کوتاه و مؤدبانه او را به مسیر ثبت فایل برگردان.
- ایموجی کم و به‌جا استفاده کن.
- هرگز اطلاعاتی که کاربر نگفته را حدس نزن یا جای خالی پر نکن.

قوانین پایان مکالمه:
- وقتی همه فیلدها را گرفتی، دقیقاً طبق قوانین قیمت‌گذاری بالا محاسبه کن و قیمت تخمینی را با عدد دقیق اعلام کن و کوتاه بگو چطور محاسبه شد.
- سپس نام و شماره تماس کاربر را بپرس (اگر نگرفته‌ای).
- همیشه بگو این تخمین «اولیه» است و کارشناس دفتر دیار برای بررسی نهایی تماس می‌گیرد.
- هیچ‌وقت قیمت را صددرصد قطعی و نهایی اعلام نکن.

قالب خروجی (بسیار مهم):
خروجی تو همیشه یک JSON معتبر با این ساختار است و هیچ چیز دیگری:
{"reply": "متنی که کاربر می‌بیند", "done": false, "lead": null}
- فیلد reply تنها جایی است که متن مکالمه می‌رود؛ داخلش JSON یا بک‌تیک نگذار.
- done فقط زمانی true است که همه فیلدها + نام + شماره تماس گرفته شده و قیمت هم اعلام شده باشد.
- وقتی done=true است، lead را با customerName و phone و fileInfo و estimatedPrice (عدد به تومان) پر کن.

بعد از پایان مکالمه:
- اگر کاربر سوالی پرسید یا اطلاعاتی را اصلاح کرد (مثلاً شمارهٔ اشتباه را درست کرد)، کمکش کن و در همان JSON، lead اصلاح‌شده را با done=true برگردان.
- اگر کاربر خواست فایل جدیدی ثبت کند، او را راهنمایی کن که «شروع مجدد» را بفرستد.`;
}

// ساخت سلام اولیه بدون مصرف سهمیه API
function buildGreeting(project) {
  const firstField = project.fields?.[0] || "مشخصات کلی فایلتون";
  return `سلام 🌷 من پیش‌هوش هستم، دستیار هوشمند دفتر املاک دیار.\nبرای پروژه «${project.name}» شروع می‌کنیم.\n\nلطفاً ${firstField} رو بگید؟`;
}

/**
 * شروع یک مکالمه جدید برای یک پروژه.
 * خروجی: { chat, greeting, project }
 * سلام اولیه در history «کاشته» می‌شود تا بدون هزینه API، مدل بداند چه چیزی پرسیده است.
 * (نکته: چون همیشه یک پیام کاربر بعد از آن می‌آید، آخرین turn هرگز model نیست.)
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
          customerName: String(parsed.lead.customerName ?? "").trim(),
          phone: String(parsed.lead.phone ?? "").trim(),
          fileInfo: String(parsed.lead.fileInfo ?? "").trim(),
          estimatedPrice: parsed.lead.estimatedPrice ?? "",
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
