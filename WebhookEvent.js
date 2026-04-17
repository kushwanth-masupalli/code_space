const mongoose = require("mongoose");

const webhookEventSchema = new mongoose.Schema(
  {
    eventType: { type: String, required: true },
    deliveryId: { type: String, default: null },

    repository: {
      id: { type: Number, default: null },
      name: { type: String, default: null },
      fullName: { type: String, default: null },
      private: { type: Boolean, default: null }
    },

    sender: {
      login: { type: String, default: null },
      id: { type: Number, default: null }
    },

    payload: { type: Object, required: true }
  },
  { timestamps: true }
);

module.exports = mongoose.model("WebhookEvent", webhookEventSchema);