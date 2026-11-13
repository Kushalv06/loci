import mongoose from "mongoose";

const learningMemorySchema = new mongoose.Schema(
  {
    // The authoritative raw transcript straight from speech-to-text (Whisper / AssemblyAI)
    rawTranscript: {
      type: String,
      required: true,
      trim: true,
    },

    // Classification metadata
    validityStatus: {
      type: String,
      enum: ["valid", "invalid", "needs_review"],
      required: true,
    },
    reasonCode: {
      type: String,
      required: true,
    },

    // Content extraction
    conceptName: {
      type: String,
      default: null,
      trim: true,
    },
    noteTypes: {
      type: [String],
      default: [],
    },
    searchTags: {
      type: [String],
      default: [],
    },
    concepts: {
      type: [String],
      default: [],
    },
    summary: {
      type: String,
      default: null,
    },
    keyIdeas: {
      type: [String],
      default: [],
    },

    // Cleaned transcript (meaning and phrasing 100% preserved)
    cleanedTranscript: {
      type: String,
      default: null,
    },

    // Learning feedback and nuances
    possibleCorrection: {
      type: String,
      default: null,
    },
    importantNuance: {
      type: String,
      default: null,
    },

    // Room for dense vector embeddings (e.g. NVIDIA Nemotron, OpenAI, etc.)
    embedding: {
      type: [Number],
      default: undefined,
    },
    embeddingStatus: {
      type: String,
      enum: ["pending", "ready", "failed"],
      default: "pending",
    },
  },
  {
    timestamps: true, // Automatically manages createdAt and updatedAt
  }
);

export const LearningMemory = mongoose.model("LearningMemory", learningMemorySchema);

