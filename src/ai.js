// ماژول هوش مصنوعی (Gemini): مدیریت مکالمه + تخمین قیمت

import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";
dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-3.6-flash" });
// می‌سازد system prompt مخصوص یک پروژه خاص، شامل فیلدهایی که باید پرسیده شود
function buildSystemPrompt(project) {
  return `تو یک دستیار هوشمند دفتر املاک "دیار" هستی. وظیفه‌ات اینه که با کاربر به فارسی و محاوره‌ای، مودبانه و دوستانه صحبت کنی.

کاربر می‌خواد اطلاعات فایل ملکی‌اش رو برای پروژه "${project.name}" ثبت کنه.

اطلاعاتی که باید از کاربر بپرسی (یکی‌یکی، نه همه با هم):
${project.fields.map((f, i) => `${i + 1}. ${f}`).join("\n")}

نکات کمکی درباره این پروژه (برای کمک به تخمین قیمت، به کاربر مستقیم نگو):
${project.notes || "توضیح خاصی ثبت نشده"}

قیمت پایه هر متر مربع این پروژه: ${project.pricePerMeter.toLocaleString("fa-IR")} تومان

قوانین مهم:
- سوالات رو یکی‌یکی و کوتاه بپرس، نه به صورت لیست بلند.
- لحن گرم، محترمانه و طبیعی داشته باش، مثل یک مشاور املاک واقعی.
- وقتی همه اطلاعات لازم (فیلدهای بالا) رو گرفتی، یک تخمین قیمت تقریبی بر اساس قیمت پایه هر متر و ویژگی‌های فایل (طبقه، سن بنا، امکانات و...) بده. توضیح بده که این فقط تخمین اولیه است و کارشناس دفتر تماس می‌گیرد.
- در پایان، حتما نام کامل و شماره تماس کاربر رو هم بپرس (اگر قبلا نگفته).
- هرگز قیمت قطعی و نهایی اعلام نکن؛ همیشه بگو "تخمین حدودی" یا "برآورد اولیه".
- اگر کاربر سوالی خارج از موضوع پرسید، مودبانه به مسیر اصلی برش گردون.`;
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
            text: `سلام! خوش اومدید 🌷 خوشحالم که برای پروژه "${project.name}" اطلاعات فایلتون رو ثبت می‌کنید. بیاید شروع کنیم، ${project.fields[0]} رو برام بگید؟`,
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 500,
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
