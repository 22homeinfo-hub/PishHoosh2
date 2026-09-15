// ماژول هوش مصنوعی (Gemini): مدیریت مکالمه + تخمین قیمت

import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";
dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-3.6-flash" });

// می‌سازد system prompt مخصوص یک پروژه خاص، شامل فیلدهایی که باید پرسیده شود
function buildSystemPrompt(project) {
  const priceLine = project.pricePerMeter
    ? `قیمت پایه هر متر: ${project.pricePerMeter.toLocaleString("fa-IR")} تومان`
    : "قیمت پایه هر متر مشخص نشده - فرمول قیمت‌گذاری کامل توی توضیحات زیره، از همون استفاده کن.";

  return `تو "پیش‌هوش" هستی، دستیار هوشمند تخصصی قیمت‌گذاری پروژه‌های پیش‌خرید ملک. فارسی، محاوره‌ای و مودب صحبت کن.

کاربر داره اطلاعات فایلش رو برای پروژه "${project.name}" ثبت می‌کنه.

فیلدهایی که باید یکی‌یکی بپرسی:
${project.fields.map((f, i) => `${i + 1}. ${f}`).join("\n")}

توضیحات و قوانین قیمت‌گذاری این پروژه (این قوانین رو دقیق و کامل رعایت کن؛ فقط از همین اطلاعات برای محاسبه استفاده کن، چیزی از خودت اضافه نکن):
${project.notes || "توضیح خاصی ثبت نشده"}

${priceLine}

قوانین سبک نوشتن:
- جمله‌هات همیشه کامل و قابل‌فهم باشه، هرگز تک‌کلمه یا نصفه‌ولا جواب نده.
- مختصر و کاربردی بنویس ولی هر چقدر لازمه توضیح بده - کوتاهی نباید به قیمت گنگ و نامفهوم شدن جواب تموم بشه.
- در هر پیام یک سوال روشن و کامل بپرس.
- ایموجی کم و به‌جا استفاده کن.

قوانین محتوا:
- وقتی همه فیلدها رو گرفتی، دقیقاً طبق فرمول قیمت‌گذاری بالا محاسبه کن و قیمت تخمینی رو با عدد دقیق اعلام کن، همراه با توضیح کوتاه چطور محاسبه شد.
- بگو این تخمین اولیه است و کارشناس دیار تماس می‌گیره.
- در پایان، نام و شماره تماس کاربر رو هم بپرس (اگر نگفته).
- هرگز قیمت رو صد در صد قطعی و نهایی اعلام نکن.
- اگه کاربر سوال بی‌ربط پرسید، مودبانه به مسیر اصلی برش گردون.`;
}

// شروع یک مکالمه جدید برای یک پروژه خاص
export function startConversation(project) {
  return model.startChat({
    history: [
      {
        role: "user",
        parts: [{ text: buildSystemPrompt(project) }],
      },
      {
        role: "model",
        parts: [
          {
            text: `سلام 🌷 من پیش‌هوش هستم. برای پروژه "${project.name}" شروع می‌کنیم. ${project.fields[0]} رو بگید؟`,
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.6,
    },
  });
}

// ارسال پیام کاربر به مکالمه فعال و گرفتن پاسخ
export async function sendMessage(chatSession, userText) {
  const result = await chatSession.sendMessage(userText);
  return result.response.text();
}

// تشخیص اینکه آیا مکالمه به مرحله "تخمین قیمت نهایی داده شد" رسیده یا نه
// از خود مدل می‌خوایم که این تشخیص رو با یک پیام جدا بده (ساده و قابل اعتماد)
export async function checkIfComplete(chatSession) {
  const probe = `فقط با یک کلمه جواب بده: اگه در این مکالمه، همه اطلاعات فایل + نام و شماره تماس کاربر گرفته شده و قیمت تخمینی هم اعلام شده، بنویس "COMPLETE". در غیر این صورت بنویس "CONTINUE".`;
  const result = await chatSession.sendMessage(probe);
  const text = result.response.text().trim();
  return text.includes("COMPLETE");
}

// استخراج ساخت‌یافته اطلاعات لید از تاریخچه مکالمه (برای ثبت در شیت)
export async function extractLeadData(chatSession, project) {
  const prompt = `بر اساس کل این مکالمه، فقط یک JSON خام (بدون توضیح، بدون Markdown، بدون بک‌تیک) با این ساختار دقیق برگردون:
{
  "customerName": "نام مشتری یا خالی",
  "phone": "شماره تماس یا خالی",
  "fileInfo": "خلاصه‌ای یک‌خطی از تمام اطلاعات فایل که کاربر گفته (${project.fields.join("، ")})",
  "estimatedPrice": "قیمت تخمینی که اعلام کردی، فقط عدد و واحد تومان، یا خالی"
}`;
  const result = await chatSession.sendMessage(prompt);
  let text = result.response.text().trim();
  text = text.replace(/```json|```/g, "").trim();
  try {
    return JSON.parse(text);
  } catch (e) {
    console.error("خطا در پارس کردن JSON خروجی AI:", text);
    return {
      customerName: "",
      phone: "",
      fileInfo: "خطا در استخراج خودکار - لطفا مکالمه رو دستی چک کنید",
      estimatedPrice: "",
    };
  }
}
