import { useState } from "react";
import { useAudioStreaming } from "./hooks/useAudioStreaming";
import { processNote } from "./services/api";
import type { LearningCaptureNote } from "./types";
import { Header } from "./components/Header";
import { AudioControls } from "./components/AudioControls";
import { LiveTranscript } from "./components/LiveTranscript";
import { NoteCard } from "./components/NoteCard";
import { RecallView } from "./components/RecallView";
import "./App.css";

export default function App() {
  const [activeTab, setActiveTab] = useState<"capture" | "recall">("capture");
  const [note, setNote] = useState<LearningCaptureNote | null>(null);
  const [isProcessingNote, setIsProcessingNote] = useState(false);
  const [processError, setProcessError] = useState<string | null>(null);

  const {
    isStreaming,
    isProcessing: isStreamingProcessing,
    recordingSeconds,
    statusMessage,
    liveTranscript,
    errorMessage: audioError,
    startStreaming,
    stopStreaming,
    clearError,
  } = useAudioStreaming();

  const handleStart = async () => {
    setProcessError(null);
    setNote(null);
    clearError();
    await startStreaming();
  };

  const handleStop = async () => {
    const finalTranscript = await stopStreaming();
    if (!finalTranscript) return;

    try {
      setIsProcessingNote(true);
      const analyzedNote = await processNote(finalTranscript);
      setNote(analyzedNote);
    } catch (err: any) {
      console.error("Note processing error:", err);
      if (err.data) {
        setNote(err.data);
      }
      setProcessError(err.message || "Failed to process learning note.");
    } finally {
      setIsProcessingNote(false);
    }
  };

  const currentError = audioError || processError;

  return (
    <div className="app-container">
      <Header
        activeTab={activeTab}
        onTabChange={setActiveTab}
        statusText={isStreaming ? "Streaming" : "Ready"}
      />

      {currentError && (
        <div className="error-banner">
          <span>{currentError}</span>
          <button
            className="btn-close"
            onClick={() => {
              clearError();
              setProcessError(null);
            }}
          >
            ✕
          </button>
        </div>
      )}

      {activeTab === "capture" ? (
        <main>
          <AudioControls
            isStreaming={isStreaming}
            isProcessing={isStreamingProcessing || isProcessingNote}
            recordingSeconds={recordingSeconds}
            statusMessage={
              isProcessingNote
                ? "Analyzing concept with Groq & embedding..."
                : statusMessage
            }
            onStart={handleStart}
            onStop={handleStop}
          />

          <LiveTranscript
            transcript={liveTranscript}
            isStreaming={isStreaming}
          />

          {note && <NoteCard note={note} />}
        </main>
      ) : (
        <RecallView />
      )}
    </div>
  );
}
