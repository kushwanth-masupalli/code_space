const mongoose = require("mongoose");

const activitySchema = new mongoose.Schema(
  {
    deliveryId: { type: String, default: null },
    eventType: { type: String, required: true }, // push / pull_request
    source: { type: String, enum: ["commit", "pr"], required: true },

    repo: { type: String, required: true },
    author: { type: String, required: true },

    message: { type: String, required: true },
    url: { type: String, default: null },
    timestamp: { type: Date, required: true },

    commitId: { type: String, default: null },
    prNumber: { type: Number, default: null },
    action: { type: String, default: null },

    type: { type: String, default: null },
    difficulty: { type: String, default: null },
    points: { type: Number, default: 0 }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Activity", activitySchema);