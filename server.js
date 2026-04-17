require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const Activity = require("./models/Activity");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());

async function connectDB() {
  try {
    if (!process.env.MONGO_URI) {
      throw new Error("MONGO_URI is not defined");
    }

    await mongoose.connect(process.env.MONGO_URI);
    console.log("✅ MongoDB connected");
  } catch (err) {
    console.error("❌ MongoDB connection error:", err.message);
    process.exit(1);
  }
}

app.get("/", (req, res) => {
  res.send("GitHub webhook server running");
});

app.post("/webhook/github", async (req, res) => {
  try {
    const eventType = req.headers["x-github-event"];
    const deliveryId = req.headers["x-github-delivery"] || null;
    const payload = req.body;

    if (eventType === "push") {
      const repo = payload.repository?.name || "unknown";
      const commits = payload.commits || [];

      if (commits.length === 0) {
        return res.status(200).json({
          success: true,
          message: "No commits in push payload"
        });
      }

      const docs = commits.map((commit) => ({
        deliveryId,
        eventType: "push",
        source: "commit",

        repo,
        author:
          commit.author?.username ||
          commit.author?.name ||
          payload.sender?.login ||
          "unknown",

        message: commit.message || "No message",
        url: commit.url || null,
        timestamp: commit.timestamp ? new Date(commit.timestamp) : new Date(),

        commitId: commit.id || null,
        prNumber: null,
        action: null
      }));

      await Activity.insertMany(docs);

      return res.status(200).json({
        success: true,
        message: "Push commits saved",
        count: docs.length
      });
    }

    if (eventType === "pull_request") {
      const pr = payload.pull_request;

      if (!pr) {
        return res.status(400).json({
          success: false,
          message: "No pull_request object found"
        });
      }

      const doc = {
        deliveryId,
        eventType: "pull_request",
        source: "pr",

        repo: payload.repository?.name || "unknown",
        author: pr.user?.login || payload.sender?.login || "unknown",

        message: pr.title || "No title",
        url: pr.html_url || null,
        timestamp: pr.created_at ? new Date(pr.created_at) : new Date(),

        commitId: null,
        prNumber: pr.number || null,
        action: payload.action || null
      };

      await Activity.create(doc);

      return res.status(200).json({
        success: true,
        message: "Pull request saved"
      });
    }

    return res.status(200).json({
      success: true,
      message: `Ignored event: ${eventType}`
    });
  } catch (err) {
    console.error("❌ Webhook error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to save webhook data",
      error: err.message
    });
  }
});

connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
  });
});