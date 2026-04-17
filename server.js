require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const Activity = require("./models/Activity");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
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

const commitRules = {
  feature: 10,
  fix: 7,
  perf: 9,
  refactor: 5,
  test: 5,
  docs: 2,
  style: 1,
  chore: 1
};

const prRules = {
  feature: { hard: 20, medium: 15, easy: 10 },
  bug: { hard: 15, medium: 10, easy: 5 },
  refactor: { default: 7 },
  performance: { default: 12 },
  test: { default: 6 },
  documentation: { default: 3 },
  chore: { default: 2 }
};

function extractType(message) {
  if (!message || typeof message !== "string") return null;
  const match = message.match(/^\[(.*?)\]/);
  return match ? match[1].trim().toLowerCase() : null;
}

function extractDifficulty(message) {
  if (!message || typeof message !== "string") return "default";
  const match = message.match(/\((easy|medium|hard)\)/i);
  return match ? match[1].toLowerCase() : "default";
}

function normalizePRType(type) {
  if (!type) return null;

  const map = {
    fix: "bug",
    perf: "performance",
    docs: "documentation"
  };

  return map[type] || type;
}

function calculateCommitPoints(type) {
  if (!type) return 0;
  return commitRules[type] || 0;
}

function calculatePRPoints(type, difficulty) {
  if (!type) return 0;
  const rule = prRules[type];
  if (!rule) return 0;
  return rule[difficulty] || rule.default || 0;
}

app.get("/", (req, res) => {
  res.send("GitHub webhook server running");
});

app.get("/leaderboard", async (req, res) => {
  try {
    const data = await Activity.aggregate([
      {
        $group: {
          _id: "$author",
          commits: {
            $sum: {
              $cond: [{ $eq: ["$source", "commit"] }, 1, 0]
            }
          },
          prs: {
            $sum: {
              $cond: [{ $eq: ["$source", "pr"] }, 1, 0]
            }
          },
          points: { $sum: "$points" },
          reposWorked: { $addToSet: "$repo" }
        }
      },
      {
        $project: {
          _id: 0,
          username: "$_id",
          commits: 1,
          prs: 1,
          points: 1,
          reposWorked: 1,
          repoCount: { $size: "$reposWorked" }
        }
      },
      {
        $sort: {
          points: -1,
          commits: -1,
          prs: -1,
          username: 1
        }
      }
    ]);

    res.status(200).json({
      success: true,
      count: data.length,
      leaderboard: data
    });
  } catch (err) {
    console.error("❌ Leaderboard error:", err);
    res.status(500).json({
      success: false,
      message: "Failed to fetch leaderboard",
      error: err.message
    });
  }
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

      const docs = commits.map((commit) => {
        const type = extractType(commit.message);
        const points = calculateCommitPoints(type);

        return {
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
          action: null,

          type,
          difficulty: null,
          points
        };
      });

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

      // Only award points when PR is actually merged
      if (payload.action === "closed" && pr.merged === true) {
        let type = extractType(pr.title);
        type = normalizePRType(type);

        const difficulty = extractDifficulty(pr.title);
        const points = calculatePRPoints(type, difficulty);

        const doc = {
          deliveryId,
          eventType: "pull_request",
          source: "pr",

          repo: payload.repository?.name || "unknown",
          author: pr.user?.login || payload.sender?.login || "unknown",

          message: pr.title || "No title",
          url: pr.html_url || null,
          timestamp: pr.merged_at ? new Date(pr.merged_at) : new Date(),

          commitId: null,
          prNumber: pr.number || null,
          action: "merged",

          type,
          difficulty,
          points
        };

        await Activity.create(doc);

        return res.status(200).json({
          success: true,
          message: "Merged PR saved with points"
        });
      }

      return res.status(200).json({
        success: true,
        message: `PR ignored: ${payload.action}`
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