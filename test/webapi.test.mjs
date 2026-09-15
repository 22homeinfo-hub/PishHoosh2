import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";

process.env.GEMINI_API_KEY = "TEST-KEY-FOR-SUITE";
process.env.CORS_ORIGIN = "https://diyar.example";

const { installGeminiStub } = await import("./gemini-stub.mjs");
const gemini = installGeminiStub();
const sheets = await import("./mock-sheets.mjs");
const { createWebApp } = await import("../src/webApi.js");

const fetchReal = gemini.realFetch.bind(globalThis);
let server;
let base;

test.before(async () => {
  const app = createWebApp();
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test.beforeEach(() => {
  gemini.reset();
  sheets.__reset();
});

test("GET /health", async () => {
  const res = await fetchReal(`${base}/health`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.status, "ok");
});

test("GET /api/welcome لیست پروژه‌ها را برای ویجت برمی‌گرداند", async () => {
  const res = await fetchReal(`${base}/api/welcome`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.match(data.message, /پارسیان ۱/);
  assert.equal(data.projects.length, 3);
  assert.deepEqual(Object.keys(data.projects[0]).sort(), ["fields", "name"]);
});

test("POST /api/message بدون فیلد اجباری → 400", async () => {
  const res = await fetchReal(`${base}/api/message`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: "سلام" }),
  });
  assert.equal(res.status, 400);
});

test("POST /api/message با بدنهٔ غیر JSON → 400", async () => {
  const res = await fetchReal(`${base}/api/message`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{not json",
  });
  assert.equal(res.status, 400);
});

test("جریان کامل مکالمه از طریق API وب", async () => {
  const sessionId = "web-test-1";
  gemini.doneAfter = 2;

  const send = async (text) => {
    const res = await fetchReal(`${base}/api/message`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId, text }),
    });
    assert.equal(res.status, 200);
    return res.json();
  };

  const first = await send("2");
  assert.match(first.message, /ساختمان نگین/);

  await send("۹۰ متر");
  const last = await send("مریم احمدی ۰۹۱۲۰۰۰۰۰۰۰");
  assert.equal(sheets.state.leads.length, 1);
  assert.equal(sheets.state.leads[0].source, "لندینگ‌پیج");
  assert.match(last.message, /ثبت شد/);
});

test("POST /api/reset مکالمه را از اول شروع می‌کند", async () => {
  const res = await fetchReal(`${base}/api/reset`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: "web-test-1" }),
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.match(data.message, /خوش اومدید/);
  assert.equal(data.projects.length, 3);
});

test("مسیر ناشناخته → 404", async () => {
  const res = await fetchReal(`${base}/api/nothing`);
  assert.equal(res.status, 404);
});

test("محدودسازی نرخ: درخواست‌های پشت‌سرهم یک نشست → 429", async () => {
  const sessionId = "rate-limit-test";
  let limited = false;
  for (let i = 0; i < 20; i++) {
    const res = await fetchReal(`${base}/api/message`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId, text: "سلام" }),
    });
    if (res.status === 429) {
      limited = true;
      const data = await res.json();
      assert.ok(data.error);
      break;
    }
    assert.equal(res.status, 200);
  }
  assert.ok(limited, "باید بعد از عبور از سقف، 429 برگرداند");
});
