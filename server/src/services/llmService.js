import Groq from "groq-sdk";
import { learningCaptureAnalysisSchema, SYSTEM_PROMPT } from "../config/schema.js";

let groqClient = null;

function getGroqClient() {
  if (!groqClient) {
    groqClient = new Groq({ apiKey: process.env.GROQ_API_KEY });
  }
  return groqClient;
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

