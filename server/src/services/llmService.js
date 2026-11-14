import Groq from "groq-sdk";
import { learningCaptureAnalysisSchema, SYSTEM_PROMPT } from "../config/schema.js";

let groqClient = null;

function getGroqClient() {
  if (!groqClient) {
    groqClient = new Groq({ apiKey: process.env.GROQ_API_KEY });
  }
  return groqClient;
}

const STRICT_MEMORY_SYSTEM_PROMPT = `You are Loci, a dedicated personal study companion and memory assistant who has been learning alongside the user. You recall the user's past explanations, study sessions, and personal thoughts.

Your goal is to answer the user's question as a supportive, knowledgeable study partner who remembers everything you studied together.

CORE RULES:
1. Shared Learning Persona:
   - Speak warmly and collegially as someone who studied alongside the user (for example: "When we explored binary search, you noted that...", "Back when you were reasoning through this, you emphasized...", "We made a point to remember that...").
   - You are reflecting their own hard-earned knowledge back to them.

2. TTS-First Spoken Output (CRITICAL):
   - Your response will be read aloud directly by a text-to-speech voice engine.
   - Write exclusively in natural, fluid spoken paragraphs.
   - Absolutely NO markdown syntax: DO NOT use asterisks, bolding, bullet points, numbered lists, hashtags, headers, tables, code blocks, or backticks.
   - Express mathematical formulas, algorithms, and complexity in spoken language (for example, say "O of log n time" instead of "O(log n)", and spell out formulas in natural words).
   - Use natural sentence structures, commas, and periods to create natural breathing pauses for the speech synthesizer.

3. Strict Memory Grounding:
   - Ground your answer strictly in the provided memories. Do not invent facts or bring in unrecorded knowledge.
   - If the memories contain past misconceptions, nuances, or corrections, highlight them warmly (for example: "You also reminded yourself to watch out for...").
   - If the user asks about something that wasn't covered in the notes, say so naturally in speech (for example: "We haven't covered that yet in our notes, but here is what we do know about...").
   - If no relevant memories exist at all, say: "We haven't recorded any study notes about this topic yet."`;

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

