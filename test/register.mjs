// ثبت هوک جایگزینی ماژول برای تست‌ها (قبل از اجرای خود تست‌ها اجرا می‌شود)
import { register } from "node:module";

register("./hooks.mjs", import.meta.url);
