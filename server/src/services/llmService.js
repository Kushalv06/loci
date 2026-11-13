import Groq from "groq-sdk";
import { learningCaptureAnalysisSchema, SYSTEM_PROMPT } from "../config/schema.js";

let groqClient = null;

function getGroqClient() {
  if (!groqClient) {
    groqClient = new Groq({ apiKey: process.env.GROQ_API_KEY });
  }
  return groqClient;
}

const STRICT_MEMORY_SYSTEM_PROMPT = `You are Loci, the user's personal external memory recall assistant.
Your task is to answer the user's question STRICTLY and EXCLUSIVELY based on their retrieved learning memories provided below.

RULES:
1. Strict Grounding: Use ONLY facts, reasoning, conclusions, and study notes present in the provided memories. Do NOT introduce external facts or assumptions.
2. Incomplete Coverage: If the retrieved memories only partially cover the question, answer what your memories say, and explicitly state what is missing or unrecorded in the notes.
3. Highlighting Misconceptions & Corrections: If a retrieved memory includes a "Correction" or "Key Nuance", make sure to highlight it so the user is reminded of their past reasoning mistakes or edge cases.
4. Voice & Tone: Direct, concise, and helpful. Address the user as their reflective second brain (e.g., "In your notes on Binary Search Tree, you noted that...").
5. Missing Information: If the provided memories do not contain the answer, state clearly: "Based on your saved memories, you haven't recorded anything about this topic yet."`;

/**
 * Builds a clean, readable text block from retrieved memory documents for LLM context.
 *
 * @param {Array} memories - The retrieved LearningMemory documents with scores.
 * @returns {string} Formatted context block.
 */
export function buildContextFromMemories(memories) {
  return memories
    .map((m, index) => {
      const parts = [`### Memory ${index + 1}: ${m.conceptName || "Untitled Concept"} (Relevance: ${(m.score * 100).toFixed(1)}%)`];
      if (m.noteTypes?.length) parts.push(`Type: ${m.noteTypes.join(", ")}`);
      if (m.summary) parts.push(`Summary: ${m.summary}`);
      if (m.keyIdeas?.length) parts.push(`Key Ideas:\n- ${m.keyIdeas.join("\n- ")}`);
      if (m.cleanedTranscript) parts.push(`What you said: "${m.cleanedTranscript}"`);
      if (m.possibleCorrection) parts.push(`⚠️ Correction recorded: ${m.possibleCorrection}`);
      if (m.importantNuance) parts.push(`💡 Key nuance: ${m.importantNuance}`);
      return parts.join("\n");
    })
    .join("\n\n---\n\n");
}

/**
 * Synthesizes a grounded answer from retrieved memories using Groq LLM (Strict Memory Mode).
 *
 * @param {string} query - The user's question.
 * @param {Array} memories - Retrieved memory objects with similarity scores.
 * @returns {Promise<string>} The synthesized answer text.
 */
export async function synthesizeMemoryAnswer(query, memories) {
  const groq = getGroqClient();
  const context = buildContextFromMemories(memories);

  const response = await groq.chat.completions.create({
    model: "openai/gpt-oss-120b",
    temperature: 0.2,
    messages: [
      {
        role: "system",
        content: STRICT_MEMORY_SYSTEM_PROMPT,
      },
      {
        role: "user",
        content: `RETRIEVED MEMORIES FROM YOUR SECOND BRAIN:\n\n${context}\n\nUSER QUESTION:\n${query}`,
      },
    ],
  });

  return response.choices[0].message.content;
}

/**
 * Analyzes a raw speech transcript using Groq LLM strictly constrained by the learningCaptureAnalysisSchema.
 *
 * @param {string} rawTranscript - The user's spoken transcript.
 * @returns {Promise<object>} The parsed JSON analysis object.
 */
export async function analyzeTranscript(rawTranscript) {
  const groq = getGroqClient();

  const brainResponse = await groq.chat.completions.create({
    model: "openai/gpt-oss-120b",
    response_format: {
      type: "json_schema",
      json_schema: learningCaptureAnalysisSchema,
    },
    messages: [
      {
        role: "system",
        content: SYSTEM_PROMPT,
      },
      {
        role: "user",
        content: rawTranscript,
      },
    ],
  });

  return JSON.parse(brainResponse.choices[0].message.content);
}

