import test from "node:test";
import assert from "node:assert/strict";
import { matchProject } from "../src/projects.js";

const PROJECTS = [
  { name: "پارسیان ۱" },
  { name: "ساختمان نگین" },
  { name: "برج آسمان تهران" },
];

test("انتخاب با شمارهٔ لیست (لاتین و فارسی)", () => {
  assert.equal(matchProject(PROJECTS, "1").name, "پارسیان ۱");
  assert.equal(matchProject(PROJECTS, "۲").name, "ساختمان نگین");
  assert.equal(matchProject(PROJECTS, "3.").name, "برج آسمان تهران");
  assert.equal(matchProject(PROJECTS, "گزینه 2").name, "ساختمان نگین");
  assert.equal(matchProject(PROJECTS, "پروژه ۳").name, "برج آسمان تهران");
});

test("شمارهٔ خارج از محدوده پروژه‌ای برنمی‌گرداند", () => {
  assert.equal(matchProject(PROJECTS, "9"), null);
  assert.equal(matchProject(PROJECTS, "0"), null);
});

test("تطبیق نام دقیق و جزئی", () => {
  assert.equal(matchProject(PROJECTS, "ساختمان نگین").name, "ساختمان نگین");
  assert.equal(matchProject(PROJECTS, "نگین").name, "ساختمان نگین");
  assert.equal(matchProject(PROJECTS, "می‌خوام در مورد ساختمان نگین بدونم").name, "ساختمان نگین");
});

test("تحمل اختلاف نگارش فارسی: ی/ي، ک/ك، نیم‌فاصله و ارقام", () => {
  assert.equal(matchProject(PROJECTS, "پارسـيان 1").name, "پارسیان ۱");
  assert.equal(matchProject(PROJECTS, "ساختمان‌نگین").name, "ساختمان نگین");
  assert.equal(matchProject(PROJECTS, "برج اسمان تهران").name, "برج آسمان تهران");
  assert.equal(matchProject(PROJECTS, "  پارسیان ۱  ").name, "پارسیان ۱");
});

test("ورودی بی‌ربط پروژه‌ای برنمی‌گرداند", () => {
  assert.equal(matchProject(PROJECTS, "سلام وقت بخیر"), null);
  assert.equal(matchProject(PROJECTS, ""), null);
  assert.equal(matchProject([], "1"), null);
});

test("allowChoice=false شمارهٔ خالی را انتخاب پروژه تفسیر نمی‌کند", () => {
  // برای سوییچ پروژه وسط مکالمه: جواب عددی کاربر به سوال ربات («۲») نباید
  // اشتباهاً پروژهٔ دوم را برگرداند
  assert.equal(matchProject(PROJECTS, "2").name, PROJECTS[1].name);
  assert.equal(matchProject(PROJECTS, "2", { allowChoice: false }), null);
  assert.equal(matchProject(PROJECTS, "گزینه 3", { allowChoice: false }), null);
  // ولی تطبیق نامی سر جایش است
  assert.equal(matchProject(PROJECTS, "نگین", { allowChoice: false }).name, "ساختمان نگین");
});
