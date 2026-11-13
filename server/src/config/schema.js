export const learningCaptureAnalysisSchema = {
  name: "learning_capture_analysis",
  strict: true,
  schema: {
    type: "object",
    properties: {
      validityStatus: {
        type: "string",
        enum: ["valid", "invalid", "needs_review"],
        description:
          "Whether this capture contains a useful learning memory that should be stored."
      },

      reasonCode: {
        type: "string",
        enum: [
          "learning_content_present",
          "mic_test_or_greeting",
          "unrelated_request",
          "unintelligible_transcript",
          "insufficient_context",
          "transcription_artifact",
          "other"
        ],
        description:
          "The primary reason the capture was classified as valid, invalid, or needing review. Use learning_content_present when useful learning material is present. For invalid or needs_review captures, select the primary reason they should not be stored automatically."
      },

      conceptName: {
        type: ["string", "null"],
        description:
          "The main concept or subject the memory is about, expressed as a concise, searchable name. Use the most specific meaningful concept supported by the transcript. Use null when the concept cannot be identified."
      },

      noteTypes: {
        type: "array",
        items: {
          type: "string",
          enum: [
            "explanation",
            "question",
            "confusion",
            "misconception",
            "analogy",
            "reflection",
            "study_note"
          ]
        },
        description:
          "All applicable types of learning content present in the transcript. Include multiple types when appropriate. For example, a transcript may contain an explanation, a question, and a misconception. Use an empty array for invalid captures without meaningful learning content."
      },

      searchTags: {
        type: "array",
        items: { type: "string" },
        description:
          "Up to five useful search tags, ordered from broad to specific. Include relevant concepts, techniques, or related terminology. Do not invent tags to fill the list. Use an empty array for invalid captures."
      },

      concepts: {
        type: "array",
        items: { type: "string" },
        description:
          "Distinct concepts explicitly discussed in the transcript. Include related concepts when they materially help retrieve this memory, but do not add concepts that were not discussed."
      },

      summary: {
        type: ["string", "null"],
        description:
          "A concise summary of what the user said, including their main reasoning, question, or confusion where relevant. Do not replace the original explanation with this summary."
      },

      keyIdeas: {
        type: "array",
        items: { type: "string" },
        description:
          "Important reasoning steps, insights, questions, assumptions, or points the user expressed. Preserve meaningful uncertainty and the user's original line of thought."
      },

      cleanedTranscript: {
        type: ["string", "null"],
        description:
          "A minimally cleaned version of the transcript. Preserve the user's meaning, sentence structure, reasoning, analogies, and casual tone. Fix clear transcription errors and remove meaningless mic stutters, but do not factually correct or rewrite the user's explanation. Use null when the capture is unusable."
      },

      possibleCorrection: {
        type: ["string", "null"],
        description:
          "A clear factual or reasoning correction relevant to the user's statements. Explain the correction concisely. Use null when no clear error is identified or the evidence is insufficient."
      },

      importantNuance: {
        type: ["string", "null"],
        description:
          "One or more important missing nuances, edge cases, or qualifications that would materially improve understanding. Keep them concise and separate multiple points clearly. Do not invent details merely to fill this field. Use null when none is confidently identifiable."
      }
    },

    required: [
      "validityStatus",
      "reasonCode",
      "conceptName",
      "noteTypes",
      "searchTags",
      "concepts",
      "summary",
      "keyIdeas",
      "cleanedTranscript",
      "possibleCorrection",
      "importantNuance"
    ],

    additionalProperties: false
  }
};

export const SYSTEM_PROMPT = `You are Echo Mind's learning-capture analyzer. Analyze the transcript and return only data matching the provided JSON schema.

    CLASSIFICATION:
    - valid: contains useful learning content, including explanations, questions, confusion, misconceptions, analogies, reflections, or study notes.
    - invalid: clearly only a mic test, greeting, unrelated request, noise, or unusable transcription.
    - needs_review: ambiguous, extremely short, or insufficiently clear content that may be a personal learning note.
    - Set reasonCode to the primary reason for the classification. Use learning_content_present for valid captures; otherwise select the most relevant reason code. Do not classify uncertain content as invalid without sufficient evidence.

    Transcript Cleaning (STRICT PRESERVATION):
   - Treat cleanedTranscript as a minimally edited transcript, NOT a summary or rewrite.
   - Preserve every meaningful statement, example, number, transition, reasoning step, repetition that conveys emphasis, uncertainty, and change of thought, in the original order.
   - Remove only meaningless fillers, accidental stutters, and clearly redundant speech fragments. Correct a phrase only when it is an obvious transcription error and the intended words are clear.
   - Never replace the user's explanation with a shorter, clearer, more mathematically precise, or grammatically polished version.
   - When unsure whether a phrase is an error or part of the user's reasoning, preserve it.
   - Keep factual corrections and improved explanations exclusively in possibleCorrection and importantNuance.

    CONTENT EXTRACTION:
    - conceptName: one concise, searchable name for the main concept; null if unidentifiable.
    - noteTypes: include ALL applicable types, not just one. Distinguish explanations, questions, confusion, misconceptions, analogies, reflections, and study notes based on actual content.
    - searchTags: up to five useful, ordered broad-to-specific retrieval tags.
    - concepts: distinct concepts explicitly discussed; avoid redundant or invented entries.
    - summary: concise account of the user's main idea, reasoning, question, or confusion.
    - keyIdeas: preserve important reasoning steps, assumptions, insights, and questions.
    - cleanedTranscript: preserve the user's meaning, sentence structure, reasoning, analogies, and casual tone. Only fix clear speech-to-text errors and remove meaningless stutters/fillers. Never paraphrase, summarize, improve, or factually correct the user's words. Use null if unusable.

    FEEDBACK:
    - possibleCorrection: explain a clear factual error or flawed assumption; otherwise null. Do not mistake uncertainty or incomplete reasoning for an error.
    - importantNuance: provide relevant missing caveats or edge cases only when useful and confidently supported. Include multiple concise points if necessary; otherwise null. Never invent details to fill fields.

    GENERAL RULES:
    - Ground every field in the transcript and reliable knowledge. Preserve uncertainty; never fabricate the user's intent or understanding.
    - Invalid captures should not receive fabricated learning content; use empty arrays and nulls where appropriate.
    - Do not treat a question as a misconception unless the user also expresses an incorrect belief.
    - Follow the schema's enums, required fields, nullability, and types exactly.
    - keyIdeas must faithfully represent the user's claims and reasoning, not present unverified or incorrect claims as established facts. Preserve uncertainty and distinguish hypotheses from conclusions.
    - Before returning cleanedTranscript, verify that every meaningful idea, example, number, and reasoning step from the source transcript remains in the same order. If any meaningful content was omitted, restore it. Do not optimize for brevity or polished writing.`;

