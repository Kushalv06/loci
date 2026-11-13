import type { LearningCaptureNote, AskResponse } from "../types";

const API_BASE = "http://localhost:5000/api";

/**
 * Fetch a temporary single-use streaming token for AssemblyAI v3.
 */
export async function getStreamingToken(): Promise<string> {
  const res = await fetch(`${API_BASE}/token`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to fetch token (${res.status})`);
  }
  const data = await res.json();
  if (!data.token) {
    throw new Error("No token returned by backend");
  }
  return data.token;
}

/**
 * Send final speech transcript to backend for Groq LLM analysis,
 * MongoDB Atlas storage, and vector embedding.
 */
export async function processNote(transcript: string): Promise<LearningCaptureNote> {
  const res = await fetch(`${API_BASE}/process-note`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transcript }),
  });

  const data = await res.json();

  if (!res.ok) {
    const errorNote: LearningCaptureNote = {
      rawTranscript: transcript,
      validityStatus: data.validityStatus || "invalid",
      reasonCode: data.reasonCode || "processing_error",
      conceptName: null,
      noteTypes: [],
      searchTags: [],
      concepts: [],
      summary: null,
      keyIdeas: [],
      cleanedTranscript: null,
      possibleCorrection: null,
      importantNuance: null,
      timings: data.timings,
    };
    const err = new Error(data.message || data.error || "Failed to process note");
    (err as any).data = errorNote;
    throw err;
  }

  return { ...data, rawTranscript: transcript };
}

/**
 * Query the user's memories using grounded RAG (POST /api/ask).
 */
export async function askMemory(query: string, limit = 5, minScore = 0.55): Promise<AskResponse> {
  const res = await fetch(`${API_BASE}/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, limit, minScore }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || "Failed to query memories");
  }
  return data;
}
