import { LearningMemory } from "../models/LearningMemory.js";
import { generateEmbedding } from "./embeddingService.js";

const DEFAULT_INDEX_NAME = process.env.ATLAS_VECTOR_INDEX || "embeddings";

/**
 * Searches stored learning memories using MongoDB Atlas Vector Search.
 *
 * @param {string} queryText - The search query text (typed by user or from speech STT).
 * @param {object} [options] - Optional search configuration.
 * @param {number} [options.limit=5] - Number of top relevant memories to retrieve.
 * @param {number} [options.numCandidates=50] - Number of candidates to evaluate in HNSW index.
 * @param {string} [options.indexName] - Atlas vector search index name.
 * @returns {Promise<Array>} Array of matching note objects with similarity scores.
 */
export async function searchSimilarMemories(queryText, options = {}) {
  const limit = options.limit || 5;
  const numCandidates = options.numCandidates || limit * 10;
  const indexName = options.indexName || DEFAULT_INDEX_NAME;

  // 1. Generate dense vector for the query (using asymmetric 'query' type)
  const queryVector = await generateEmbedding(queryText, "query");

  // 2. Execute Atlas $vectorSearch aggregation pipeline
  const pipeline = [
    {
      $vectorSearch: {
        index: indexName,
        path: "embedding",
        queryVector: queryVector,
        numCandidates: numCandidates,
        limit: limit,
      },
    },
    {
      $project: {
        _id: 1,
        conceptName: 1,
        summary: 1,
        keyIdeas: 1,
        cleanedTranscript: 1,
        possibleCorrection: 1,
        importantNuance: 1,
        searchTags: 1,
        concepts: 1,
        noteTypes: 1,
        createdAt: 1,
        score: { $meta: "vectorSearchScore" },
      },
    },
  ];

  const results = await LearningMemory.aggregate(pipeline);
  return results;
}

