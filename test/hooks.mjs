// هوک resolve: فقط وقتی conversation.js بخواهد sheets.js را وارد کند،
// نسخهٔ ساختگی جایگزین می‌شود. این‌طور تست‌های مربوط به خود sheets.js
// (مثل resolveHeaders) همچنان ماژول واقعی را می‌گیرند.

export async function resolve(specifier, context, nextResolve) {
  const parent = context.parentURL || "";
  if (specifier.endsWith("sheets.js") && parent.endsWith("src/conversation.js")) {
    return {
      url: new URL("./mock-sheets.mjs", import.meta.url).href,
      shortCircuit: true,
      format: "module",
    };
  }
  return nextResolve(specifier, context);
}
