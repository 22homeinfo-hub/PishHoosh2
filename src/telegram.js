// ماژول بات تلگرام

import TelegramBot from "node-telegram-bot-api";
import dotenv from "dotenv";
import { getWelcomeMessage, handleUserMessage, startOver } from "./conversation.js";

dotenv.config();

export function startTelegramBot() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error("TELEGRAM_BOT_TOKEN تنظیم نشده. بات تلگرام غیرفعال است.");
    return null;
  }

  const bot = new TelegramBot(token, { polling: true });

  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const key = `telegram:${chatId}`;
    try {
      const welcome = await getWelcomeMessage();
      bot.sendMessage(chatId, welcome);
    } catch (err) {
      console.error(err);
      bot.sendMessage(chatId, "متاسفانه خطایی پیش اومد. لطفا بعدا دوباره امتحان کنید.");
    }
  });

  bot.on("message", async (msg) => {
    if (!msg.text || msg.text.startsWith("/start")) return;

    const chatId = msg.chat.id;
    const key = `telegram:${chatId}`;
    const text = msg.text.trim();

    try {
      if (text === "شروع مجدد") {
        const welcome = await startOver(key);
        bot.sendMessage(chatId, welcome);
        return;
      }

      bot.sendChatAction(chatId, "typing");
      const reply = await handleUserMessage(key, text, "تلگرام");
      bot.sendMessage(chatId, reply);
    } catch (err) {
      console.error("خطا در پردازش پیام تلگرام:", err);
      bot.sendMessage(chatId, "متاسفانه خطایی پیش اومد 🙏 لطفا دوباره امتحان کنید یا با پشتیبانی تماس بگیرید.");
    }
  });

  bot.on("polling_error", (err) => {
    console.error("خطای polling تلگرام:", err.message);
  });

  console.log("✅ بات تلگرام فعال شد");
  return bot;
}
