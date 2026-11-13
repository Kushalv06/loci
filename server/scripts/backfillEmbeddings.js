import dotenv from "dotenv";
import mongoose from "mongoose";
import { connectDB } from "../src/config/db.js";
import { LearningMemory } from "../src/models/LearningMemory.js";
import { buildEmbeddingText, generateEmbedding } from "../src/services/embeddingService.js";

// Load server/.env reliably regardless of current working directory
dotenv.config({ path: new URL("../.env", import.meta.url) });

const TARGET_DIMENSIONS = 2048;

async function backfillEmbeddings() {
  let updatedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  try {
    await connectDB();

    const docs = await LearningMemory.find({ validityStatus: "valid" });
    const toBackfill = docs.filter(
      (doc) =>
        !Array.isArray(doc.embedding) ||
        doc.embedding.length !== TARGET_DIMENSIONS ||
        doc.embeddingStatus !== "ready"
    );

    console.log(`Found ${docs.length} valid memories (${toBackfill.length} need ${TARGET_DIMENSIONS}-dim backfill).`);

    for (const doc of toBackfill) {
      const label = doc.conceptName || doc._id.toString();
      const prevLen = Array.isArray(doc.embedding) ? doc.embedding.length : "none";

      try {
        const textToEmbed = buildEmbeddingText(doc);
        if (!textToEmbed.trim()) {
          console.warn(`⚠️ Skipping "${label}" (${doc._id}): empty embedding text`);
          skippedCount++;
          continue;
        }

        console.log(`⏳ Re-embedding "${label}" (previous: ${prevLen}, status: ${doc.embeddingStatus})...`);
        const vector = await generateEmbedding(textToEmbed, "passage");

        if (!Array.isArray(vector) || vector.length !== TARGET_DIMENSIONS) {
          throw new Error(`Expected ${TARGET_DIMENSIONS} dimensions, got ${vector?.length}`);
        }

        doc.embedding = vector;
        doc.embeddingStatus = "ready";
        await doc.save();

        console.log(`✅ Updated "${label}" -> ${vector.length} dims (ready)`);
        updatedCount++;
      } catch (err) {
        console.error(`❌ Failed "${label}" (${doc._id}): ${err.message}`);
        failedCount++;
      }
    }

    console.log(`\nBackfill complete: ${updatedCount} updated, ${skippedCount} skipped, ${failedCount} failed.`);
  } finally {
    await mongoose.disconnect();
  }
}

backfillEmbeddings().catch((err) => {
  console.error("❌ Fatal backfill error:", err.message);
  process.exit(1);
});

