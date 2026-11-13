import OpenAI from "openai";

let nvidiaClient = null;

function getNvidiaClient() {
  if (!nvidiaClient) {
    nvidiaClient = new OpenAI({
      apiKey: process.env.NVIDIA_API_KEY,
      baseURL: "https://integrate.api.nvidia.com/v1",
    });
  }
  return nvidiaClient;
}

/**
 * Generate a dense vector embedding using NVIDIA Nemotron.
 *
 * @param {string} text - The input passage or query text.
 * @param {"passage" | "query"} [inputType="passage"] - Asymmetric type: "passage" when storing notes, "query" when searching.
 * @returns {Promise<number[]>} The resulting float vector embedding.
 */
export async function generateEmbedding(text, inputType = "passage") {
  const nvidia = getNvidiaClient();

  const response = await nvidia.embeddings.create({
    model: "nvidia/nemotron-3.5-embed-1b",
    input: [text],
    encoding_format: "float",
    input_type: inputType,
    truncate: "NONE",
  });

  return response.data[0].embedding;
}

/**
 * Construct one meaningful semantic text block from the learning memory fields.
 * Avoids embedding raw JSON syntax, and structures fields into a natural language representation.
 *
 * @param {object} analysis - The structured analysis object.
 * @returns {string} Clean, rich text ready for embedding.
 */
export function buildEmbeddingText(analysis) {
  const sections = [];

  if (analysis.conceptName) {
    sections.push(`Concept: ${analysis.conceptName}`);
  }

  if (analysis.summary) {
    sections.push(`Summary: ${analysis.summary}`);
  }

  if (analysis.keyIdeas && analysis.keyIdeas.length > 0) {
    sections.push(`Key Ideas:\n- ${analysis.keyIdeas.join("\n- ")}`);
  }

  if (analysis.cleanedTranscript) {
    sections.push(`Explanation: ${analysis.cleanedTranscript}`);
  }

  if (analysis.importantNuance) {
    sections.push(`Important Nuances: ${analysis.importantNuance}`);
  }

  if (analysis.searchTags && analysis.searchTags.length > 0) {
    sections.push(`Search Tags: ${analysis.searchTags.join(", ")}`);
  }

  return sections.join("\n\n");
}

