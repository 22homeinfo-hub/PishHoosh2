// API وب برای لندینگ‌پیج (چت روی سایت)

import express from "express";
import cors from "cors";
import { getWelcomeMessage, handleUserMessage, startOver } from "./conversation.js";

export function createWebApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  // چک سلامت سرور (برای Railway)
  app.get("/health", (req, res) => res.json({ status: "ok" }));

  // شروع مکالمه جدید - برمی‌گردونه پیام خوش‌آمدگویی
  app.get("/api/welcome", async (req, res) => {
    try {
      const welcome = await getWelcomeMessage();
      res.json({ message: welcome });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "خطا در دریافت اطلاعات" });
    }
  });

  // ارسال پیام کاربر
  // بدنه: { sessionId: "uuid-xxx", text: "متن پیام کاربر" }
  app.post("/api/message", async (req, res) => {
    const { sessionId, text } = req.body;
    if (!sessionId || !text) {
      return res.status(400).json({ error: "sessionId و text الزامی هستند" });
    }

    const key = `web:${sessionId}`;

    try {
      if (text.trim() === "شروع مجدد") {
        const welcome = await startOver(key);
        return res.json({ message: welcome });
      }
      const reply = await handleUserMessage(key, text.trim(), "لندینگ‌پیج");
      res.json({ message: reply });
    } catch (err) {
      console.error("خطا در پردازش پیام وب:", err);
      res.status(500).json({ error: "متاسفانه خطایی پیش اومد. لطفا دوباره امتحان کنید." });
    }
  });

  return app;
}
