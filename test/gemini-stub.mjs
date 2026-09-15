// شبیه‌ساز Gemini: به‌جای شبکه، پاسخ ساخت‌یافتهٔ قابل کنترل برمی‌گرداند
// و همزمان همهٔ درخواست‌های ارسالی را ضبط می‌کند تا payload را بازرسی کنیم.

const DEFAULT_LEAD = {
  customerName: "علی رضایی",
  phone: "09121234567",
  fileInfo: "۱۲۰ متر، طبقه ۵، ساخت ۱۴۰۲",
  estimatedPrice: 15960000000,
};

export function installGeminiStub() {
  const realFetch = globalThis.fetch;
  const state = {
    realFetch,
    requests: [],
    turns: 0,
    mode: "normal", // normal | invalid-json | empty | quota | blocked
    doneAfter: 3,
    lead: { ...DEFAULT_LEAD },
  };
  state.reset = () => {
    state.requests = [];
    state.turns = 0;
    state.mode = "normal";
    state.doneAfter = 3;
    state.lead = { ...DEFAULT_LEAD };
  };

  globalThis.fetch = async (url, options = {}) => {
    const body = JSON.parse(options.body ?? "{}");
    state.requests.push({ url: String(url), body });

    const respond = (payload, status = 200) =>
      new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });

    if (state.mode === "quota") {
      return respond(
        { error: { code: 429, message: "You exceeded your current quota", status: "RESOURCE_EXHAUSTED" } },
        429
      );
    }
    if (state.mode === "blocked") {
      return respond({ promptFeedback: { blockReason: "SAFETY" }, candidates: [] });
    }

    state.turns += 1;
    const done = state.turns >= state.doneAfter;
    if (state.mode === "empty") {
      return respond({ candidates: [{ content: { role: "model", parts: [] }, finishReason: "STOP" }] });
    }

    const reply = done
      ? "قیمت تخمینی فایل شما حدود ۱۵ میلیارد و ۹۶۰ میلیون تومان است. لطفاً نام و شماره تماس‌تون رو بگید."
      : `سوال شمارهٔ ${state.turns}: لطفاً اطلاعات بعدی رو بگید.`;

    const text = state.mode === "invalid-json" ? reply : JSON.stringify({ reply, done, lead: done ? state.lead : null });

    return respond({
      candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 500, candidatesTokenCount: 60, totalTokenCount: 560 },
    });
  };

  return state;
}
