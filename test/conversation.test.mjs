import test from "node:test";
import assert from "node:assert/strict";

// محیط تست: کلید ساختگی تا ماژول AI مقداردهی اولیه شود
process.env.GEMINI_API_KEY = "TEST-KEY-FOR-SUITE";

const { installGeminiStub } = await import("./gemini-stub.mjs");
const gemini = installGeminiStub();
const sheets = await import("./mock-sheets.mjs");
const { handleUserMessage, startOver, getWelcomeMessage } = await import("../src/conversation.js");

let uid = 0;
const newKey = () => `telegram:test-${++uid}`;

async function startChatWith(text = "1") {
  const key = newKey();
  const greeting = await handleUserMessage(key, text, "تلگرام");
  return { key, greeting };
}

test.beforeEach(() => {
  gemini.reset();
  sheets.__reset();
});

test("پیام خوش‌آمد: لیست شماره‌دار و بدون undefined", async () => {
  const welcome = await getWelcomeMessage();
  assert.match(welcome.message, /1\. پارسیان ۱/);
  assert.match(welcome.message, /2\. ساختمان نگین/);
  assert.ok(!welcome.message.includes("undefined"));
  assert.equal(welcome.projects.length, 3);
});

test("انتخاب پروژه با شمارهٔ لیست کار می‌کند (بدون مصرف سهمیهٔ API)", async () => {
  const { greeting } = await startChatWith("1");
  assert.match(greeting.message, /متراژ/);
  assert.ok(!greeting.message.includes("undefined"));
  assert.equal(gemini.requests.length, 0);
  assert.equal(greeting.removeKeyboard, true);
});

test("نام پروژه با «ی» عربی و نیم‌فاصله هم پیدا می‌شود", async () => {
  const a = await startChatWith("پارسـيان 1");
  assert.match(a.greeting.message, /پارسیان ۱/);
  const b = await startChatWith("ساختمان‌نگین");
  assert.match(b.greeting.message, /ساختمان نگین/);
});

test("payload ارسالی به Gemini درست است", async () => {
  const { key } = await startChatWith("1");
  await handleUserMessage(key, "۱۲۰ متر", "تلگرام");

  assert.equal(gemini.requests.length, 1);
  const raw = JSON.stringify(gemini.requests[0].body);
  assert.match(gemini.requests[0].url, /models\/[^/]+:generateContent/);

  // systemInstruction واقعی به‌جای جا زدن prompt در نقش کاربر
  assert.ok(/system[_]?[iI]nstruction/.test(raw), "systemInstruction ارسال نشده");
  assert.match(raw, /پیش‌هوش/);

  // temperature در gemini-3.6-flash نادیده گرفته می‌شود؛ نباید ارسال شود
  const config = gemini.requests[0].body.generationConfig ?? gemini.requests[0].body.generation_config;
  assert.equal(config?.temperature, undefined);
  assert.equal(config?.responseMimeType ?? config?.response_mime_type, "application/json");
  assert.ok(config?.thinkingConfig?.thinkingLevel ?? config?.thinking_config?.thinkingLevel);

  // آخرین turn باید کاربر باشد (prefill شدن turn مدل در Gemini 3.6+ خطای 400 می‌دهد)
  const contents = gemini.requests[0].body.contents;
  assert.equal(contents.at(-1).role, "user");

  // تاریخچه نباید آلوده به پیام‌های متا (COMPLETE / JSON) باشد
  const allTexts = contents.flatMap((c) => c.parts.map((p) => p.text ?? "")).join("\n");
  assert.ok(!allTexts.includes("فقط با یک کلمه جواب بده"));
  assert.ok(!allTexts.includes("COMPLETE"));
});

test("برای هر پیام کاربر فقط یک درخواست به Gemini می‌رود (قبلاً سه تا بود)", async () => {
  const { key } = await startChatWith("1");
  const before = gemini.requests.length;
  await handleUserMessage(key, "۱۲۰ متر", "تلگرام");
  await handleUserMessage(key, "طبقه ۵", "تلگرام");
  await handleUserMessage(key, "ساخت ۱۴۰۲", "تلگرام");
  await handleUserMessage(key, "علی رضایی هستم", "تلگرام");
  assert.equal(gemini.requests.length - before, 4);
});

test("پایان مکالمه: لید با نام، شماره و قیمت ثبت می‌شود", async () => {
  gemini.doneAfter = 3;
  const { key } = await startChatWith("1");
  await handleUserMessage(key, "۱۲۰ متر", "تلگرام");
  await handleUserMessage(key, "طبقه ۵", "تلگرام");
  const result = await handleUserMessage(key, "علی رضایی ۰۹۱۲۱۲۳۴۵۶۷", "تلگرام");

  assert.equal(sheets.state.leads.length, 1);
  const lead = sheets.state.leads[0];
  assert.equal(lead.customerName, "علی رضایی");
  assert.equal(lead.phone, "09121234567");
  assert.equal(lead.projectName, "پارسیان ۱");
  assert.equal(lead.fileInfo, "۱۲۰ متر، طبقه ۵، ساخت ۱۴۰۲");
  assert.equal(lead.estimatedPrice, 15960000000);
  assert.equal(lead.source, "تلگرام");
  assert.match(result.message, /ثبت شد/);
});

test("پیام کاربر بعد از پایان مکالمه دور ریخته نمی‌شود", async () => {
  gemini.doneAfter = 2;
  const { key } = await startChatWith("1");
  await handleUserMessage(key, "۱۲۰ متر", "تلگرام");
  await handleUserMessage(key, "طبقه ۵", "تلگرام");
  gemini.reset();

  const result = await handleUserMessage(key, "ممنون از راهنماییتون", "تلگرام");
  assert.equal(gemini.requests.length, 1, "پیام باید به AI برسد");
  assert.ok(!result.message.includes("پیدا نکردم"));
  assert.match(result.message, /سوال شمارهٔ|شروع مجدد/);
});

test("اصلاح شمارهٔ تماس، همان ردیف شیت را به‌روز می‌کند (نه ردیف تکراری)", async () => {
  gemini.doneAfter = 1;
  const { key } = await startChatWith("1");
  await handleUserMessage(key, "۱۲۰ متر", "تلگرام");
  assert.equal(sheets.state.leads.length, 1);

  gemini.lead.phone = "09129999999";
  const result = await handleUserMessage(key, "شماره‌ام اشتباه بود، ۰۹۱۲۹۹۹۹۹۹۹", "تلگرام");

  assert.equal(sheets.state.leads.length, 1, "نباید ردیف جدید اضافه شود");
  assert.equal(sheets.state.updates.length, 1);
  assert.equal(sheets.state.leads[0].phone, "09129999999");
  assert.match(result.message, /به‌روز شد/);
});

test("شکست ثبت در شیت: به کاربر دروغ «ثبت شد» نمی‌گوییم و قابل تلاش مجدد است", async () => {
  gemini.doneAfter = 2;
  sheets.state.failNextSave = true;
  const { key } = await startChatWith("1");
  await handleUserMessage(key, "۱۲۰ متر", "تلگرام");
  const failed = await handleUserMessage(key, "طبقه ۵", "تلگرام");

  assert.equal(sheets.state.leads.length, 0);
  assert.match(failed.message, /خطا/);
  assert.ok(!/با موفقیت ثبت شد/.test(failed.message));

  const retried = await handleUserMessage(key, "ثبت مجدد", "تلگرام");
  assert.equal(sheets.state.leads.length, 1);
  assert.match(retried.message, /ثبت شد/);
});

test("پاسخ خالی از Gemini به پیام خالی به کاربر ختم نمی‌شود", async () => {
  gemini.mode = "empty";
  const { key } = await startChatWith("1");
  const result = await handleUserMessage(key, "۱۲۰ متر", "تلگرام");
  assert.ok(result.message.trim().length > 5);
});

test("اگر مدل JSON ندهد، همان متن به کاربر نشان داده می‌شود", async () => {
  gemini.mode = "invalid-json";
  const { key } = await startChatWith("1");
  const result = await handleUserMessage(key, "۱۲۰ متر", "تلگرام");
  assert.match(result.message, /سوال شمارهٔ 1/);
});

test("پاسخ بلاک‌شدهٔ ایمنی پیام قابل‌فهم می‌دهد", async () => {
  gemini.mode = "blocked";
  const { key } = await startChatWith("1");
  const result = await handleUserMessage(key, "۱۲۰ متر", "تلگرام");
  assert.match(result.message, /پردازش نشد|جمله‌بندی/);
});

test("اتمام سهمیه (429) پیام کاربری مناسب می‌دهد", async () => {
  gemini.mode = "quota";
  const { key } = await startChatWith("1");
  const result = await handleUserMessage(key, "۱۲۰ متر", "تلگرام");
  assert.match(result.message, /شلوغ|دقیقه|دوباره/);
});

test("پروژهٔ بدون فیلد: پیام واضح به‌جای «undefined رو بگید؟»", async () => {
  const result = await handleUserMessage(newKey(), "3", "تلگرام");
  assert.ok(!result.message.includes("undefined"));
  assert.match(result.message, /فیلد|پشتیبانی|دفتر دیار/);
  assert.equal(gemini.requests.length, 0);
});

test("پروژهٔ ناشناخته: لیست دوباره نمایش داده می‌شود و کیبورد پیشنهاد می‌شود", async () => {
  const result = await handleUserMessage(newKey(), "پروژه‌ای که اصلا وجود ندارد", "تلگرام");
  assert.match(result.message, /پیدا نکردم/);
  assert.ok(Array.isArray(result.keyboard) && result.keyboard.length === 3);
});

test("«شروع مجدد» نشست را صفر می‌کند", async () => {
  const { key } = await startChatWith("1");
  const result = await handleUserMessage(key, "شروع مجدد", "تلگرام");
  assert.match(result.message, /خوش اومدید/);
  assert.equal(result.keyboard.length, 3);

  const restarted = await startOver(key);
  assert.match(restarted.message, /خوش اومدید/);
});

test("پیام‌های همزمان یک کاربر به‌هم نمی‌ریزند (قفل نشست)", async () => {
  gemini.doneAfter = 99;
  const { key } = await startChatWith("1");
  const results = await Promise.all([
    handleUserMessage(key, "۱۲۰ متر", "تلگرام"),
    handleUserMessage(key, "طبقه ۵", "تلگرام"),
    handleUserMessage(key, "ساخت ۱۴۰۲", "تلگرام"),
  ]);
  assert.equal(results.length, 3);
  for (const result of results) assert.ok(result.message.trim().length > 0);
  assert.equal(gemini.requests.length, 3);
  // ترتیب تاریخچه حفظ شده باشد
  const userTurns = gemini.requests.map((r) => r.body.contents.at(-1).parts[0].text);
  assert.deepEqual(userTurns, ["۱۲۰ متر", "طبقه ۵", "ساخت ۱۴۰۲"]);
});

test("ورودی نامعتبر کنترل می‌شود", async () => {
  const key = newKey();
  assert.match((await handleUserMessage(key, "   ", "تلگرام")).message, /بنویسید/);
  assert.match((await handleUserMessage(key, "x".repeat(5000), "تلگرام")).message, /بلند/);
});
