import express from "express";
import crypto from "crypto";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 10000;

const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

app.use(express.json({
  verify: (req, res, buf) => { req.rawBody = buf; }
}));

// Verify LINE signature
function verifySignature(rawBody, signature) {
  const hash = crypto
    .createHmac("SHA256", LINE_CHANNEL_SECRET)
    .update(rawBody)
    .digest("base64");
  return hash === signature;
}

// Download image from LINE and convert to base64
async function getLineImageAsBase64(messageId) {
  const url = `https://api-data.line.me/v2/bot/message/${messageId}/content`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}` }
  });
  if (!res.ok) throw new Error(`LINE image download failed: ${res.status}`);
  const buffer = await res.buffer();
  return buffer.toString("base64");
}

// Analyze food image with Gemini
async function analyzeFoodWithGemini(base64Image) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;

  const prompt = `You are a nutrition expert. Look at this food image and provide a calorie estimate.

Please respond in this exact format:
🍽️ Food: [name of food(s) you see]
🔥 Calories: [estimated calories] kcal
💪 Protein: [grams]g
🍚 Carbs: [grams]g
🧈 Fat: [grams]g
📏 Portion: [estimated portion size]
💡 Tip: [one short nutrition tip]

If you cannot identify food in the image, say "I could not identify food in this image. Please send a clearer photo of food."

Be specific and give your best estimate even if you are not 100% sure.`;

  const body = {
    contents: [{
      parts: [
        {
          inline_data: {
            mime_type: "image/jpeg",
            data: base64Image
          }
        },
        {
          text: prompt
        }
      ]
    }],
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 512
    }
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  const data = await res.json();
  console.log("Gemini raw response:", JSON.stringify(data, null, 2));

  if (!res.ok) {
    throw new Error(`Gemini API error: ${data?.error?.message || res.status}`);
  }

  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error("Gemini returned empty response");
  }

  return text;
}

// Reply to LINE user
async function replyToLine(replyToken, message) {
  await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`
    },
    body: JSON.stringify({
      replyToken,
      messages: [{ type: "text", text: message }]
    })
  });
}

// Handle incoming messages
async function handleMessage(event) {
  const { replyToken, message } = event;

  if (message.type === "image") {
    try {
      console.log("Downloading image from LINE, message ID:", message.id);
      const base64Image = await getLineImageAsBase64(message.id);
      console.log("Image downloaded, size:", base64Image.length, "chars");

      console.log("Sending to Gemini...");
      const result = await analyzeFoodWithGemini(base64Image);
      console.log("Gemini result:", result);

      await replyToLine(replyToken, result);
    } catch (err) {
      console.error("Error:", err.message);
      await replyToLine(replyToken, "❌ Sorry, I had trouble analyzing that image. Please try again with a clear photo of your food.");
    }
  } else if (message.type === "text") {
    const text = message.text.toLowerCase();
    if (text.includes("hi") || text.includes("hello") || text.includes("สวัสดี")) {
      await replyToLine(replyToken, "👋 Hello! Send me a photo of your food and I'll estimate the calories for you! 📸🍽️");
    } else {
      await replyToLine(replyToken, "📸 Please send a photo of your food and I'll calculate the calories!");
    }
  }
}

// Webhook endpoint
app.post("/webhook", async (req, res) => {
  const signature = req.headers["x-line-signature"];
  if (!verifySignature(req.rawBody, signature)) {
    console.log("Invalid signature");
    return res.status(403).send("Invalid signature");
  }

  res.status(200).send("OK");

  const events = req.body.events || [];
  for (const event of events) {
    if (event.type === "message") {
      await handleMessage(event);
    }
  }
});

app.get("/", (req, res) => res.send("LINE Calorie Bot is running! 🍽️"));

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

