import { Router } from "express";
import { searchSimilarMemories } from "../services/ragService.js";

const router = Router();

/**
 * POST /api/search
 * Semantic Vector Search over captured learning memories.
 *
 * Request Body:
 * {
 *   "query": "string (required)",
 *   "limit": 5 (optional, default 5)
 * }
 */
router.post("/search", async (req, res) => {
  const startTime = performance.now();

  try {
    const { query, limit } = req.body;

    if (!query || typeof query !== "string" || !query.trim()) {
      return res.status(400).json({ error: "Query is required and must not be empty" });
    }

    const cleanQuery = query.trim();
    const searchLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 20) : 5;

    const results = await searchSimilarMemories(cleanQuery, { limit: searchLimit });
    const latency = `${(performance.now() - startTime).toFixed(0)} ms`;

    res.json({
      query: cleanQuery,
      count: results.length,
      latency,
      results,
    });
  } catch (error) {
    console.error("Vector search error:", error);

    // Provide friendly diagnostic guidance if Atlas search index is missing
    if (error.message && error.message.includes("Remote search index")) {
      return res.status(500).json({
        error: "Atlas Vector Search Index not found.",
        hint: "Please ensure you have created an Atlas Vector Search index named 'embeddings' (or set ATLAS_VECTOR_INDEX in server/.env) on the 'learningmemories' collection with 2048 dimensions and cosine similarity.",
        details: error.message,
      });
    }

    res.status(500).json({ error: "Failed to perform semantic search", details: error.message });
  }
});

export default router;

