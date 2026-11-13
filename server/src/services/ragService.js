import { LearningMemory } from "../models/LearningMemory.js";
import { generateEmbedding } from "./embeddingService.js";
import { synthesizeMemoryAnswer } from "./llmService.js";

const DEFAULT_INDEX_NAME = process.env.ATLAS_VECTOR_INDEX || "embeddings";
const DEFAULT_MIN_SCORE = 0.55;

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

/**
 * End-to-end RAG question answering over personal learning memories.
 * Retrieves top matching memories, filters by relevance threshold,
 * and synthesizes an answer strictly grounded in those memories.
 *
 * @param {string} queryText - The question asked by the user.
 * @param {object} [options] - Configuration options.
 * @param {number} [options.limit=5] - Maximum memories to retrieve.
 * @param {number} [options.minScore=0.55] - Minimum cosine similarity threshold to consider relevant.
 * @returns {Promise<object>} The synthesized answer, cited sources, and metadata.
 */
export async function askMemory(queryText, options = {}) {
  const limit = options.limit || 5;
  const minScore = typeof options.minScore === "number" ? options.minScore : DEFAULT_MIN_SCORE;
  const timings = {};

  // 1. Vector Search Retrieval
  const tSearch = performance.now();
  const allResults = await searchSimilarMemories(queryText, { limit });
  timings["1. Vector Retrieval"] = `${(performance.now() - tSearch).toFixed(0)} ms`;

  // 2. Relevance Threshold Filtering
  const relevantMemories = allResults.filter((m) => m.score >= minScore);

  // 3. Early return if no memories meet the threshold
  if (relevantMemories.length === 0) {
    return {
      answer: "Based on your saved memories, you haven't recorded anything about this topic yet.",
      sources: [],
      hasRelevantMemories: false,
      timings,
    };
  }

  // 4. Grounded Synthesis via Groq LLM
  const tSynthesis = performance.now();
  const answer = await synthesizeMemoryAnswer(queryText, relevantMemories);
  timings["2. LLM Synthesis"] = `${(performance.now() - tSynthesis).toFixed(0)} ms`;

  return {
    answer,
    sources: relevantMemories.map((m) => ({
      _id: m._id,
      conceptName: m.conceptName,
      score: Number(m.score.toFixed(4)),
      noteTypes: m.noteTypes,
      summary: m.summary,
      createdAt: m.createdAt,
    })),
    hasRelevantMemories: true,
    timings,
  };
}

