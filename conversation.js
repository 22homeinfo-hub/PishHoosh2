// منطق مشترک مکالمه، هم برای تلگرام هم برای لندینگ‌پیج استفاده میشه
// این‌طوری منطق دو بار نوشته نمیشه و هر تغییر هر دو کانال رو پوشش می‌ده

import { getActiveProjects, findProjectByName, addLead } from "./sheets.js";
import { startConversation, sendMessage, checkIfComplete, extractLeadData } from "./ai.js";
import { getSession, resetSession } from "./sessions.js";

// پیام معرفی و لیست پروژه‌ها
export async function getWelcomeMessage() {
  const projects = await getActiveProjects();
  if (projects.length === 0) {
    return "در حال حاضر پروژه فعالی تعریف نشده. لطفا بعدا دوباره امتحان کنید.";
  }
  const list = projects.map((p, i) => `${i + 1}. ${p.name}`).join("\n");
  return `سلام و وقت بخیر 🌷 به ربات دفتر املاک دیار خوش اومدید!\n\nبرای ثبت اطلاعات فایلتون، لطفا اسم پروژه مدنظرتون رو بنویسید:\n\n${list}`;
}

// پردازش یک پیام کاربر و برگرداندن پاسخ ربات
// key: شناسه یکتای کاربر (مثلا "telegram:123" یا "web:abc")
// text: متنی که کاربر فرستاده
// source: "تلگرام" یا "لندینگ‌پیج"
export async function handleUserMessage(key, text, source) {
  const session = getSession(key);

  // مرحله ۱: کاربر هنوز پروژه انتخاب نکرده
  if (session.state === "choosing_project") {
    const project = await findProjectByName(text);
    if (!project) {
      const projects = await getActiveProjects();
      const list = projects.map((p, i) => `${i + 1}. ${p.name}`).join("\n");
      return `متاسفانه این پروژه رو پیدا نکردم 🙏 لطفا دقیق‌تر اسم پروژه رو از این لیست بنویسید:\n\n${list}`;
    }

    session.project = project;
    session.chatSession = startConversation(project);
    session.state = "chatting";

    // اولین پیام مدل که در تاریخچه ساخته شده رو برمی‌گردونیم
    const history = await session.chatSession.getHistory();
    const firstModelMsg = history.find((h) => h.role === "model");
    return firstModelMsg?.parts?.[0]?.text || "بفرمایید، اطلاعات فایلتون رو بگید.";
  }

  // مرحله ۲: در حال گفتگو برای جمع‌آوری اطلاعات
  if (session.state === "chatting") {
    const reply = await sendMessage(session.chatSession, text);

    const isComplete = await checkIfComplete(session.chatSession);
    if (isComplete) {
      try {
        const leadData = await extractLeadData(session.chatSession, session.project);
        await addLead({
          customerName: leadData.customerName,
          phone: leadData.phone,
          projectName: session.project.name,
          fileInfo: leadData.fileInfo,
          estimatedPrice: leadData.estimatedPrice,
          source,
        });
      } catch (err) {
        console.error("خطا در ثبت لید در شیت:", err);
      }
      session.state = "done";
    }

    return reply;
  }

  // مرحله ۳: مکالمه تمام شده، کاربر می‌تونه دوباره شروع کنه
  if (session.state === "done") {
    resetSession(key);
    return `اطلاعاتتون با موفقیت ثبت شد ✅ کارشناسان دفتر دیار به‌زودی باهاتون تماس می‌گیرن.\n\nاگه می‌خواید فایل جدیدی ثبت کنید، فقط بنویسید "شروع مجدد".`;
  }
}

export async function startOver(key) {
  resetSession(key);
  return getWelcomeMessage();
}
