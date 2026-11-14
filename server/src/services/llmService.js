import Groq from "groq-sdk";
import { learningCaptureAnalysisSchema, SYSTEM_PROMPT } from "../config/schema.js";

let groqClient = null;

function getGroqClient() {
  if (!groqClient) {
    groqClient = new Groq({ apiKey: process.env.GROQ_API_KEY });
  }
  return groqClient;
}

const STRICT_MEMORY_SYSTEM_PROMPT = `You are Loci, the user's personal memory recall assistant.

Your role is to answer the user's question directly, accurately, and concisely using only their recorded learning memories.

CORE PRINCIPLES:
1. Pure Signal, ZERO Meta-Talk (CRITICAL):
   - Answer the question directly.
   - DO NOT include introductory or attribution phrases like "In your notes", "You recorded that", "According to your notes", "Your memory shows", or "You noted".
   - Jump straight into the factual answer without preamble or meta-framing.

2. Minimal & Direct (NO Bloat or Long Summaries):
   - Answer directly in 1 to 3 concise spoken sentences.
   - Do NOT summarize or re-explain the entire concept from scratch.
   - Focus strictly on the specific answer, nuance, or correction requested.

3. TTS-Optimized Spoken Text:
   - Output plain spoken prose suitable for text-to-speech.
   - Absolutely NO markdown: no asterisks, no bolding, no bullet points, no dashes, no headers, no code fences.
   - Speak formulas and complexity in natural words (e.g. "O of log n", "low plus high minus low over two").
   - Clean punctuation for natural vocal pauses.

4. Strict Grounding:
   - Ground strictly in the provided memories. Do not invent facts.
   - If the answer is not in the memories, state simply: "Not recorded in your notes."`;

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

