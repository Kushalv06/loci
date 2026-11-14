import { useState, useRef, useEffect, useCallback } from "react";
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

  const { isSpeaking, speak, stop: stopSpeaking } = useSpeechSynthesis();

  const isSpeakingRef = useRef(false);
  isSpeakingRef.current = isSpeaking;

  const isSearchingRef = useRef(false);
  isSearchingRef.current = isSearching;

  const executeQuery = useCallback(
    async (questionText: string) => {
      const clean = questionText.trim();
      if (!clean || isSearchingRef.current) return;

      stopSpeaking();
      setQueryError(null);
      setIsSearching(true);
      setActiveQuery(clean);

      try {
        const response = await askMemory(clean);
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
    },
    [speak, stopSpeaking]
  );

  // Hands-free barge-in: the instant the user speaks, interrupt Loci immediately
  const handleSpeechDetected = useCallback(() => {
    if (isSpeakingRef.current) {
      stopSpeaking();
    }
  }, [stopSpeaking]);

  // Hands-free turn completion: when user finishes speaking, auto-trigger query
  const handleTurnComplete = useCallback(
    (transcript: string) => {
      if (transcript.trim() && !isSearchingRef.current) {
        executeQuery(transcript.trim());
      }
    },
    [executeQuery]
  );

  const {
    isStreaming,
    liveTranscript,
    startStreaming,
    stopStreaming,
  } = useAudioStreaming({
    onSpeechDetected: handleSpeechDetected,
    onTurnComplete: handleTurnComplete,
  });

  const handleLiveToggle = async () => {
    if (isStreaming) {
      stopSpeaking();
      await stopStreaming();
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

  // Teardown speech when component unmounts
  useEffect(() => {
    return () => {
      stopSpeaking();
    };
  }, [stopSpeaking]);

  return (
    <div className="recall-container">
      {/* Live Voice Section */}
      <div className="recall-voice-section">
        <button
          className={`btn-voice-recall ${isStreaming ? "listening" : ""} ${isSpeaking ? "speaking" : ""}`}
          onClick={handleLiveToggle}
        >
          {isStreaming ? (
            isSpeaking ? (
              <>
                <span className="speaker-icon">🔊</span>
                <span>Speaking... (Speak to Interrupt)</span>
              </>
            ) : isSearching ? (
              <>
                <span className="pulse-dot" />
                <span>Searching memories...</span>
              </>
            ) : (
              <>
                <span className="pulse-dot" />
                <span>Listening... (Speak anytime)</span>
              </>
            )
          ) : (
            <>
              <span className="mic-icon">🎙️</span>
              <span>Start Live Interaction</span>
            </>
          )}
        </button>

        {isStreaming && (
          <div className="live-sub-bar">
            {liveTranscript ? (
              <p className="recall-live-caption">"{liveTranscript}"</p>
            ) : (
              <p className="recall-live-caption muted">
                {isSpeaking ? "Loci is answering... speak to barge in." : "Listening for your question..."}
              </p>
            )}
            <button className="btn-stop-live" onClick={handleLiveToggle}>
              End Live Session
            </button>
          </div>
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
          disabled={isSearching}
        />
        <button
          type="submit"
          className="btn-text-submit"
          disabled={!textInput.trim() || isSearching}
        >
          Ask
        </button>
      </form>
    </div>
  );
}
