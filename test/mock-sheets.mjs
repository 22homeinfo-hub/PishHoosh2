// گوگل‌شیت ساختگی برای تست منطق مکالمه
// نکته مهم: findProject از همان منطق واقعی (projects.js) استفاده می‌کند،
// پس تست‌ها رفتار واقعیِ پیدا کردن پروژه را می‌سنجند، نه یک کپی از آن.

import { matchProject } from "../src/projects.js";

export const PROJECTS = [
  {
    name: "پارسیان ۱",
    fields: ["متراژ", "طبقه", "سال ساخت"],
    pricePerMeter: 120000000,
    notes: "قیمت = متراژ × قیمت پایه هر متر",
    active: true,
    rowNumber: 2,
    warnings: [],
  },
  {
    name: "ساختمان نگین",
    fields: ["متراژ", "تعداد اتاق"],
    pricePerMeter: null,
    notes: "",
    active: true,
    rowNumber: 3,
    warnings: ["ستون «فیلدهای موردنیاز» خالی است"],
  },
  {
    name: "پروژه بدون فیلد",
    fields: [],
    pricePerMeter: 90000000,
    notes: "تست",
    active: true,
    rowNumber: 4,
    warnings: ["ستون «فیلدهای موردنیاز» خالی است"],
  },
];

export const state = {
  leads: [],
  updates: [],
  failNextSave: false,
  failAlways: false,
};

export function __reset() {
  state.leads = [];
  state.updates = [];
  state.failNextSave = false;
  state.failAlways = false;
}

export async function getActiveProjects() {
  return PROJECTS;
}

export async function findProject(input) {
  return matchProject(PROJECTS, input);
}

export function invalidateProjectsCache() {}

export async function addLead(lead) {
  if (state.failAlways || state.failNextSave) {
    state.failNextSave = false;
    throw new Error("PERMISSION_DENIED: سرویس‌اکانت دسترسی Editor ندارد");
  }
  const rowNumber = 10 + state.leads.length;
  state.leads.push({ rowNumber, ...lead });
  return { rowNumber };
}

export async function updateLead(rowNumber, patch) {
  const found = state.leads.find((l) => l.rowNumber === rowNumber);
  if (!found) throw new Error(`ردیف ${rowNumber} پیدا نشد`);
  Object.assign(found, patch);
  state.updates.push({ rowNumber, patch });
  return { rowNumber };
}

export async function describeSheets() {
  return { tabs: ["Projects", "Leads"], projects: {}, leads: {} };
}
