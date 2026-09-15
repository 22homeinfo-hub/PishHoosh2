// ماژول اتصال به Google Sheets
// وظیفه: خواندن لیست پروژه‌ها + نوشتن/به‌روزرسانی لیدها
//
// تغییرات کلیدی نسبت به نسخه قبلی:
// ۱) هدر ستون‌ها حالا «تحمل‌پذیر» پیدا می‌شوند (فاصله، نیم‌فاصله، ی/ي، ک/ك، پرانتز و «؟» مهم نیست).
//    قبلاً اگر هدر دقیقاً مثل کد نبود، بی‌صدا «پروژه فعالی تعریف نشده» می‌شد.
// ۲) اعداد با ارقام فارسی و جداکننده هزارگان هم درست خوانده می‌شوند.
//    قبلاً Number("120,000,000") = NaN می‌شد و قیمت پایه بی‌صدا از دست می‌رفت.
// ۳) فیلدها با «،» فارسی هم جدا می‌شوند (قبلاً فقط کامای انگلیسی).
// ۴) نوشتن لید فقط با هدرهای «موجود» در شیت انجام می‌شود و اگر ستون حیاتی نباشد، خطای روشن می‌دهد.
//    قبلاً addRow ستون ناشناخته را بی‌صدا دور می‌ریخت.
// ۵) به‌روزرسانی همان ردیف لید امکان‌پذیر است (برای اصلاح شماره/نام بعد از پایان مکالمه).
// ۶) [رفع باگ] getTab صریحاً sheet.loadHeaderRow() را صدا می‌زند. قبلاً فقط sheet.headerValues
//    خوانده می‌شد که هدر را برای resolveHeaders کافی نشان می‌داد، اما چون خودِ متد loadHeaderRow
//    هرگز اجرا نمی‌شد، اولین فراخوانی addRow با خطای "Header values are not yet loaded" شکست
//    می‌خورد (چون این کتابخانه پیش از نوشتن، به‌طور جدا header را لود شده می‌خواهد).

import "./env.js";
import { GoogleSpreadsheet } from "google-spreadsheet";
import { JWT } from "google-auth-library";
import { normalizeHeader, splitList, parseNumber, normalizeForMatch } from "./text.js";
import { matchProject } from "./projects.js";

const PROJECTS_TAB = (process.env.PROJECTS_SHEET_TITLE || "Projects").trim();
const LEADS_TAB = (process.env.LEADS_SHEET_TITLE || "Leads").trim();
const CACHE_TTL_MS = Number(process.env.SHEET_CACHE_TTL_MS) || 2 * 60 * 1000;

const PROJECT_HEADERS = {
  name: ["نام پروژه", "پروژه", "project name", "name"],
  fields: ["فیلدهای موردنیاز", "فیلدها", "سوالات", "fields"],
  pricePerMeter: ["قیمت پایه هر متر", "قیمت پایه", "قیمت هر متر", "price per meter"],
  notes: ["توضیحات کمکی برای ai", "توضیحات", "قوانین قیمت گذاری", "notes"],
  active: ["فعال", "وضعیت", "active"],
};

const LEAD_HEADERS = {
  date: ["تاریخ", "date"],
  jalaliDate: ["تاریخ شمسی", "تاریخ میلادی", "jalali date"],
  customerName: ["نام مشتری", "نام و نام خانوادگی", "customer name"],
  phone: ["شماره تماس", "تلفن", "موبایل", "phone"],
  projectName: ["نام پروژه", "project name", "project"],
  fileInfo: ["اطلاعات فایل", "مشخصات فایل", "file info"],
  estimatedPrice: ["قیمت تخمینی", "قیمت", "estimated price"],
  source: ["منبع", "source"],
};

const REQUIRED_LEAD_HEADERS = ["customerName", "phone", "projectName"];

let docPromise = null;
let projectsCache = null;
let projectsCacheTime = 0;
let leadsHeaderCache = null;

function normalizePrivateKey(raw) {
  if (!raw) return raw;
  let key = String(raw).trim();
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
    key = key.slice(1, -1);
  }
  if (key.includes("\\n")) key = key.replace(/\\n/g, "\n");
  return key;
}

async function createDoc() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim();
  const key = normalizePrivateKey(process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY);
  const sheetId = process.env.GOOGLE_SHEET_ID?.trim();

  if (!sheetId) throw new Error("GOOGLE_SHEET_ID تنظیم نشده است.");
  if (!email) throw new Error("GOOGLE_SERVICE_ACCOUNT_EMAIL تنظیم نشده است.");
  if (!key || !key.includes("BEGIN PRIVATE KEY")) {
    throw new Error(
      "فرمت GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY نامعتبر است؛ باید شامل 'BEGIN PRIVATE KEY' باشد و \\nهای آن حفظ شده باشد."
    );
  }

  const auth = new JWT({ email, key, scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
  const doc = new GoogleSpreadsheet(sheetId, auth);
  try {
    await doc.loadInfo();
  } catch (err) {
    throw new Error(friendlySheetsError(err));
  }
  return doc;
}

function friendlySheetsError(err) {
  const message = String(err?.message ?? err);
  const status = err?.response?.status;
  const code = err?.response?.data?.error?.code;

  if (/DECODER routines|unsupported|not enough data|bad decrypt|error:0D|error:1E/i.test(message)) {
    return "کلید خصوصی سرویس‌اکانت قابل خواندن نیست. مقدار GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY را کامل (با \\nها و داخل کوتیشن) از فایل JSON کپی کنید.";
  }
  if (status === 403 || code === 403 || /PERMISSION_DENIED/i.test(message)) {
    return `دسترسی به شیت رد شد (403). شیت را با ایمیل «${process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL}» با نقش Editor به اشتراک بگذارید.`;
  }
  if (status === 404 || code === 404 || /NOT_FOUND/i.test(message)) {
    return `گوگل‌شیت با شناسهٔ «${process.env.GOOGLE_SHEET_ID}» پیدا نشد (404). شناسه بخشی از لینک شیت بین /d/ و /edit است.`;
  }
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|network|socket/i.test(message)) {
    return `اتصال شبکه به گوگل برقرار نشد (${message}). اگر روی Railway یا سرور داخلی هستید، دسترسی خروجی به googleapis.com را چک کنید.`;
  }
  return message;
}

export function getDoc({ force = false } = {}) {
  if (force || !docPromise) {
    docPromise = createDoc().catch((err) => {
      docPromise = null;
      const detail = err?.response?.data?.error;
      const message = detail?.message || err.message;
      console.error("❌ اتصال به Google Sheets ناموفق بود:", message);
      throw err;
    });
  }
  return docPromise;
}

async function getTab(title, { reload = false } = {}) {
  const doc = await getDoc({ force: reload });
  let sheet = doc.sheetsByTitle[title];
  if (!sheet && !reload) {
    return getTab(title, { reload: true });
  }
  if (!sheet) {
    const available = Object.keys(doc.sheetsByTitle).join("، ");
    throw new Error(`تب «${title}» در گوگل‌شیت پیدا نشد. تب‌های موجود: ${available || "(هیچ)"}`);
  }
  // رفع باگ: بدون این فراخوانی صریح، sheet.headerValues برای خواندن هدر کافی است
  // اما خود کتابخانه هنوز هدر را "لود‌شده" نمی‌داند و addRow با خطای
  // "Header values are not yet loaded" شکست می‌خورد.
  await sheet.loadHeaderRow();
  return sheet;
}

export function resolveHeaders(headerValues, mapping) {
  const headers = (headerValues || []).filter(Boolean).map((raw) => ({ raw, norm: normalizeHeader(raw) }));
  const claimed = new Set();
  const resolved = {};

  for (const pass of ["exact", "contains"]) {
    for (const [key, aliases] of Object.entries(mapping)) {
      if (resolved[key]) continue;
      for (const alias of aliases) {
        const a = normalizeHeader(alias);
        if (!a) continue;
        const hit = headers.find((h) => {
          if (claimed.has(h.raw) || !h.norm) return false;
          return pass === "exact" ? h.norm === a : h.norm.includes(a) || a.includes(h.norm);
        });
        if (hit) {
          resolved[key] = hit.raw;
          claimed.add(hit.raw);
          break;
        }
      }
    }
  }

  return { resolved, missing: Object.keys(mapping).filter((k) => !resolved[k]) };
}

const TRUE_WORDS = ["بله", "بلی", "آره", "اره", "فعال", "yes", "y", "true", "1", "✓", "✔"];
const FALSE_WORDS = ["نه", "خیر", "غیرفعال", "غیر فعال", "no", "n", "false", "0", "✗", "✘"];

function parseActive(value) {
  const text = normalizeForMatch(value);
  if (!text) return true;
  if (TRUE_WORDS.some((w) => text === normalizeForMatch(w))) return true;
  if (FALSE_WORDS.some((w) => text === normalizeForMatch(w))) return false;
  if (typeof value === "boolean") return value;
  return true;
}

function persianDateTime(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-u-ca-persian", {
    timeZone: "Asia/Tehran",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const get = (type) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}/${get("month")}/${get("day")} ${get("hour")}:${get("minute")}`;
}

function gregorianDateTime(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tehran",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

export async function getActiveProjects({ force = false } = {}) {
  const now = Date.now();
  if (!force && projectsCache && now - projectsCacheTime < CACHE_TTL_MS) return projectsCache;

  const sheet = await getTab(PROJECTS_TAB);
  const rows = await sheet.getRows();
  const headerValues = sheet.headerValues;
  const { resolved, missing } = resolveHeaders(headerValues, PROJECT_HEADERS);

  if (!resolved.name) {
    throw new Error(
      `ستون «نام پروژه» در تب «${PROJECTS_TAB}» پیدا نشد. هدرهای موجود: ${headerValues.filter(Boolean).join(" | ") || "(خالی)"}`
    );
  }
  if (missing.length) {
    console.warn(`⚠️ در تب «${PROJECTS_TAB}» این ستون‌ها پیدا نشد: ${missing.join("، ")} — هدرهای موجود: ${headerValues.filter(Boolean).join(" | ")}`);
  }

  const projects = [];
  for (const row of rows) {
    const name = String(row.get(resolved.name) ?? "").trim();
    if (!name) continue;

    const warnings = [];
    const fieldsRaw = resolved.fields ? row.get(resolved.fields) : "";
    const fields = splitList(fieldsRaw);
    if (fields.length === 0) warnings.push("ستون «فیلدهای موردنیاز» خالی است");

    const priceRaw = resolved.pricePerMeter ? row.get(resolved.pricePerMeter) : "";
    const pricePerMeter = parseNumber(priceRaw);
    if (String(priceRaw ?? "").trim() && pricePerMeter === null) {
      warnings.push(`مقدار قیمت پایه قابل خواندن نیست: «${priceRaw}»`);
    }

    const activeRaw = resolved.active ? row.get(resolved.active) : "";
    const active = parseActive(activeRaw);
    if (resolved.active && !String(activeRaw ?? "").trim()) warnings.push("ستون «فعال؟» خالی است (فعال در نظر گرفته شد)");

    if (warnings.length) console.warn(`⚠️ پروژه «${name}» (ردیف ${row.rowNumber}): ${warnings.join("؛ ")}`);

    if (!active) continue;

    projects.push({
      name,
      fields,
      pricePerMeter,
      notes: resolved.notes ? String(row.get(resolved.notes) ?? "").trim() : "",
      active: true,
      rowNumber: row.rowNumber,
      warnings,
    });
  }

  projectsCache = projects;
  projectsCacheTime = Date.now();
  return projects;
}

export function invalidateProjectsCache() {
  projectsCache = null;
  projectsCacheTime = 0;
}

export async function findProject(input) {
  const projects = await getActiveProjects();
  return matchProject(projects, input);
}

async function getLeadsSheet() {
  const sheet = await getTab(LEADS_TAB);
  const headerValues = sheet.headerValues;
  const { resolved, missing } = resolveHeaders(headerValues, LEAD_HEADERS);
  const missingRequired = REQUIRED_LEAD_HEADERS.filter((k) => missing.includes(k));
  if (missingRequired.length) {
    throw new Error(
      `در تب «${LEADS_TAB}» ستون‌های ضروری ${missingRequired.join("، ")} پیدا نشد. هدرهای موجود: ${headerValues.filter(Boolean).join(" | ") || "(خالی)"}`
    );
  }
  if (missing.length) console.warn(`⚠️ در تب «${LEADS_TAB}» این ستون‌ها پیدا نشد و خالی می‌مانند: ${missing.join("، ")}`);
  leadsHeaderCache = { sheet, resolved };
  return { sheet, resolved };
}

function buildLeadRow(resolved, lead) {
  const now = new Date();
  const values = {};
  const set = (key, value) => {
    const header = resolved[key];
    if (header && value !== undefined && value !== null) values[header] = value;
  };

  set("date", persianDateTime(now));
  set("jalaliDate", gregorianDateTime(now));
  set("customerName", lead.customerName || "");
  set("phone", String(lead.phone || "").replace(/[^\d+]/g, ""));
  set("projectName", lead.projectName || "");
  set("fileInfo", lead.fileInfo || "");
  set("estimatedPrice", parseNumber(lead.estimatedPrice) ?? "");
  set("source", lead.source || "");

  return values;
}

export async function addLead(lead) {
  const { sheet, resolved } = await getLeadsSheet();
  const values = buildLeadRow(resolved, lead);
  const row = await sheet.addRow(values);
  return { rowNumber: row.rowNumber };
}

export async function updateLead(rowNumber, patch) {
  if (!rowNumber) throw new Error("شماره ردیف لید برای به‌روزرسانی موجود نیست.");
  const { sheet, resolved } = leadsHeaderCache ?? (await getLeadsSheet());
  const offset = Math.max(0, rowNumber - 2);
  const rows = await sheet.getRows({ offset, limit: 1 });
  const row = rows[0];
  if (!row || row.rowNumber !== rowNumber) {
    throw new Error(`ردیف ${rowNumber} در تب «${LEADS_TAB}» پیدا نشد (احتمالاً ردیف‌ها جابه‌جا شده‌اند).`);
  }
  const values = buildLeadRow(resolved, patch);
  row.assign(values);
  await row.save();
  return { rowNumber };
}

export async function describeSheets() {
  const doc = await getDoc({ force: true });
  const report = { tabs: Object.keys(doc.sheetsByTitle), projects: null, leads: null };

  try {
    const projectsSheet = await getTab(PROJECTS_TAB);
    const { resolved, missing } = resolveHeaders(projectsSheet.headerValues, PROJECT_HEADERS);
    report.projects = { tab: PROJECTS_TAB, headers: projectsSheet.headerValues.filter(Boolean), resolved, missing };
  } catch (err) {
    report.projects = { tab: PROJECTS_TAB, error: err.message };
  }

  try {
    const leadsSheet = await getTab(LEADS_TAB);
    const { resolved, missing } = resolveHeaders(leadsSheet.headerValues, LEAD_HEADERS);
    report.leads = {
      tab: LEADS_TAB,
      headers: leadsSheet.headerValues.filter(Boolean),
      resolved,
      missing,
      missingRequired: REQUIRED_LEAD_HEADERS.filter((k) => missing.includes(k)),
    };
  } catch (err) {
    report.leads = { tab: LEADS_TAB, error: err.message };
  }

  return report;
}
