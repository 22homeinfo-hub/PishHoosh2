// بی‌صدا کردن لاگ‌های خود برنامه در تست‌ها
//
// چرا لازم است؟ فایل‌های تست با node:test به‌صورت «پروسهٔ فرزند» اجرا می‌شوند و
// گزارش تست‌ها روی همان جریان خروجی به والد می‌رسد. وقتی برنامه وسط تست‌ها
// console.log زیادی می‌نویسد (ثبت لید، شروع تخمین، هشدار پروژه‌ها…)، گاهی این
// نوشته‌ها با پیام‌های گزارش‌دهی درهم می‌افتند و والد با خطای
// «Unable to deserialize cloned data due to invalid or unsupported version»
// کل فایل تست را شکست‌خورده اعلام می‌کند - بدون اینکه هیچ assertion واقعی شکسته باشد.
//
// این هلپر فقط log/warn/error برنامه را در طول تست‌ها خاموش می‌کند؛ خطاهای خودِ
// تست (assertion) و خروجی TAP دست‌نخورده می‌مانند.
const STREAMS = ["log", "warn", "error", "info", "debug"];

export function silenceAppLogs() {
  const original = {};
  for (const name of STREAMS) {
    original[name] = console[name];
    console[name] = () => {};
  }
  return function restore() {
    for (const name of STREAMS) console[name] = original[name];
  };
}
