// ===========================================================
//  Fuel Innovation - LINE Official Auto Reply Bot
//  Version: 4.9.6 – Smart FAQ + Saving Calculator + Annual Report
//  - คงโครงสร้างและคอมเมนต์จาก v4.9.4 ทุกบรรทัด
//  - เพิ่มระบบคำนวณความประหยัด (3 ขั้นตอน) + แสดงผล รายวัน/เดือน/ปี
//  - เพิ่มเมนู Greeting ครบ 5 รายการ + ปุ่มลิงก์ Company Profile
//  - วางบล็อกคำนวณหลัง Smart Greeting Memory ตามที่ยืนยัน
// ===========================================================

import "dotenv/config";
import express from "express";
import fs from "fs";
import { Client, middleware as lineMiddleware } from "@line/bot-sdk";

// ===========================================================
// ⚙️ App Initialization
// ===========================================================
const app = express();

// ------------ LINE Config ------------
const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};
const client = new Client(config);

// ------------ App Config ------------
const PORT = process.env.PORT || 3000;
const SPEC_URL = process.env.SPEC_URL || "";
const QUOTE_URL = process.env.QUOTE_URL || "";
const COMPANY_PROFILE_URL = process.env.COMPANY_PROFILE_URL || "";
const ADMIN_LINE_USER_ID = process.env.ADMIN_LINE_USER_ID || "";

// ===========================================================
// 🩺 Health Check Endpoint
// ===========================================================
app.get("/", (_req, res) => {
  res.send(
    "🚀 Fuel Innovation LINE Bot (v4.9.6 – Smart FAQ + Saving Calculator + Annual Report) is running..."
  );
});

// ===========================================================
// 🗃️ FAQ Database (External Import)
// ===========================================================
// ใช้ฐานข้อมูลจากไฟล์ภายนอกแทน Object เดิม
import { faqDatabase } from "./faq.js";

// ===========================================================
// 🔍 FAQ Search Function (v4.9.6 Precision Enhanced)
// ===========================================================
function searchFAQ(message) {
  if (!message) return null;
  const msg = String(message).toLowerCase().trim();

  // normalize: ตัดช่องว่างทั้งหมด + ทำให้ขีดทุกแบบเป็นขีดกลางเดียว
  const normalizedMsg = msg.replace(/\s+/g, "").replace(/[–—‐-‒−-]/g, "-");

  for (const item of faqDatabase) {
    if (!item?.keywords || !item?.answer) continue;
    for (const keyword of item.keywords) {
      const normalizedKeyword = String(keyword)
        .toLowerCase()
        .replace(/\s+/g, "")
        .replace(/[–—‐-‒−-]/g, "-");
      if (normalizedMsg.includes(normalizedKeyword)) {
        return item.answer;
      }
    }
  }
  return null;
}

// ===========================================================
// 📊 Interaction Logger
// ===========================================================
const LOG_FILE = "interaction_log.json";
function readLog() {
  if (!fs.existsSync(LOG_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(LOG_FILE, "utf8"));
  } catch {
    return [];
  }
}
function writeLog(data) {
  fs.writeFileSync(LOG_FILE, JSON.stringify(data, null, 2));
}
function logAction(action, meta = {}) {
  const entry = { action, timestamp: new Date().toISOString(), ...meta };
  const logs = readLog();
  logs.push(entry);
  writeLog(logs);
}

// ===========================================================
// 🧠 Smart Greeting Memory
// ===========================================================
const nameCache = new Map();

async function getUserName(userId) {
  const cache = nameCache.get(userId);
  const now = Date.now();
  if (cache && now - cache.cachedAt < 3600000) return cache.name;

  try {
    const profile = await client.getProfile(userId);
    const name = profile?.displayName || "ลูกค้าท่าน";
    nameCache.set(userId, { name, cachedAt: now, lastGreet: 0 });
    return name;
  } catch {
    return "ลูกค้าท่าน";
  }
}

function canGreet(userId) {
  const now = Date.now();
  const entry = nameCache.get(userId);
  if (!entry || now - (entry.lastGreet || 0) > 60000) {
    nameCache.set(userId, { ...entry, lastGreet: now });
    return true;
  }
  return false;
}

// ===========================================================
// 🧮 Saving Calculator State (วางหลัง Smart Greeting Memory)
// ===========================================================
const calcState = new Map(); // เก็บสถานะการคำนวณต่อผู้ใช้

// ===========================================================
// 🔔 LINE Webhook
// ===========================================================
app.post("/webhook", lineMiddleware(config), (req, res) => {
  Promise.all(req.body.events.map(handleEvent))
    .then((r) => res.json(r))
    .catch((err) => {
      console.error("❌ Error in handleEvent:", err);
      res.status(500).end();
    });
});

// =======================================================
// 💬 Event Handler
// =======================================================
async function handleEvent(event) {
  // --- Follow Event ---
  if (event.type === "follow") {
    logAction("follow", { userId: event.source?.userId || "unknown" });
    return client.replyMessage(event.replyToken, buildWelcomeFlex());
  }

  // --- Message Event ---
  if (event.type === "message" && event.message.type === "text") {
    const msg = (event.message.text || "").trim();
    const userId = event.source?.userId || "unknown";

    // ✅ ถ้าอยู่ในโหมดคำนวณ ให้ส่งไปที่ flow โดยตรง
    const state = calcState.get(userId);
    if (state) {
      return handleCalcFlow(userId, msg, event.replyToken);
    }

    // ✅ STEP 1: ตรวจคำถาม FAQ ก่อนทุกกรณี
    const faqAnswer = searchFAQ(msg);
    if (faqAnswer) {
      logAction("faq-auto-reply", { msg, matched: true });
      return replyText(event.replyToken, faqAnswer);
    }

    // ✅ STEP 2: Greeting / Menu / General commands
    if (/^สวัสดี/.test(msg)) {
      const name = await getUserName(userId);
      logAction("smart-greeting", { userId, name });
      if (!canGreet(userId)) {
        return replyText(
          event.replyToken,
          `😊 ยินดีที่ได้คุยกับคุณ${name} อีกครั้งครับ`
        );
      }
      return replyText(
        event.replyToken,
        [
          `👋 สวัสดีครับคุณ${name} ขอบคุณที่ติดต่อ Fuel Innovation 🔥`,
          `ทีมงานพร้อมดูแลทุกคำถามของคุณครับ 😊`,
          ``,
          `พิมพ์ "เกี่ยวกับเรา" เพื่อดูข้อมูลบริษัท`,
          `พิมพ์ "คำนวณความประหยัด" เพื่อดูผลคำนวณจริง`,
          `พิมพ์ "สเปคน้ำมัน" เพื่อดูรายละเอียดผลิตภัณฑ์`,
          `พิมพ์ "ใบเสนอราคา" เพื่อขอใบเสนอราคา`,
          `พิมพ์ "ถาม–ตอบ" เพื่อสอบถามข้อมูลเพิ่มเติม`,
        ].join("\n")
      );
    }

    // ✅ เริ่มต้นโหมดคำนวณความประหยัด
    if (/คำนวณความประหยัด/i.test(msg)) {
      logAction("calc-start", { userId });
      calcState.set(userId, { step: 1 });
      return replyText(
        event.replyToken,
        "🧮 กรุณาพิมพ์ราคาน้ำมันที่คุณซื้อจากหน้าปั๊ม (บาท/ลิตร):"
      );
    }

    // ✅ STEP 3: คำสั่งเมนูถาม–ตอบ
    if (/(^ถาม$)|(^ถาม-ตอบ$)|(^ถาม–ตอบ$)/.test(msg)) {
      logAction("faq-prompt", { msg });
      return replyText(
        event.replyToken,
        "💬 คุณสามารถพิมพ์คำถามของคุณได้เลยครับ เช่น\n\n• ทำไมน้ำมันของเราถึงราคาถูก\n• น้ำมันมาจากไหน\n• น้ำมันของคุณทำมาจากอะไร\n• น้ำมันนี้ขายในปั๊มได้ไหม\n• ใช้กับเครื่องปั่นไฟได้ไหม\n• ต่างกับดีเซลปั๊มยังไง\n• มีขั้นต่ำไหมครับ\n• ค่าซัลเฟอร์มีผลอย่างไร\n• ระบบ DPF/SCR คืออะไร\n• มีเอกสารรับรองไหม\n• มีระบบ QC ภายในไหม\n• น้ำมันเก็บได้นานเท่าไร\n\n🧠 บอทจะตอบโดยอัตโนมัติตามคู่มือฝ่ายขาย Fuel Innovation เพื่อให้ข้อมูลที่ถูกต้องและรวดเร็วครับ ✅"
      );
    }

    // --- เกี่ยวกับเรา ---
    if (/เกี่ยวกับเรา|about/i.test(msg)) {
      logAction("about-link", { msg });
      if (COMPANY_PROFILE_URL) {
        return replyText(
          event.replyToken,
          [
            "🏢 Fuel Innovation – Company Profile",
            "",
            "คุณสามารถดาวน์โหลดเอกสารแนะนำบริษัทได้ที่ลิงก์ด้านล่างครับ 👇",
            `📎 ${COMPANY_PROFILE_URL}`,
          ].join("\n")
        );
      }
      return replyText(
        event.replyToken,
        "ขออภัยครับ ขณะนี้ยังไม่ได้ตั้งค่าลิงก์ Company Profile ในระบบ 🙏"
      );
    }

    // --- ฝ่ายขาย (แยกจาก “ขายในปั๊ม”) ---
    if (
      /(^ฝ่ายขาย$)|(^ติดต่อ$)|(^ขาย$)|(^โทร$)|(^อยากซื้อ$)|(^ติดต่อฝ่ายขาย$)/.test(
        msg
      )
    ) {
      logAction("sales-text", { msg });
      return replyText(
        event.replyToken,
        "ฝ่ายขาย Fuel Innovation พร้อมให้คำแนะนำทุกวันครับ\u200B\n📞 คุณนิค 098-227-7887\u200B\n📞 คุณต้อม 065-919-9464"
      );
    }

    // --- สเปคน้ำมัน ---
    if (/spec|สเปค|สเปคน้ำมัน/i.test(msg)) {
      logAction("spec-text", { msg });
      return replyText(
        event.replyToken,
        `📘 Fuel Innovation – Product Specification Sheet\nดาวน์โหลดสเปคน้ำมันอุตสาหกรรม (Type D1) ได้ที่นี่ 👇\n📎 ${SPEC_URL}\n\nทีม Fuel Innovation พร้อมดูแลคุณทุกวันครับ 😊`
      );
    }

    // --- ใบเสนอราคา ---
    // หมายเหตุ: ไม่ใช้ \b (word boundary) เพราะอักษรไทยอาจไม่แมตช์กับ \b ใน JS
    if (/(ใบเสนอราคา|quotation|ขอใบเสนอราคา)/i.test(msg)) {
      logAction("quote-text", { msg });
      return replyText(
        event.replyToken,
        `🧾 Fuel Innovation – ใบเสนอราคาอย่างเป็นทางการ\nกรุณากรอกข้อมูลเพื่อขอใบเสนอราคาที่ลิงก์ด้านล่าง 👇\n\n📎 ${QUOTE_URL}\n\nทีม Fuel Innovation พร้อมให้บริการครับ 🚛`
      );
    }

    // ✅ STEP 4: Fallback — ถ้าไม่ตรงกับคำถามใด ๆ เลย
    logAction("generic-text", { msg });
    return replyText(
      event.replyToken,
      "🤔 ขอบคุณครับที่สอบถามเข้ามา\nบอทอาจยังไม่เข้าใจคำถามนี้ชัดเจน\n\nหากต้องการให้ทีมงานติดต่อกลับ กรุณาพิมพ์\n📞 'ติดต่อฝ่ายขาย' หรือส่งชื่อและเบอร์โทรกลับมาได้เลยครับ\n\nหรือพิมพ์ \"ถาม–ตอบ\" เพื่อดูหัวข้อคำถามยอดนิยมครับ 💬"
    );
  }

  return Promise.resolve(null);
}

// =======================================================
// 🧮 Handle Calculator Flow
// =======================================================
async function handleCalcFlow(userId, msg, replyToken) {
  const state = calcState.get(userId);
  const num = parseFloat((msg || "").toString().replace(/[, ]+/g, ""));
  if (isNaN(num) || num < 0) {
    return replyText(
      replyToken,
      "❗ กรุณาพิมพ์เป็นตัวเลขที่ถูกต้อง เช่น 33 หรือ 33.50"
    );
  }

  // STEP 1: รับราคา/ลิตร
  if (state.step === 1) {
    calcState.set(userId, { step: 2, price: num });
    return replyText(
      replyToken,
      "📉 ส่วนลดที่ได้รับจาก Fuel Innovation (บาท/ลิตร):"
    );
  }

  // STEP 2: รับส่วนลด/ลิตร
  if (state.step === 2) {
    calcState.set(userId, {
      step: 3,
      price: state.price,
      discount: num,
    });
    return replyText(
      replyToken,
      "⛽ ปริมาณการใช้น้ำมันต่อวัน (ลิตร):"
    );
  }

  // STEP 3: รับปริมาณ/วัน และสรุปผล
  if (state.step === 3) {
    const { price, discount } = state;
    const litersPerDay = num;

    const savingPerDay = discount * litersPerDay;
    const savingPerMonth = savingPerDay * 30;
    const savingPerYear = savingPerDay * 365;

    calcState.delete(userId);

    return replyText(
      replyToken,
      [
        `✅ ผลการคำนวณความประหยัดของคุณ`,
        ``,
        `ราคาน้ำมันปกติ: ${price} บาท/ลิตร`,
        `ส่วนลดจาก Fuel Innovation: ${discount} บาท/ลิตร`,
        `ปริมาณการใช้น้ำมัน: ${litersPerDay} ลิตร/วัน`,
        ``,
        `💰 ประหยัดได้ประมาณ:`,
        `→ ${savingPerDay.toLocaleString()} บาท/วัน`,
        `→ ${savingPerMonth.toLocaleString()} บาท/เดือน`,
        `→ ${savingPerYear.toLocaleString()} บาท/ปี`,
        ``,
        `💡 ส่วนลดจริงขึ้นอยู่กับพื้นที่และปริมาณการใช้งาน ราคานี้ยังไม่รวมค่าขนส่งครับ`,
        `หากต้องการทราบราคาที่แน่นอนสำหรับพื้นที่ของคุณ`,
        `พิมพ์ “ติดต่อฝ่ายขาย” ได้เลยครับ 📞`,
      ].join("\n")
    );
  }

  // กรณีสถานะไม่คาดคิด
  calcState.delete(userId);
  return replyText(
    replyToken,
    "ขออภัยครับ เกิดข้อผิดพลาดในการคำนวณ กรุณาพิมพ์ “คำนวณความประหยัด” เพื่อเริ่มใหม่อีกครั้งครับ 🙏"
  );
}

// =======================================================
// 📨 Reply Function
// =======================================================
function replyText(token, text) {
  return client.replyMessage(token, { type: "text", text });
}

// ===========================================================
// 🎨 buildWelcomeFlex()
// ===========================================================
function buildWelcomeFlex() {
  return {
    type: "flex",
    altText: "Fuel Innovation – Welcome",
    contents: {
      type: "bubble",
      size: "giga",
      body: {
        type: "box",
        layout: "vertical",
        background: {
          type: "linearGradient",
          angle: "0deg",
          startColor: "#0F2957",
          endColor: "#123E91",
        },
        borderColor: "#123E91",
        borderWidth: "1px",
        cornerRadius: "lg",
        paddingAll: "12px",
        contents: [
          {
            type: "box",
            layout: "vertical",
            alignItems: "center",
            paddingAll: "6px",
            contents: [
              {
                type: "image",
                url:
                  "https://raw.githubusercontent.com/khunhoro-Luesak/fuel-innovation-assets/main/logo-orange-gradient.png",
                size: "md",
                aspectMode: "fit",
                margin: "none",
              },
            ],
          },
          {
            type: "text",
            text: "Fuel Innovation Co., Ltd.",
            weight: "bold",
            size: "xl",
            color: "#FFFFFF",
            align: "center",
            margin: "md",
          },
          { type: "separator", color: "#2155B5", margin: "md" },
          {
            type: "text",
            text:
              "ผู้จัดจำหน่ายเชื้อเพลิงอุตสาหกรรมทางเลือก (Alternative Industrial Fuel – Type D1)\nประหยัดสูงสุด 4 บาท/ลิตร สำหรับรถบรรทุกและเครื่องจักรกลหนัก 🚛",
            wrap: true,
            color: "#FFFFFF",
            size: "sm",
            align: "center",
            margin: "md",
          },
          {
            type: "box",
            layout: "vertical",
            background: {
              type: "linearGradient",
              angle: "180deg",
              startColor: "#123E91",
              endColor: "#1E40AF",
            },
            borderColor: "#1E40AF",
            borderWidth: "1px",
            cornerRadius: "md",
            paddingAll: "12px",
            margin: "lg",
            contents: [
              {
                type: "text",
                text: "✅ เหมาะสำหรับ",
                weight: "bold",
                size: "sm",
                color: "#FACC15",
                align: "center",
              },
              {
                type: "text",
                text: "• รถสิบล้อ / รถเทรลเลอร์ / รถขุด / รถแม็คโคร",
                wrap: true,
                size: "sm",
                color: "#FFFFFF",
                align: "center",
                margin: "xs",
              },
              {
                type: "text",
                text: "• เครื่องจักรงานก่อสร้างและอุตสาหกรรม",
                wrap: true,
                size: "sm",
                color: "#FFFFFF",
                align: "center",
                margin: "xs",
              },
            ],
          },
          {
            type: "text",
            text: "🧭 เลือกเมนูด้านล่างเพื่อเริ่มต้นใช้งาน",
            color: "#FBBF24",
            weight: "bold",
            size: "xs",
            align: "center",
            margin: "md",
          },
          {
            type: "box",
            layout: "vertical",
            spacing: "sm",
            margin: "md",
            contents: [
              // 🏢 เกี่ยวกับเรา → Company Profile
              {
                type: "button",
                style: "primary",
                color: "#38BDF8", // ฟ้าอมเขียว แยกจากสีอื่น
                height: "sm",
                action: {
                  type: "uri",
                  label: "🏢 เกี่ยวกับเรา",
                  uri: COMPANY_PROFILE_URL || SPEC_URL,
                },
              },
              {
                type: "button",
                style: "primary",
                color: "#FBBF24",
                height: "sm",
                action: {
                  type: "uri",
                  label: "📄 ดูสเปคน้ำมัน",
                  uri: SPEC_URL,
                },
              },
              {
                type: "button",
                style: "primary",
                color: "#EF4444",
                height: "sm",
                action: {
                  type: "uri",
                  label: "🧾 ขอใบเสนอราคา",
                  uri: QUOTE_URL,
                },
              },
              {
                type: "button",
                style: "primary",
                color: "#8B5CF6",
                height: "sm",
                action: {
                  type: "message",
                  label: "🧮 คำนวณความประหยัด",
                  text: "คำนวณความประหยัด",
                },
              },
              {
                type: "button",
                style: "primary",
                color: "#2563EB",
                height: "sm",
                action: {
                  type: "message",
                  label: "💬 ถาม–ตอบ",
                  text: "ถาม–ตอบ",
                },
              },
              {
                type: "button",
                style: "primary",
                color: "#22C55E",
                height: "sm",
                action: {
                  type: "message",
                  label: "📞 ฝ่ายขาย",
                  text: "ฝ่ายขาย",
                },
              },
            ],
          },
          {
            type: "box",
            layout: "vertical",
            backgroundColor: "#0B2347",
            cornerRadius: "md",
            paddingAll: "10px",
            margin: "lg",
            contents: [
              {
                type: "text",
                text: "ทีม Fuel Innovation พร้อมดูแลทุกวันครับ 😊",
                align: "center",
                color: "#FFFFFF",
                size: "xs",
                wrap: true,
              },
            ],
          },
        ],
      },
    },
  };
}

// ===========================================================
// 🎴 buildAboutFlex()  (ไม่ใช้แล้ว แต่เผื่ออนาคตอยากกลับมาใช้การ์ด)
// ===========================================================
function buildAboutFlex() {
  return {
    type: "flex",
    altText: "เกี่ยวกับ Fuel Innovation",
    contents: {
      type: "bubble",
      size: "giga",
      body: {
        type: "box",
        layout: "vertical",
        backgroundColor: "#0F2957",
        cornerRadius: "lg",
        paddingAll: "14px",
        contents: [
          {
            type: "image",
            url:
              "https://raw.githubusercontent.com/khunhoro-Luesak/fuel-innovation-assets/main/logo-orange-gradient.png",
            size: "sm",
            aspectMode: "fit",
            align: "center",
          },
          {
            type: "text",
            text: "🏢 เกี่ยวกับ Fuel Innovation Co., Ltd.",
            weight: "bold",
            size: "lg",
            color: "#FFFFFF",
            align: "center",
            margin: "md",
          },
          {
            type: "text",
            text:
              "บริษัท ฟูเอล อินโนเวชั่น จำกัด มุ่งพัฒนาและจัดจำหน่ายเชื้อเพลิงอุตสาหกรรมทางเลือก (Alternative Industrial Fuel – Type D1) ที่มีประสิทธิภาพและคุ้มค่า เพื่อลดต้นทุนผู้ประกอบการไทย",
            wrap: true,
            size: "sm",
            color: "#E5ECFF",
            margin: "sm",
          },
        ],
      },
    },
  };
}

// ===========================================================
// 🚀 Start Server
// ===========================================================
app.listen(PORT, () => {
  console.log(
    "🚀 Fuel Innovation LINE Bot running on port " +
      PORT +
      " (v4.9.6 – Smart FAQ + Saving Calculator + Annual Report)"
  );
});
