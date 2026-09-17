// هوک resolve برای پیش‌نمایش: وقتی conversation.js بخواهد sheets.js را وارد کند،
// نسخهٔ نمایشی (preview-sheets.mjs) جایگزین می‌شود. بقیهٔ ماژول‌ها دست‌نخورده می‌مانند.

export async function resolve(specifier, context, nextResolve) {
  const parent = context.parentURL || "";
  if (specifier.endsWith("sheets.js") && parent.endsWith("src/conversation.js")) {
    return {
      url: new URL("./preview-sheets.mjs", import.meta.url).href,
      shortCircuit: true,
      format: "module",
    };
  }
  return nextResolve(specifier, context);
}
