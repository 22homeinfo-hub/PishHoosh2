// منطق مشترک مکالمه - هم برای تلگرام و هم برای لندینگ‌پیج
// این‌طور منطق یک بار نوشته می‌شود و هر تغییر هر دو کانال را پوشش می‌دهد.
//
// خروجی همه توابع یک آبجکت است:
//   { message, projects?, keyboard?, removeKeyboard? }
// - message: متنی که به کاربر نشان داده می‌شود
// - projects: لیست پروژه‌ها (برای ویجت وب و دکمه‌های تلگرام)
// - keyboard / removeKeyboard: راهنمای لایه تلگرام برای ساخت کیبورد
//
// وضعیت‌های نشست:
//   choosing_project → کاربر هنوز پروژه را انتخاب نکرده
//   chatting         → در حال جمع‌آوری اطلاعات
//   followup         → قیمت اعلام و لید ثبت شده، اما کاربر می‌تواند اصلاحیه بدهد

import { getActiveProjects, findProject, addLead, updateLead } from "./sheets.js";
import { startConversation, sendTurn, AiError } from "./ai.js";
import { getSession, resetSession, withSessionLock } from "./sessions.js";
import { isRestartCommand, chunkText, formatToman } from "./text.js";
import { notifyAdmin } from "./notify.js";

const NO_PROJECT_MESSAGE =
  "در حال حاضر پروژه فعالی تعریف نشده 😔\nلطفاً چند دقیقه دیگر دوباره امتحان کنید یا با دفتر دیار تماس بگیرید.";

const SAVE_FAILED_MESSAGE =
  "⚠️ متاسفانه ثبت اطلاعات در سیستم با خطا مواجه شد.\nلطفاً کمی دیگر «ثبت مجدد» را بفرستید تا دوباره تلاش کنم.";

const RETRY_SAVED_MESSAGE = "✅ اطلاعاتتون با موفقیت ثبت شد. کارشناسان دفتر دیار به‌زودی باهاتون تماس می‌گیرن.";

const FOLLOWUP_HINT =
  "\n\nاگه می‌خواید اطلاعات رو اصلاح کنید همین‌جا بنویسید، و برای ثبت فایل جدید «شروع مجدد» را بفرستید.";

function projectListText(projects) {
  return projects.map((p, i) => `${i + 1}. ${p.name}`).join("\n");
}

function welcomeText(projects) {
  return `سلام و وقت بخیر 🌷 به ربات دفتر املاک دیار خوش اومدید!\n\nبرای ثبت اطلاعات فایلتون، شماره یا اسم پروژه رو بفرستید:\n\n${projectListText(
    projects
  )}`;
}

export async function getWelcomeMessage() {
  const projects = await getActiveProjects();
  if (!projects.length) return { message: NO_PROJECT_MESSAGE, projects: [] };
  return { message: welcomeText(projects), projects };
}

// صورت‌جلسهٔ مکالمه برای ارسال به مدیر وقتی ثبت لید شکست می‌خورد
function transcriptFromSession(session) {
  try {
    const history = session.chat?.getHistory?.() ?? [];
    return history
      .map((item) => {
        const text = (item.parts ?? []).map((p) => p?.text ?? "").join(" ");
        const clean = text.replace(/\s+/g, " ").trim();
        if (!clean) return "";
        // اگر خروجی ساخت‌یافته بود، فقط بخش reply را نگه دار
        try {
          const parsed = JSON.parse(clean);
          if (parsed?.reply) return `${item.role === "user" ? "کاربر" : "ربات"}: ${parsed.reply}`;
        } catch {
          /* خروجی ساده است */
        }
        return `${item.role === "user" ? "کاربر" : "ربات"}: ${clean.slice(0, 400)}`;
      })
      .filter(Boolean)
      .join("\n");
  } catch {
    return "";
  }
}

async function saveLead(session, lead, source) {
  const data = {
    customerName: lead?.customerName || "",
    phone: lead?.phone || "",
    projectName: session.project?.name || "",
    fileInfo: lead?.fileInfo || "",
    estimatedPrice: lead?.estimatedPrice ?? "",
    source,
  };

  const missing = [];
  if (!data.customerName) missing.push("نام");
  if (!data.phone) missing.push("شماره تماس");

  try {
    const { rowNumber } = await addLead(data);
    session.leadRowNumber = rowNumber;
    session.savedLead = data;
    session.pendingLead = null;
    console.log(
      `✅ لید ثبت شد | پروژه: ${data.projectName} | نام: ${data.customerName || "(خالی)"} | ردیف: ${rowNumber} | منبع: ${source}`
    );

    const priceText = data.estimatedPrice ? ` | قیمت تخمینی: ${formatToman(data.estimatedPrice)}` : "";
    console.log(`   ${data.fileInfo || "(بدون اطلاعات فایل)"}${priceText}`);

    if (missing.length) {
      return {
        ok: true,
        notice: `اطلاعاتتون ثبت شد ✅ فقط ${missing.join(
          " و "
        )} رو نگرفته بودم؛ همین‌جا بنویسید تا در پرونده‌تون اصلاحش کنم.`,
      };
    }
    return { ok: true, notice: RETRY_SAVED_MESSAGE };
  } catch (err) {
    session.pendingLead = data;
    console.error("❌ ثبت لید در گوگل‌شیت ناموفق بود:", err.message);
    const transcript = transcriptFromSession(session);
    notifyAdmin(
      `🚨 ثبت لید در شیت ناموفق بود\nپروژه: ${data.projectName}\nنام: ${data.customerName || "-"}\nتماس: ${
        data.phone || "-"
      }\nخطا: ${err.message}\n\n${transcript ? `--- صورت‌جلسه ---\n${transcript.slice(0, 3000)}` : ""}`
    );
    return { ok: false, notice: SAVE_FAILED_MESSAGE };
  }
}

async function chooseProject(text, session) {
  const projects = await getActiveProjects();
  if (!projects.length) return { message: NO_PROJECT_MESSAGE, projects: [] };

  const project = await findProject(text);
  if (!project) {
    return {
      message: `متاسفانه «${chunkText(text, 80)[0]}» رو بین پروژه‌ها پیدا نکردم 🙏\n\nمی‌تونید شمارهٔ پروژه یا اسم کاملش رو بفرستید:\n\n${projectListText(
        projects
      )}`,
      projects,
      keyboard: projects.map((p) => p.name),
    };
  }

  try {
    const { chat, greeting } = startConversation(project);
    session.project = project;
    session.chat = chat;
    session.state = "chatting";
    session.leadRowNumber = null;
    session.savedLead = null;
    if (project.warnings?.length) console.warn(`⚠️ پروژه «${project.name}» با هشدار بارگذاری شد: ${project.warnings.join("؛ ")}`);
    return { message: greeting, removeKeyboard: true };
  } catch (err) {
    // معمولاً یعنی ستون «فیلدهای موردنیاز» برای این پروژه خالی است
    const userMessage = err instanceof AiError ? err.userMessage : "برای این پروژه خطایی پیش اومد. لطفاً پروژهٔ دیگری را انتخاب کنید.";
    console.error(`❌ شروع مکالمه برای پروژه «${project.name}» ناموفق بود:`, err.message);
    notifyAdmin(`🚨 پروژه «${project.name}» قابل شروع نیست: ${err.message}`);
    const others = projects.filter((p) => p.name !== project.name);
    return {
      message: `${userMessage}\n\n${others.length ? `پروژه‌های در دسترس:\n${projectListText(others)}` : ""}`,
      projects: others,
      keyboard: others.map((p) => p.name),
    };
  }
}

async function continueChat(session, text, source) {
  if (!session.chat) {
    session.state = "choosing_project";
    return chooseProject(text, session);
  }

  const turn = await sendTurn(session.chat, text);

  if (!turn.done) return { message: turn.reply };

  const saved = await saveLead(session, turn.lead, source);
  session.state = "followup";
  if (!saved.ok) {
    // عمداً وضعیت را followup نگه می‌داریم تا کاربر بتواند «ثبت مجدد» بفرستد
    return { message: `${turn.reply}\n\n${saved.notice}` };
  }
  return { message: `${turn.reply}\n\n${saved.notice}${FOLLOWUP_HINT}` };
}

async function handleFollowup(session, text, source) {
  // اگر نشست پاک شده باشد (مثلاً بعد از عمر ۲ ساعته)، کاربر را به اول مسیر برمی‌گردانیم
  if (!session.chat) {
    session.state = "choosing_project";
    return chooseProject(text, session);
  }

  if (session.pendingLead && /^(ثبت مجدد|ثبت دوباره|retry|ذخیره مجدد)$/i.test(text.trim())) {
    const saved = await saveLead(session, session.pendingLead, source);
    return { message: saved.ok ? RETRY_SAVED_MESSAGE + FOLLOWUP_HINT : saved.notice };
  }

  const turn = await sendTurn(session.chat, text);

  // اگر کاربر نام یا شماره‌اش را اصلاح کرد، همان ردیف شیت به‌روز می‌شود (نه یک ردیف تکراری)
  if (turn.lead && session.leadRowNumber && session.savedLead) {
    const nameChanged = turn.lead.customerName && turn.lead.customerName !== session.savedLead.customerName;
    const phoneChanged = turn.lead.phone && turn.lead.phone.replace(/\D/g, "") !== session.savedLead.phone.replace(/\D/g, "");
    if (nameChanged || phoneChanged) {
      const patch = { ...session.savedLead, ...turn.lead, projectName: session.project?.name, source };
      try {
        await updateLead(session.leadRowNumber, patch);
        session.savedLead = patch;
        console.log(`✏️ لید ردیف ${session.leadRowNumber} اصلاح شد (نام/شماره).`);
        return { message: `${turn.reply}\n\n✅ اطلاعات پرونده‌تون به‌روز شد.` };
      } catch (err) {
        console.error("❌ به‌روزرسانی لید ناموفق بود:", err.message);
        notifyAdmin(`🚨 اصلاح لید ردیف ${session.leadRowNumber} ناموفق بود: ${err.message}\nنام: ${patch.customerName}\nتماس: ${patch.phone}`);
        return { message: `${turn.reply}\n\n⚠️ اصلاح اطلاعات ثبت نشد؛ لطفاً با دفتر تماس بگیرید.` };
      }
    }
  }

  return { message: `${turn.reply}${turn.reply.includes("شروع مجدد") ? "" : FOLLOWUP_HINT}` };
}

// پردازش یک پیام کاربر
// key: شناسه یکتا (مثل "telegram:123" یا "web:abc") | text: متن کاربر | source: "تلگرام" یا "لندینگ‌پیج"
export function handleUserMessage(key, text, source) {
  return withSessionLock(key, async () => {
    const session = getSession(key);
    const clean = String(text ?? "").trim();

    if (!clean) return { message: "لطفاً پیام‌تون رو بنویسید تا راهنمایی‌تون کنم." };
    if (clean.length > 4000) return { message: "پیام‌تون خیلی بلند بود 🙏 لطفاً کوتاه‌تر و خلاصه‌تر بنویسید." };

    if (isRestartCommand(clean)) return await startOver(key);

    try {
      if (session.state === "choosing_project") return await chooseProject(clean, session);
      if (session.state === "followup") return await handleFollowup(session, clean, source);
      return await continueChat(session, clean, source);
    } catch (err) {
      console.error(`❌ [${key}] خطا در پردازش پیام:`, err.message || err);
      const userMessage = err instanceof AiError ? err.userMessage : "متاسفانه خطایی پیش اومد 🙏 لطفاً دوباره امتحان کنید.";
      // اگر نشست خراب شده (chat ندارد) کاربر را به اول مسیر برمی‌گردانیم
      if (!session.chat) {
        session.state = "choosing_project";
        return { message: `${userMessage}\n\n«شروع مجدد» را بفرستید تا از اول شروع کنیم.` };
      }
      return { message: userMessage };
    }
  });
}

export async function startOver(key) {
  resetSession(key);
  getSession(key);
  const welcome = await getWelcomeMessage();
  return { ...welcome, keyboard: welcome.projects?.map((p) => p.name) ?? null, removeKeyboard: false };
}
