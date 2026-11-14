import { useState } from "react";
import { useAudioStreaming } from "../hooks/useAudioStreaming";
import { useSpeechSynthesis } from "../hooks/useSpeechSynthesis";
import { askMemory } from "../services/api";
import type { SourceMemory } from "../types";

export function RecallView() {
  const [activeQuery, setActiveQuery] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [sources, setSources] = useState<SourceMemory[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [textInput, setTextInput] = useState("");
  const [queryError, setQueryError] = useState<string | null>(null);

  const {
    isStreaming,
    liveTranscript,
    startStreaming,
    stopStreaming,
  } = useAudioStreaming();

  const { isSpeaking, speak, stop: stopSpeaking } = useSpeechSynthesis();

  const executeQuery = async (questionText: string) => {
    if (!questionText.trim()) return;

    stopSpeaking();
    setQueryError(null);
    setIsSearching(true);
    setActiveQuery(questionText);

    try {
      const response = await askMemory(questionText);
      setAnswer(response.answer);
      setSources(response.sources || []);

      if (response.answer) {
        speak(response.answer);
      }
    } catch (err: any) {
      console.error("Recall query error:", err);
      setQueryError(err.message || "Failed to recall from memory.");
    } finally {
      setIsSearching(false);
    }
  };

  const handleVoiceToggle = async () => {
    if (isSpeaking) {
      stopSpeaking();
      return;
    }

    if (isStreaming) {
      const finalSpokenText = await stopStreaming();
      if (finalSpokenText) {
        await executeQuery(finalSpokenText);
      }
    } else {
      stopSpeaking();
      await startStreaming();
    }
  };

  const handleTextSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (textInput.trim() && !isSearching) {
      const q = textInput.trim();
      setTextInput("");
      executeQuery(q);
    }
  };

  return (
    <div className="recall-container">
      {/* Voice Action Button */}
      <div className="recall-voice-section">
        <button
          className={`btn-voice-recall ${isStreaming ? "listening" : ""} ${isSpeaking ? "speaking" : ""}`}
          onClick={handleVoiceToggle}
          disabled={isSearching}
        >
          {isStreaming ? (
            <>
              <span className="pulse-dot" />
              <span>Listening... Tap to Ask</span>
            </>
          ) : isSpeaking ? (
            <>
              <span className="speaker-icon">🔊</span>
              <span>Speaking... Tap to Stop</span>
            </>
          ) : isSearching ? (
            <span>Searching memory palace...</span>
          ) : (
            <>
              <span className="mic-icon">🎙️</span>
              <span>Ask with Voice</span>
            </>
          )}
        </button>

        {isStreaming && liveTranscript && (
          <p className="recall-live-caption">"{liveTranscript}"</p>
        )}
      </div>

      {queryError && (
        <div className="error-banner">
          <span>{queryError}</span>
          <button className="btn-close" onClick={() => setQueryError(null)}>
            ✕
          </button>
        </div>
      )}

      {/* Answer & Sources Display */}
      {answer && (
        <article className="recall-answer-card">
          <header className="recall-answer-header">
            <span className="recall-badge">Recalled Memory</span>
            {activeQuery && <h3 className="recall-question">"{activeQuery}"</h3>}
          </header>

          <div className="recall-answer-body">
            <p className="answer-text">{answer}</p>
          </div>

          {sources.length > 0 && (
            <footer className="recall-sources">
              <span className="sources-label">Sources Cited:</span>
              <div className="source-pills">
                {sources.map((s) => (
                  <span key={s._id} className="source-pill">
                    📄 {s.conceptName || "Concept"} · {(s.score * 100).toFixed(0)}%
                  </span>
                ))}
              </div>
            </footer>
          )}
        </article>
      )}

      {/* Fallback Text Input */}
      <form className="recall-text-form" onSubmit={handleTextSubmit}>
        <input
          type="text"
          className="recall-input"
          placeholder="Or type a question to recall..."
          value={textInput}
          onChange={(e) => setTextInput(e.target.value)}
          disabled={isSearching || isStreaming}
        />
        <button
          type="submit"
          className="btn-text-submit"
          disabled={!textInput.trim() || isSearching || isStreaming}
        >
          Ask
        </button>
      </form>
    </div>
  );
}

