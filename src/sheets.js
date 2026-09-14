// ماژول اتصال به Google Sheets
// وظیفه: خواندن لیست پروژه‌ها + نوشتن لیدهای جدید

import { GoogleSpreadsheet } from "google-spreadsheet";
import { JWT } from "google-auth-library";
import dotenv from "dotenv";
dotenv.config();

let doc = null;
let projectsCache = null;
let projectsCacheTime = 0;
const CACHE_TTL_MS = 2 * 60 * 1000; // ۲ دقیقه کش تا فشار کمتری به Google API وارد بشه

// مقدار private_key ممکنه دو حالت داشته باشه بسته به اینکه چطور توی
// متغیر محیطی وارد شده: یا شامل کاراکترهای متنی \n (که باید به newline واقعی تبدیل بشن)
// یا از قبل شامل newline واقعی باشه (که نیازی به تبدیل نداره). این تابع هر دو حالت رو پوشش میده.
function normalizePrivateKey(raw) {
  if (!raw) return raw;
  let key = raw.trim();
  // اگه دور کل مقدار کوتیشن اضافه مونده باشه (مثلا از کپی‌پیست اشتباه)، پاکش کن
  if (
    (key.startsWith('"') && key.endsWith('"')) ||
    (key.startsWith("'") && key.endsWith("'"))
  ) {
    key = key.slice(1, -1);
  }
  // اگه شامل کاراکتر متنی \n هست، تبدیلش کن به newline واقعی
  if (key.includes("\\n")) {
    key = key.replace(/\\n/g, "\n");
  }
  return key;
}

async function getDoc() {
  if (doc) return doc;

  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = normalizePrivateKey(process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY);

  // چک اولیه فرمت کلید - قبل از اینکه به گوگل درخواست بزنیم
  if (!key || !key.includes("BEGIN PRIVATE KEY")) {
    throw new Error(
      "فرمت GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY نامعتبره - باید شامل 'BEGIN PRIVATE KEY' باشه."
    );
  }

  const serviceAccountAuth = new JWT({
    email,
    key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID, serviceAccountAuth);

  try {
    await doc.loadInfo();
  } catch (err) {
    // لاگ دقیق‌تر برای دیباگ - جزئیات خطای واقعی گوگل رو نشون میده
    doc = null; // ریست کن که دفعه بعد دوباره تلاش کنه
    const detail = err?.response?.data?.error || err.message;
    console.error("❌ خطا در اتصال به Google Sheets:", JSON.stringify(detail));
    throw new Error(
      `اتصال به Google Sheets ناموفق بود: ${
        detail?.message || err.message
      } (کد: ${detail?.code || err?.response?.status || "نامشخص"})`
    );
  }

  return doc;
}

// خواندن تمام پروژه‌های فعال از شیت Projects
export async function getActiveProjects() {
  const now = Date.now();
  if (projectsCache && now - projectsCacheTime < CACHE_TTL_MS) {
    return projectsCache;
  }

  const d = await getDoc();
  const sheet = d.sheetsByTitle["Projects"];
  if (!sheet) throw new Error("شیت 'Projects' پیدا نشد. اسم تب رو چک کنید.");

  const rows = await sheet.getRows();

  const projects = rows
    .map((row) => ({
      name: (row.get("نام پروژه") || "").trim(),
      fields: (row.get("فیلدهای موردنیاز (با کاما جدا کنید)") || "")
        .split(",")
        .map((f) => f.trim())
        .filter(Boolean),
      pricePerMeter: Number(row.get("قیمت پایه هر متر (تومان)") || 0),
      notes: (row.get("توضیحات کمکی برای AI") || "").trim(),
      active: (row.get("فعال؟") || "").trim() === "بله",
    }))
    .filter((p) => p.name && p.active);

  projectsCache = projects;
  projectsCacheTime = now;
  return projects;
}

// یافتن یک پروژه بر اساس نام (برای زمانی که کاربر اسم پروژه رو تایپ می‌کنه)
export async function findProjectByName(name) {
  const projects = await getActiveProjects();
  const normalized = name.trim().toLowerCase();
  return projects.find(
    (p) =>
      p.name.toLowerCase() === normalized ||
      p.name.toLowerCase().includes(normalized) ||
      normalized.includes(p.name.toLowerCase())
  );
}

// ثبت یک لید جدید در شیت Leads
export async function addLead({
  customerName,
  phone,
  projectName,
  fileInfo,
  estimatedPrice,
  source,
}) {
  const d = await getDoc();
  const sheet = d.sheetsByTitle["Leads"];
  if (!sheet) throw new Error("شیت 'Leads' پیدا نشد. اسم تب رو چک کنید.");

  const now = new Date();
  const dateStr = now.toLocaleString("fa-IR", {
    timeZone: "Asia/Tehran",
  });

  await sheet.addRow({
    "تاریخ": dateStr,
    "نام مشتری": customerName || "",
    "شماره تماس": phone || "",
    "نام پروژه": projectName || "",
    "اطلاعات فایل": fileInfo || "",
    "قیمت تخمینی (تومان)": estimatedPrice || "",
    "منبع": source || "",
  });
}
