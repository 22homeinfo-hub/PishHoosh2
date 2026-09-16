// ثبت هوک جایگزینی ماژول برای «پیش‌نمایش مینی‌اپ» (بدون گوگل‌شیت واقعی)
import { register } from "node:module";

register("./hooks.mjs", import.meta.url);
