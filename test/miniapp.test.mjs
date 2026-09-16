// تست‌های مینی‌اپ تلگرام:
// ۱) راستی‌آزمایی initData (واحدِ خالص، بدون شبکه)
// ۲) مسیرهای جدید API (/app, /api/projects, /api/state, /api/select, /api/contact)
// ۳) جریان کامل تخمین قیمت از مینی‌اپ تا ثبت لید در شیت
//
// نکته: initData واقعی را خودِ تلگرام می‌سازد؛ اینجا با همان الگوریتم مستندات
// (HMAC-SHA256 با کلید «WebAppData») یک رشتهٔ معتبر می‌سازیم تا کد سرور را بسنجیم.

import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { once } from "node:events";

const BOT_TOKEN = "123456789:TEST-TOKEN-FOR-MINIAPP-SUITE";

process.env.GEMINI_API_KEY = "TEST-KEY-FOR-SUITE";
process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
process.env.CORS_ORIGIN = "https://diyar.example";
// تا تست‌ها به سقف نرخ نخورند
process.env.RATE_LIMIT_PER_MINUTE = "500";
process.env.RATE_LIMIT_IP_PER_MINUTE = "2000";

const { installGeminiStub } = await import("./gemini-stub.mjs");
const gemini = installGeminiStub();
const sheets = await import("./mock-sheets.mjs");
const { verifyInitData, miniAppContact } = await import("../src/miniapp.js");
const { createWebApp } = await import("../src/webApi.js");
const sessions = await import("../src/sessions.js");
const { silenceAppLogs } = await import("./quiet.mjs");

const fetchReal = gemini.realFetch.bind(globalThis);
let server;
let base;

// ساخت initData معتبر دقیقاً طبق الگوریتم تلگرام
function buildInitData({ userId, firstName = "علی", lastName = "رضایی", username, authDate, tamper = false, startParam }) {
  const at = authDate ?? Math.floor(Date.now() / 1000);
  const user = { id: userId, first_name: firstName, last_name: lastName, language_code: "fa" };
  if (username) user.username = username;

  const params = new URLSearchParams();
  params.set("user", JSON.stringify(user));
  params.set("auth_date", String(at));
  if (startParam) params.set("start_param", startParam);

  const checkString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  let hash = crypto.createHmac("sha256", secret).update(checkString).digest("hex");
  if (tamper) hash = hash.replace(/^./, hash[0] === "0" ? "1" : "0");
  params.set("hash", hash);

  return params.toString();
}

let restoreLogs = () => {};

test.before(async () => {
  restoreLogs = silenceAppLogs();
  const app = createWebApp();
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  restoreLogs();
});

test.beforeEach(() => {
  gemini.reset();
  sheets.__reset();
});

// ── ۱) راستی‌آزمایی initData ─────────────────────────────
test("verifyInitData: رشتهٔ معتبر پذیرفته می‌شود و کاربر را برمی‌گرداند", () => {
  const initData = buildInitData({ userId: 4242 });
  const result = verifyInitData(initData, { botToken: BOT_TOKEN });
  assert.equal(result.ok, true);
  assert.equal(result.user.id, 4242);
  assert.equal(result.user.first_name, "علی");
});

test("verifyInitData: hash دست‌کاری‌شده رد می‌شود", () => {
  const initData = buildInitData({ userId: 4242, tamper: true });
  assert.equal(verifyInitData(initData, { botToken: BOT_TOKEN }).ok, false);
  assert.equal(verifyInitData(initData, { botToken: BOT_TOKEN }).reason, "bad-hash");
});

test("verifyInitData: توکن باتِ اشتباه هم رد می‌شود", () => {
  const initData = buildInitData({ userId: 4242 });
  const result = verifyInitData(initData, { botToken: "999:WRONG" });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "bad-hash");
});

test("verifyInitData: نشست منقضی و ورودی‌های پوچ رد می‌شوند", () => {
  const old = buildInitData({ userId: 1, authDate: Math.floor(Date.now() / 1000) - 90000 });
  assert.equal(verifyInitData(old, { botToken: BOT_TOKEN, maxAgeSeconds: 3600 }).reason, "expired");

  assert.equal(verifyInitData("", { botToken: BOT_TOKEN }).reason, "empty");
  assert.equal(verifyInitData("user=%7B%7D", { botToken: BOT_TOKEN }).reason, "no-hash");
  assert.equal(verifyInitData(buildInitData({ userId: 1 }), { botToken: "" }).reason, "no-bot-token");

  const future = buildInitData({ userId: 1, authDate: Math.floor(Date.now() / 1000) + 7200 });
  assert.equal(verifyInitData(future, { botToken: BOT_TOKEN }).reason, "future-auth-date");
});

test("miniAppContact: نام از پروفایل تلگرام ساخته می‌شود", () => {
  assert.deepEqual(miniAppContact({ first_name: "مریم", last_name: "احمدی" }), { customerName: "مریم احمدی" });
  assert.deepEqual(miniAppContact({ first_name: "رضا" }), { customerName: "رضا" });
  assert.deepEqual(miniAppContact({}), {});
});

// ── ۲) صفحه و لیست پروژه‌ها ──────────────────────────────
test("GET /app صفحهٔ مینی‌اپ را برمی‌گرداند", async () => {
  const res = await fetchReal(`${base}/app`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") || "", /text\/html/);
  const html = await res.text();
  assert.match(html, /telegram-web-app\.js/);
  assert.match(html, /پروژه‌ها/);
  assert.match(html, /api\/state/);

  const alias = await fetchReal(`${base}/miniapp`);
  assert.equal(alias.status, 200);
});

test("GET /api/projects فقط نام و فیلدها را می‌دهد (نه قیمت پایه و فرمول)", async () => {
  const res = await fetchReal(`${base}/api/projects`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.projects.length, 3);
  assert.deepEqual(Object.keys(data.projects[0]).sort(), ["fields", "name"]);
  assert.deepEqual(data.projects[0].fields, ["متراژ", "طبقه", "سال ساخت"]);
  assert.equal(data.projects[0].pricePerMeter, undefined);
  assert.equal(data.projects[0].notes, undefined);
});

// ── ۳) وضعیت و اطلاعات تماس ──────────────────────────────
test("POST /api/state با initData: نام از تلگرام، شماره هنوز گرفته نشده", async () => {
  const res = await fetchReal(`${base}/api/state`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ initData: buildInitData({ userId: 1001 }) }),
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.miniApp, true);
  assert.equal(data.source, "مینی‌اپ تلگرام");
  assert.equal(data.state, "new");
  assert.equal(data.project, null);
  assert.equal(data.contact.customerName, "علی رضایی");
  assert.equal(data.contact.hasPhone, false);
  assert.equal(data.projects.length, 3);
});

test("POST /api/state با initData نامعتبر → 403", async () => {
  const res = await fetchReal(`${base}/api/state`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ initData: buildInitData({ userId: 1002, tamper: true }) }),
  });
  assert.equal(res.status, 403);
  const data = await res.json();
  assert.match(data.error, /تلگرام/);
});

test("POST /api/state بدون initData و بدون sessionId → 400", async () => {
  const res = await fetchReal(`${base}/api/state`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(res.status, 400);
});

test("POST /api/contact شماره را یکسان‌سازی و ذخیره می‌کند", async () => {
  const initData = buildInitData({ userId: 1003 });
  const post = (path, body) =>
    fetchReal(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ initData, ...body }),
    }).then(async (r) => ({ status: r.status, data: await r.json() }));

  const saved = await post("/api/contact", { customerName: "مریم احمدی", phone: "+98 912 000 11 22" });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.ok, true);
  assert.equal(saved.data.contact.hasPhone, true);
  assert.equal(saved.data.contact.customerName, "مریم احمدی");

  const after = await post("/api/state", {});
  assert.equal(after.data.contact.hasPhone, true, "بعد از ثبت، مینی‌اپ دیگر شماره نمی‌پرسد");
  assert.equal(after.data.contact.customerName, "مریم احمدی");

  const invalid = await post("/api/contact", { phone: "۱۲۳" });
  assert.equal(invalid.status, 400);
});

test("شمارهٔ به اشتراک گذاشته‌شده در چت بات، در مینی‌اپ هم شناخته می‌شود", async () => {
  // در چت خصوصی، شناسهٔ چت همان شناسهٔ کاربر است
  const botSession = sessions.getSession("telegram:1004");
  botSession.contact = { customerName: "حسن کریمی", phone: "09123334455" };

  const res = await fetchReal(`${base}/api/state`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ initData: buildInitData({ userId: 1004, firstName: "حسن", lastName: "کریمی" }) }),
  });
  const data = await res.json();
  assert.equal(data.contact.hasPhone, true, "نباید دوباره شماره بپرسد");
  assert.equal(data.contact.customerName, "حسن کریمی");
});

// ── ۴) جریان کامل تخمین قیمت از مینی‌اپ ──────────────────
test("کلیک روی پروژه → چت → اعلام تخمین و ثبت لید با منبع «مینی‌اپ تلگرام»", async () => {
  const initData = buildInitData({ userId: 2001 });
  gemini.doneAfter = 2;

  const post = async (path, body) => {
    const res = await fetchReal(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ initData, ...body }),
    });
    assert.equal(res.status, 200, `${path} باید 200 بدهد`);
    return res.json();
  };

  await post("/api/contact", { customerName: "علی رضایی", phone: "09121234567" });

  // انتخاب پروژه از لیست: بدون مصرف سهمیهٔ AI، سلام اولیه ساخته می‌شود
  const selected = await post("/api/select", { project: "پارسیان ۱" });
  assert.match(selected.message, /پارسیان ۱/);
  assert.match(selected.message, /متراژ/);
  assert.deepEqual(selected.project, { name: "پارسیان ۱", fields: ["متراژ", "طبقه", "سال ساخت"] });
  assert.equal(gemini.requests.length, 0, "شروع مکالمه نباید به Gemini درخواست بزند");

  await post("/api/message", { text: "۱۲۰ متر، طبقه ۵" });
  const done = await post("/api/message", { text: "ساخت ۱۴۰۲" });
  assert.match(done.message, /ثبت شد/);

  assert.equal(sheets.state.leads.length, 1);
  const lead = sheets.state.leads[0];
  assert.equal(lead.source, "مینی‌اپ تلگرام");
  assert.equal(lead.customerName, "علی رضایی");
  assert.equal(lead.phone, "09121234567");
  assert.equal(lead.projectName, "پارسیان ۱");
  assert.equal(lead.estimatedPrice, 15960000000);
});

test("انتخاب پروژه با نام جزئی و با شمارهٔ لیست هم کار می‌کند", async () => {
  const initData = buildInitData({ userId: 2002 });
  const post = async (body) => {
    const res = await fetchReal(`${base}/api/select`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ initData, ...body }),
    });
    return res.json();
  };

  assert.match((await post({ project: "نگین" })).message, /ساختمان نگین/);
  assert.match((await post({ project: "1" })).message, /پارسیان ۱/);
});

test("پروژهٔ ناموجود در فهرست → پیام واضح + لیست تازه", async () => {
  const res = await fetchReal(`${base}/api/select`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ initData: buildInitData({ userId: 2003 }), project: "برجی که وجود ندارد" }),
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.match(data.message, /پیدا نکردم/);
  assert.equal(data.projects.length, 3, "کلاینت باید بتواند لیست را دوباره بسازد");
  assert.equal(data.project, undefined);
});

test("/api/select بدون نام پروژه → 400", async () => {
  const res = await fetchReal(`${base}/api/select`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ initData: buildInitData({ userId: 2004 }) }),
  });
  assert.equal(res.status, 400);
});

test("نشست پایدار: با باز کردن دوبارهٔ مینی‌اپ، پروژهٔ نیمه‌تمام برمی‌گردد", async () => {
  const initData = buildInitData({ userId: 3001 });
  const post = (path, body) =>
    fetchReal(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ initData, ...body }),
    }).then((r) => r.json());

  await post("/api/select", { project: "ساختمان نگین" });

  // شبیه‌سازی باز کردن مجدد مینی‌اپ: همان initData، یک درخواست تازه
  const state = await post("/api/state", {});
  assert.deepEqual(state.project, { name: "ساختمان نگین", fields: ["متراژ", "تعداد اتاق"] });
  assert.equal(state.state, "chatting");

  // شروع مجدد، پروژهٔ جاری را پاک می‌کند
  const restarted = await post("/api/reset", {});
  assert.match(restarted.message, /خوش اومدید/);
  assert.equal(restarted.project, null);
  const after = await post("/api/state", {});
  assert.equal(after.project, null);
});

test("پاسخ /api/message پروژهٔ جاری را برمی‌گرداند (برای سربرگ چت مینی‌اپ)", async () => {
  const initData = buildInitData({ userId: 3002 });
  const post = (path, body) =>
    fetchReal(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ initData, ...body }),
    }).then((r) => r.json());

  await post("/api/select", { project: "پارسیان ۱" });
  const reply = await post("/api/message", { text: "۱۲۰ متر" });
  assert.deepEqual(reply.project, { name: "پارسیان ۱", fields: ["متراژ", "طبقه", "سال ساخت"] });
});

test("مینی‌اپ و لندینگ‌پیج دو نشست جدا دارند (تداخل نمی‌کنند)", async () => {
  const initData = buildInitData({ userId: 4001 });
  const mini = await fetchReal(`${base}/api/select`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ initData, project: "پارسیان ۱" }),
  }).then((r) => r.json());
  assert.match(mini.message, /پارسیان ۱/);

  const web = await fetchReal(`${base}/api/state`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: "landing-user-1" }),
  }).then((r) => r.json());
  assert.equal(web.miniApp, false);
  assert.equal(web.source, "لندینگ‌پیج");
  assert.equal(web.project, null, "کاربر لندینگ‌پیج نباید نشست مینی‌اپ را ببیند");
});
