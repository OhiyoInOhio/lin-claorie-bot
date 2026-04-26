// ============================================================
// LINE Calorie Estimator Bot — FREE VERSION
// Uses: LINE Messaging API (free) + Google Gemini API (free tier)
// Host on: Render or Railway (free tier)
// ============================================================

import express from "express";
import crypto from "crypto";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 3000;

// ── Config — set these as environment variables ──────────────
const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY; // Free at aistudio.google.com

// ── Signature verification middleware ────────────────────────
app.use(
  "/webhook",
  express.raw({ type: "application/json" }),
  (req, res, next) => {
    const signature = req.headers["x-line-signature"];
    const hmac = crypto
      .createHmac("sha256", LINE_CHANNEL_SECRET)
      .update(req.body)
      .digest("base64");

    if (signature !== hmac) {
      return res.status(401).send("Invalid signature");
    }
    req.body = JSON.parse(req.body);
    next();
  }
);

app.use(express.json());

// ── Webhook endpoint ─────────────────────────────────────────
app.post("/webhook", async (req, res) => {
  res.status(200).send("OK"); // Respond to LINE immediately

  const events = req.body.events || [];
  for (const event of events) {
    if (event.type === "message") {
      await handleMessage(event);
    }
  }
});

// ── Message handler ──────────────────────────────────────────
async function handleMessage(event) {
  const replyToken = event.replyToken;
  const message = event.message;

  // Handle image messages
  if (message.type === "image") {
    try {
      // Download image from LINE as base64
      const imageBase64 = await getLineImageAsBase64(message.id);

      // Estimate calories using Gemini Vision (free)
      const result = await estimateCaloriesWithGemini(imageBase64);

      await replyText(replyToken, result);
    } catch (err) {
      console.error("Error:", err);
      await replyText(
        replyToken,
        "❌ Sorry, I couldn't analyse that image. Please try again with a clearer food photo!"
      );
    }
    return;
  }

  // Handle text messages
  if (message.type === "text") {
    const text = message.text.trim().toLowerCase();
    if (["hi", "hello", "help", "start"].includes(text)) {
      await replyText(
        replyToken,
        `🥗 Food Calorie Estimator Bot\n\nSend me a photo of your food and I'll estimate:\n\n🔢 Total calories\n🥩 Protein / Carbs / Fat\n🍽️ Portion size\n💡 Nutrition tips\n\nJust send any food photo to get started!`
      );
    } else {
      await replyText(
        replyToken,
        "📸 Send me a photo of your food and I'll estimate the calories for you!"
      );
    }
  }
}

// ── Download image from LINE as base64 ───────────────────────
async function getLineImageAsBase64(messageId) {
  const response = await fetch(
    `https://api-data.line.me/v2/bot/message/${messageId}/content`,
    {
      headers: { Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}` },
    }
  );

  if (!response.ok) throw new Error(`LINE image download failed: ${response.status}`);

  const buffer = await response.buffer();
  return buffer.toString("base64");
}

// ── Estimate calories using Gemini Vision (FREE) ─────────────
async function estimateCaloriesWithGemini(imageBase64) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;

  const prompt = `You are a nutrition expert. Analyse this food image and give a calorie estimate.

Respond in this exact format:

🍽️ Food Identified:
[List the foods/dishes you see]

🔢 Estimated Calories:
Total: X – Y kcal

📊 Macronutrients (approx):
• Protein: Xg
• Carbohydrates: Xg
• Fat: Xg

🥄 Portion Size:
[Describe the estimated portion]

💡 Nutrition Notes:
[2-3 short tips about this meal]

⚠️ Note: Estimates based on visual assessment only. Actual values vary by preparation and ingredients.

If no food is visible, ask for a clearer photo.`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            {
              inline_data: {
                mime_type: "image/jpeg",
                data: imageBase64,
              },
            },
            { text: prompt },
          ],
        },
      ],
      generationConfig: {
        maxOutputTokens: 512,
        temperature: 0.4,
      },
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini API error: ${err}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!text) throw new Error("Empty response from Gemini");
  return text;
}

// ── Reply via LINE Messaging API ──────────────────────────────
async function replyText(replyToken, text) {
  await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({
      replyToken,
      messages: [{ type: "text", text }],
    }),
  });
}

// ── Health check ──────────────────────────────────────────────
app.get("/", (req, res) => res.send("LINE Calorie Bot (Free) is running! ✅"));

app.listen(PORT, () => console.log(`Bot running on port ${PORT}`));
