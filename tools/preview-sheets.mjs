// گوگل‌شیت نمایشی برای پیش‌نمایش مینی‌اپ (npm run miniapp:preview)
//
// چرا این فایل؟ چون برای دیدن و کلیک‌کردن رابط مینی‌اپ در مرورگر، نباید به کلید
// Gemini و سرویس‌اکانت گوگل نیاز باشد. اینجا چند پروژهٔ نمونه با قیمت پایهٔ
// واقعی‌نما تعریف شده و لیدها به‌جای نوشتن در شیت، در کنسول چاپ می‌شوند.
//
// منطق پیدا کردن پروژه دقیقاً همان کد واقعی (src/projects.js) است.

import { matchProject } from "../src/projects.js";

export const PROJECTS = [
  {
    name: "پارسیان ۱",
    fields: ["متراژ", "طبقه", "سال ساخت"],
    pricePerMeter: 120000000,
    notes: "قیمت = متراژ × قیمت پایه هر متر؛ طبقهٔ بالای ۳ معادل ۵٪ اضافه",
    active: true,
    rowNumber: 2,
    warnings: [],
  },
  {
    name: "ساختمان نگین",
    fields: ["متراژ", "تعداد اتاق", "وضعیت سند"],
    pricePerMeter: 95000000,
    notes: "قیمت = متراژ × قیمت پایه هر متر",
    active: true,
    rowNumber: 3,
    warnings: [],
  },
  {
    name: "برج آسمان",
    fields: ["متراژ", "تیپ واحد", "مبلغ واریزی"],
    pricePerMeter: 185000000,
    notes: "قیمت = متراژ × قیمت پایه هر متر",
    active: true,
    rowNumber: 4,
    warnings: [],
  },
  {
    name: "شهرک زیتون",
    fields: ["متراژ زمین", "متراژ بنا", "سال ساخت"],
    pricePerMeter: 62000000,
    notes: "قیمت = متراژ بنا × قیمت پایه هر متر",
    active: true,
    rowNumber: 5,
    warnings: [],
  },
  {
    name: "پروژهٔ نمونهٔ بدون فیلد",
    fields: [],
    pricePerMeter: 90000000,
    notes: "",
    active: true,
    rowNumber: 6,
    warnings: ["ستون «فیلدهای موردنیاز» خالی است"],
  },
];

export const state = { leads: [], updates: [] };

export async function getActiveProjects() {
  return PROJECTS;
}

export async function findProject(input) {
  return matchProject(PROJECTS, input);
}

export function invalidateProjectsCache() {}

export async function addLead(lead) {
  const rowNumber = 10 + state.leads.length;
  state.leads.push({ rowNumber, ...lead });
  console.log("\n🧾 [پیش‌نمایش] لید ثبت شد (در نسخهٔ واقعی به گوگل‌شیت می‌رود):");
  console.log(`   نام: ${lead.customerName || "(خالی)"} | تماس: ${lead.phone || "(خالی)"} | پروژه: ${lead.projectName}`);
  console.log(`   اطلاعات فایل: ${lead.fileInfo || "-"}`);
  console.log(`   قیمت تخمینی: ${Number(lead.estimatedPrice || 0).toLocaleString("en-US")} تومان | منبع: ${lead.source}\n`);
  return { rowNumber };
}

export async function updateLead(rowNumber, patch) {
  const found = state.leads.find((l) => l.rowNumber === rowNumber);
  if (!found) throw new Error(`ردیف ${rowNumber} پیدا نشد`);
  Object.assign(found, patch);
  state.updates.push({ rowNumber, patch });
  console.log(`✏️ [پیش‌نمایش] لید ردیف ${rowNumber} به‌روز شد: ${patch.fileInfo || "-"}`);
  return { rowNumber };
}

export async function describeSheets() {
  return { tabs: ["Projects", "Leads"], projects: {}, leads: {} };
}
