require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const WebhookEvent = require("./models/WebhookEvent");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

async function connectDB() {
  try {
    if (!process.env.MONGO_URI) {
      throw new Error("MONGO_URI is not defined in .env");
    }

    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ MongoDB connected");
  } catch (err) {
    console.error("❌ MongoDB connection error:", err.message);
    process.exit(1);
  }
}

app.get("/", (req, res) => {
  res.send("Webhook server is running");
});

app.post("/webhook/github", async (req, res) => {
  try {
    const payload = req.body;

    const doc = await WebhookEvent.create({
      eventType: req.headers["x-github-event"] || "unknown",
      deliveryId: req.headers["x-github-delivery"] || null,
      repository: {
        id: payload.repository?.id ?? null,
        name: payload.repository?.name ?? null,
        fullName: payload.repository?.full_name ?? null,
        private: payload.repository?.private ?? null
      },
      sender: {
        login: payload.sender?.login ?? null,
        id: payload.sender?.id ?? null
      },
      payload
    });

    console.log("✅ Webhook saved:", doc._id);

    return res.status(200).json({
      success: true,
      message: "Webhook saved to MongoDB",
      id: doc._id
    });
  } catch (err) {
    console.error("❌ Error saving webhook:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to save webhook",
      error: err.message
    });
  }
});

connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
  });
});