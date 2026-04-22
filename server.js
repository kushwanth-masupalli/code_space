require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const Activity = require("./models/Activity");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

const EXCLUDED_USERS = ["kushwanth-masupalli"];

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

function isExcludedUser(username) {
  if (!username) return false;
  return EXCLUDED_USERS.includes(String(username).toLowerCase());
}

async function githubRequest(url) {
  const token = process.env.GITHUB_TOKEN;

  if (!token) {
    throw new Error("GITHUB_TOKEN is not defined");
  }

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "DevPulse-App"
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`GitHub API error: ${response.status} ${errorText}`);
  }

  return response.json();
}

async function fetchRepoOpenIssuesSummary(repoName) {
  const org = process.env.GITHUB_ORG;

  if (!org) {
    throw new Error("GITHUB_ORG is not defined");
  }

  const issues = await githubRequest(
    `https://api.github.com/repos/${org}/${repoName}/issues?state=open&per_page=100`
  );

  const pureIssues = issues.filter((item) => !item.pull_request);

  return {
    name: repoName,
    openIssues: pureIssues.length,
    htmlUrl: `https://github.com/${org}/${repoName}/issues`
  };
}

async function fetchRepoIssueDetails(repoName) {
  const org = process.env.GITHUB_ORG;

  if (!org) {
    throw new Error("GITHUB_ORG is not defined");
  }

  const issues = await githubRequest(
    `https://api.github.com/repos/${org}/${repoName}/issues?state=open&per_page=100`
  );

  const pureIssues = issues.filter((item) => !item.pull_request);

  return pureIssues.map((issue) => ({
    id: issue.id,
    number: issue.number,
    title: issue.title,
    state: issue.state,
    createdAt: issue.created_at,
    updatedAt: issue.updated_at,
    url: issue.html_url,
    user: issue.user?.login || "unknown"
  }));
}

app.get("/", (req, res) => {
  res.send("GitHub webhook server running");
});

app.get("/leaderboard", async (req, res) => {
  try {
    const data = await Activity.aggregate([
      {
        $match: {
          author: { $nin: EXCLUDED_USERS }
        }
      },
      {
        $group: {
          _id: "$author",
          points: { $sum: "$points" }
        }
      },
      {
        $project: {
          _id: 0,
          username: "$_id",
          points: 1
        }
      },
      {
        $sort: {
          points: -1,
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

app.get("/user-details/:username", async (req, res) => {
  try {
    const username = req.params.username;

    if (!username) {
      return res.status(400).json({
        success: false,
        message: "Username is required"
      });
    }

    if (isExcludedUser(username)) {
      return res.status(200).json({
        success: true,
        username,
        count: 0,
        totalPoints: 0,
        details: []
      });
    }

    const details = await Activity.find({
      $and: [
        { author: username },
        { author: { $nin: EXCLUDED_USERS } }
      ]
    })
      .select("repo source type difficulty message points timestamp url")
      .sort({ timestamp: -1 })
      .lean();

    const totalPoints = details.reduce((sum, item) => sum + (item.points || 0), 0);

    res.status(200).json({
      success: true,
      username,
      count: details.length,
      totalPoints,
      details
    });
  } catch (err) {
    console.error("❌ User details error:", err);
    res.status(500).json({
      success: false,
      message: "Failed to fetch user details",
      error: err.message
    });
  }
});

app.get("/repo-issues", async (req, res) => {
  try {
    const repoDocs = await Activity.aggregate([
      {
        $match: {
          author: { $nin: EXCLUDED_USERS }
        }
      },
      {
        $group: {
          _id: "$repo"
        }
      },
      {
        $project: {
          _id: 0,
          name: "$_id"
        }
      },
      {
        $sort: {
          name: 1
        }
      }
    ]);

    const repoNames = repoDocs.map((repo) => repo.name).filter(Boolean);

    const repos = await Promise.all(
      repoNames.map((repoName) => fetchRepoOpenIssuesSummary(repoName))
    );

    res.status(200).json({
      success: true,
      count: repos.length,
      repos
    });
  } catch (err) {
    console.error("❌ Repo issues error:", err);
    res.status(500).json({
      success: false,
      message: "Failed to fetch repo issues",
      error: err.message
    });
  }
});

app.get("/repo-issues/:repoName", async (req, res) => {
  try {
    const repoName = req.params.repoName;

    if (!repoName) {
      return res.status(400).json({
        success: false,
        message: "Repository name is required"
      });
    }

    const issues = await fetchRepoIssueDetails(repoName);

    res.status(200).json({
      success: true,
      repo: repoName,
      count: issues.length,
      issues
    });
  } catch (err) {
    console.error("❌ Repo issue details error:", err);
    res.status(500).json({
      success: false,
      message: "Failed to fetch repo issue details",
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

      const docs = commits
        .map((commit) => {
          const author =
            commit.author?.username ||
            commit.author?.name ||
            payload.sender?.login ||
            "unknown";

          if (isExcludedUser(author)) {
            return null;
          }

          const type = extractType(commit.message);
          const points = calculateCommitPoints(type);

          return {
            deliveryId,
            eventType: "push",
            source: "commit",
            repo,
            author,
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
        })
        .filter(Boolean);

      if (docs.length === 0) {
        return res.status(200).json({
          success: true,
          message: "All commits ignored because author is excluded"
        });
      }

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

      const author = pr.user?.login || payload.sender?.login || "unknown";

      if (isExcludedUser(author)) {
        return res.status(200).json({
          success: true,
          message: "PR ignored because author is excluded"
        });
      }

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
          author,
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