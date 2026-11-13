import { Router } from "express";
import { LearningMemory } from "../models/LearningMemory.js";
import { analyzeTranscript } from "../services/llmService.js";
import { generateEmbedding, buildEmbeddingText } from "../services/embeddingService.js";

const router = Router();

/**
 * POST /api/process-note
 * Ingest and analyze real-time streaming transcript with Groq LLM, validate content,
 * persist to MongoDB Atlas, and generate NVIDIA dense embeddings.
 */
router.post("/process-note", async (req, res) => {
  const requestStart = performance.now();
  const timings = {};

  try {
    const { transcript } = req.body;

    // Validate non-empty input
    if (!transcript || typeof transcript !== "string" || !transcript.trim()) {
      return res.status(400).json({ error: "Transcript is required and must not be empty" });
    }

    const rawTranscript = transcript.trim();

    // 1. LLM Analysis strictly constrained by learningCaptureAnalysisSchema
    const tLlm = performance.now();
    const analysis = await analyzeTranscript(rawTranscript);
    timings["1. LLM Analysis"] = `${(performance.now() - tLlm).toFixed(0)} ms`;

    // 2. The Bouncer Check: Reject captures marked invalid (e.g. mic test, greetings, noise)
    if (analysis.validityStatus === "invalid") {
      timings["Total Time"] = `${(performance.now() - requestStart).toFixed(0)} ms`;
      console.log("\n⏱️ [Blocked Capture Latency]");
      console.table(timings);

      return res.status(400).json({
        rawTranscript,
        validityStatus: analysis.validityStatus,
        reasonCode: analysis.reasonCode,
        message: "No learning concept detected. Please share a concept, explanation, or doubt.",
        timings,
      });
    }

    // 3. Persistence Pipeline: Save valid learning memories to MongoDB Atlas
    let savedMemory = null;
    if (analysis.validityStatus === "valid") {
      try {
        const tDbSave = performance.now();
        savedMemory = await LearningMemory.create({
          rawTranscript,
          validityStatus: analysis.validityStatus,
          reasonCode: analysis.reasonCode,
          conceptName: analysis.conceptName,
          noteTypes: analysis.noteTypes,
          searchTags: analysis.searchTags,
          concepts: analysis.concepts,
          summary: analysis.summary,
          keyIdeas: analysis.keyIdeas,
          cleanedTranscript: analysis.cleanedTranscript,
          possibleCorrection: analysis.possibleCorrection,
          importantNuance: analysis.importantNuance,
          embeddingStatus: "pending",
        });
        timings["2. Atlas Save"] = `${(performance.now() - tDbSave).toFixed(0)} ms`;

        console.log("✅ Successfully persisted memory to MongoDB Atlas with ID:", savedMemory._id);

        // 4. Generate Embedding & Update Document
        try {
          const textToEmbed = buildEmbeddingText(analysis);
          console.log("Generating NVIDIA Nemotron embedding for:", analysis.conceptName || "Concept");

          const tEmbed = performance.now();
          const vector = await generateEmbedding(textToEmbed, "passage");
          timings["3. NVIDIA Embedding"] = `${(performance.now() - tEmbed).toFixed(0)} ms`;

          const tDbUpdate = performance.now();
          savedMemory.embedding = vector;
          savedMemory.embeddingStatus = "ready";
          await savedMemory.save();
          timings["4. Atlas Vector Update"] = `${(performance.now() - tDbUpdate).toFixed(0)} ms`;

          console.log(`✅ Embedding generated and stored (dimensions: ${vector.length})`);
        } catch (embedError) {
          console.error("⚠️ Embedding generation failed:", embedError.message);
          timings["3. NVIDIA Embedding"] = "FAILED";
          savedMemory.embeddingStatus = "failed";
          await LearningMemory.findByIdAndUpdate(savedMemory._id, {
            embeddingStatus: "failed",
          });
        }
      } catch (dbErr) {
        console.warn("⚠️ Database persistence error:", dbErr.message);
      }
    } else {
      console.log(`ℹ️ Capture marked as '${analysis.validityStatus}' (reason: ${analysis.reasonCode}). Skipping database persistence.`);
    }

    // 5. Total Latency & Terminal Breakdown
    timings["Total Pipeline"] = `${(performance.now() - requestStart).toFixed(0)} ms`;

    console.log("\n⏱️ ===== Pipeline Latency Breakdown =====");
    console.table(timings);
    console.log("=========================================\n");

    // 6. Return response containing raw transcript, validated analysis, and Atlas status
    res.json({
      rawTranscript,
      ...analysis,
      savedToDb: Boolean(savedMemory),
      memoryId: savedMemory ? savedMemory._id : null,
      embeddingStatus: savedMemory ? savedMemory.embeddingStatus : null,
      timings,
    });
  } catch (error) {
    console.error("Note processing error:", error.message);
    res.status(500).json({ error: "Failed to process note" });
  }
});

export default router;

