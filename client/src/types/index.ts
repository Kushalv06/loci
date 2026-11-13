export interface LearningCaptureNote {
  rawTranscript: string;
  validityStatus: "valid" | "invalid" | "needs_review";
  reasonCode: string;
  conceptName: string | null;
  noteTypes: string[];
  searchTags: string[];
  concepts: string[];
  summary: string | null;
  keyIdeas: string[];
  cleanedTranscript: string | null;
  possibleCorrection: string | null;
  importantNuance: string | null;
  savedToDb?: boolean;
  memoryId?: string | null;
  embeddingStatus?: "pending" | "ready" | "failed" | null;
  timings?: Record<string, string>;
}

export interface SourceMemory {
  _id: string;
  conceptName: string | null;
  score: number;
  noteTypes: string[];
  summary: string | null;
  createdAt?: string;
}

export interface AskResponse {
  query: string;
  answer: string;
  hasRelevantMemories: boolean;
  sourceCount: number;
  sources: SourceMemory[];
  timings?: Record<string, string>;
}
