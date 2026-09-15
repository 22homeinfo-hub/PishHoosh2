import test from "node:test";
import assert from "node:assert/strict";
import { resolveHeaders } from "../src/sheets.js";

const PROJECT_MAPPING = {
  name: ["نام پروژه", "پروژه", "project name", "name"],
  fields: ["فیلدهای موردنیاز", "فیلدها", "سوالات", "fields"],
  pricePerMeter: ["قیمت پایه هر متر", "قیمت پایه", "قیمت هر متر", "price per meter"],
  notes: ["توضیحات کمکی برای ai", "توضیحات", "قوانین قیمت گذاری", "notes"],
  active: ["فعال", "وضعیت", "active"],
};

test("هدرهای دقیق و استاندارد", () => {
  const headers = ["نام پروژه", "فیلدهای موردنیاز (با کاما جدا کنید)", "قیمت پایه هر متر (تومان)", "توضیحات کمکی برای AI", "فعال؟"];
  const { resolved, missing } = resolveHeaders(headers, PROJECT_MAPPING);
  assert.deepEqual(missing, []);
  assert.equal(resolved.name, "نام پروژه");
  assert.equal(resolved.fields, "فیلدهای موردنیاز (با کاما جدا کنید)");
  assert.equal(resolved.pricePerMeter, "قیمت پایه هر متر (تومان)");
  assert.equal(resolved.active, "فعال؟");
});

test("هدرهای با نگارش متفاوت هم پیدا می‌شوند (بدون «؟»، بدون پرانتز، ی عربی)", () => {
  const headers = ["نام  پروژه", "فیلدها", "قیمت پایه", "توضیحات", "وضعیت"];
  const { resolved, missing } = resolveHeaders(headers, PROJECT_MAPPING);
  assert.deepEqual(missing, []);
  assert.equal(resolved.active, "وضعیت");
  assert.equal(resolved.pricePerMeter, "قیمت پایه");
});

test("هدر انگلیسی هم پشتیبانی می‌شود", () => {
  const headers = ["Project Name", "Fields", "Price Per Meter", "Notes", "Active"];
  const { resolved, missing } = resolveHeaders(headers, PROJECT_MAPPING);
  assert.deepEqual(missing, []);
  assert.equal(resolved.name, "Project Name");
});

test("ستون غایب در missing گزارش می‌شود (نه اینکه بی‌صدا رد شود)", () => {
  const headers = ["نام پروژه", "توضیحات"];
  const { resolved, missing } = resolveHeaders(headers, PROJECT_MAPPING);
  assert.equal(resolved.name, "نام پروژه");
  assert.ok(missing.includes("fields"));
  assert.ok(missing.includes("active"));
});

test("یک هدر به دو ستون مختلف اختصاص پیدا نمی‌کند", () => {
  const headers = ["نام پروژه", "فیلدهای موردنیاز"];
  const { resolved } = resolveHeaders(headers, PROJECT_MAPPING);
  const values = Object.values(resolved);
  assert.equal(new Set(values).size, values.length);
});
