import { useState, useRef, useEffect } from "react";

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

export default function App() {
  const [isStreaming, setIsStreaming] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [liveTranscript, setLiveTranscript] = useState("");
  const [note, setNote] = useState<LearningCaptureNote | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showJson, setShowJson] = useState(false);

  // Audio Context & Streaming Refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const isStreamingRef = useRef<boolean>(false);

  // Real-time Turn Accumulation Refs
  const accumulatedTranscriptRef = useRef<string>("");
  const currentTurnRef = useRef<string>("");

  // Helper: Teardown Audio hardware cleanly without triggering duplicate errors
  const teardownAudioHardware = async () => {
    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.disconnect();
      } catch {}
      sourceNodeRef.current = null;
    }
    if (workletNodeRef.current) {
      workletNodeRef.current.port.onmessage = null;
      try {
        workletNodeRef.current.disconnect();
      } catch {}
      workletNodeRef.current = null;
    }
    if (audioContextRef.current) {
      try {
        await audioContextRef.current.close();
      } catch {}
      audioContextRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  };

  // Unmount Cleanup: Prevent dangling microphone hardware tracks
  useEffect(() => {
    return () => {
      isStreamingRef.current = false;
      teardownAudioHardware();
      if (socketRef.current) {
        socketRef.current.close();
        socketRef.current = null;
      }
    };
  }, []);

  const startStreaming = async () => {
    try {
      setErrorMessage(null);
      setNote(null);
      accumulatedTranscriptRef.current = "";
      currentTurnRef.current = "";
      setLiveTranscript("");
      setStatusMessage("Initializing microphone & audio context...");
      setIsProcessing(true);

      // 1. Critical: Request mic and initialize AudioContext directly in the user click gesture
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const audioContext = new AudioContextClass({ sampleRate: 16000 });
      audioContextRef.current = audioContext;

      // Handle Autoplay state guardrail immediately
      if (audioContext.state === "suspended") {
        await audioContext.resume();
      }

      // 2. Register worklet module and declare sink node with 0 outputs to prevent GC deprioritization
      await audioContext.audioWorklet.addModule("/pcm-processor.js");
      const workletNode = new AudioWorkletNode(audioContext, "pcm-processor", {
        numberOfInputs: 1,
        numberOfOutputs: 0,
      });
      workletNodeRef.current = workletNode;

      // 3. Connect microphone source to worklet sink node
      const source = audioContext.createMediaStreamSource(stream);
      sourceNodeRef.current = source;
      source.connect(workletNode);

      // 4. Fetch single-use temporary token from backend
      setStatusMessage("Connecting to AssemblyAI...");
      const tokenRes = await fetch("http://localhost:5000/api/token");
      if (!tokenRes.ok) {
        const err = await tokenRes.json().catch(() => ({}));
        throw new Error(err.error || `Failed to fetch token (${tokenRes.status})`);
      }
      const { token } = await tokenRes.json();
      if (!token) throw new Error("No token returned by backend");

      // 5. Open direct WebSocket to AssemblyAI v3 at 16000Hz pcm_s16le
      const wsUrl = `wss://streaming.assemblyai.com/v3/ws?sample_rate=16000&encoding=pcm_s16le&token=${token}`;
      const ws = new WebSocket(wsUrl);
      socketRef.current = ws;

      ws.onopen = async () => {
        console.log("Connected to AssemblyAI WebSocket");
        // Extra safeguard: resume AudioContext if browser suspended it during network handshake
        if (audioContextRef.current && audioContextRef.current.state === "suspended") {
          try {
            await audioContextRef.current.resume();
          } catch {}
        }
        setStatusMessage("Listening in real-time...");
        isStreamingRef.current = true;
        setIsStreaming(true);
        setIsProcessing(false);
      };

      // Pipe audio chunks from worklet port to WebSocket
      workletNode.port.onmessage = (event) => {
        if (event.data?.type === "WARN_SAMPLE_RATE") {
          console.warn(`[AudioWorklet Warning] Actual sampleRate is ${event.data.actualSampleRate}Hz (expected 16000Hz)`);
          return;
        }
        if (ws.readyState === WebSocket.OPEN && event.data instanceof ArrayBuffer) {
          ws.send(event.data);
        }
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          // Handle AssemblyAI v3 Turn messages
          if (data.type === "Turn") {
            const turnTranscript = (data.transcript || "").trim();

            if (data.end_of_turn) {
              // Final formatted turn: append to persistent accumulated history
              if (turnTranscript) {
                accumulatedTranscriptRef.current = accumulatedTranscriptRef.current
                  ? `${accumulatedTranscriptRef.current} ${turnTranscript}`
                  : turnTranscript;
              }
              currentTurnRef.current = "";
              setLiveTranscript(accumulatedTranscriptRef.current);
            } else {
              // Partial turn: display persistent history + live interim turn
              currentTurnRef.current = turnTranscript;
              const liveCombined = accumulatedTranscriptRef.current
                ? `${accumulatedTranscriptRef.current} ${turnTranscript}`
                : turnTranscript;
              setLiveTranscript(liveCombined);
            }
          } else if (data.type === "Termination") {
            console.log("AssemblyAI session terminated cleanly by server");
          }
        } catch (err) {
          console.error("Error parsing WebSocket message:", err);
        }
      };

      ws.onerror = (event) => {
        console.error("AssemblyAI WebSocket error:", event);
        setErrorMessage("AssemblyAI WebSocket connection encountered an error.");
        isStreamingRef.current = false;
        teardownAudioHardware();
        setIsStreaming(false);
        setIsProcessing(false);
      };

      ws.onclose = (event) => {
        console.log("AssemblyAI WebSocket closed:", event.code, event.reason);
        // Prevent dangling state if socket closes unexpectedly (using isStreamingRef avoids stale closures)
        if (isStreamingRef.current) {
          isStreamingRef.current = false;
          teardownAudioHardware();
          setIsStreaming(false);
          setIsProcessing(false);
        }
      };
    } catch (err: any) {
      console.error("Start streaming error:", err);
      isStreamingRef.current = false;
      await teardownAudioHardware();
      if (socketRef.current) {
        socketRef.current.close();
        socketRef.current = null;
      }
      setIsStreaming(false);
      setIsProcessing(false);

      // Preserve actual error message without masking
      if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
        setErrorMessage("Microphone access denied: Please allow microphone permission in your browser settings.");
      } else {
        setErrorMessage(err.message || "Failed to start streaming.");
      }
    }
  };

  const stopStreaming = async () => {
    if (!isStreamingRef.current && !isProcessing) return;

    isStreamingRef.current = false;
    setIsStreaming(false);
    setIsProcessing(true);
    setStatusMessage("Flushing audio buffer & waiting for final transcription...");

    // 1. Flush remaining audio from AudioWorklet to prevent clipping tail words
    if (workletNodeRef.current) {
      workletNodeRef.current.port.postMessage("flush");
    }

    // 2. Disconnect mic source so no new audio is recorded, but leave WS open to receive in-flight turns
    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.disconnect();
      } catch {}
      sourceNodeRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    // 3. Send explicit Terminate message to AssemblyAI to flush server-side buffers
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      try {
        socketRef.current.send(JSON.stringify({ type: "Terminate" }));
      } catch {}
    }

    // 4. Graceful wait window (500ms): allow flushed buffer to transit and AssemblyAI to send final formatted turn
    await new Promise((resolve) => setTimeout(resolve, 500));

    // 5. Tear down worklet, audioContext, and WebSocket
    if (workletNodeRef.current) {
      workletNodeRef.current.port.onmessage = null;
      try {
        workletNodeRef.current.disconnect();
      } catch {}
      workletNodeRef.current = null;
    }
    if (audioContextRef.current) {
      try {
        await audioContextRef.current.close();
      } catch {}
      audioContextRef.current = null;
    }
    if (socketRef.current) {
      if (socketRef.current.readyState === WebSocket.OPEN) {
        socketRef.current.close();
      }
      socketRef.current = null;
    }

    // 6. Compute authoritative final transcript cleanly without duplicate partial words
    let finalTranscript = accumulatedTranscriptRef.current.trim();
    if (currentTurnRef.current.trim() && !finalTranscript.endsWith(currentTurnRef.current.trim())) {
      finalTranscript = finalTranscript
        ? `${finalTranscript} ${currentTurnRef.current.trim()}`
        : currentTurnRef.current.trim();
    }
    currentTurnRef.current = "";
    setLiveTranscript(finalTranscript);

    if (!finalTranscript) {
      setErrorMessage("No speech was detected during streaming.");
      setIsProcessing(false);
      return;
    }

    // 7. Send final transcript as JSON to POST /api/process-note
    try {
      setStatusMessage("Analyzing learning concept with Groq LLM...");

      const res = await fetch("http://localhost:5000/api/process-note", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript: finalTranscript }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (data.validityStatus) {
          setNote({ ...data, rawTranscript: finalTranscript });
        }
        throw new Error(data.message || data.error || "Failed to process note");
      }

      // Explicitly merge rawTranscript on the frontend so the raw transcript card is never empty
      setNote({ ...data, rawTranscript: finalTranscript });
      setStatusMessage("");
    } catch (err: any) {
      console.error("Processing error:", err);
      setErrorMessage(err.message || "Failed to process note.");
    } finally {
      setIsProcessing(false);
    }
  };

  const getStatusColor = (status?: string) => {
    switch (status) {
      case "valid":
        return { bg: "rgba(34, 197, 94, 0.15)", text: "#4ade80", border: "rgba(34, 197, 94, 0.3)" };
      case "needs_review":
        return { bg: "rgba(234, 179, 8, 0.15)", text: "#facc15", border: "rgba(234, 179, 8, 0.3)" };
      case "invalid":
        return { bg: "rgba(239, 68, 68, 0.15)", text: "#f87171", border: "rgba(239, 68, 68, 0.3)" };
      default:
        return { bg: "rgba(148, 163, 184, 0.15)", text: "#94a3b8", border: "rgba(148, 163, 184, 0.3)" };
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        backgroundColor: "#090d16",
        color: "#f1f5f9",
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        padding: "40px 20px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
      }}
    >
      <div style={{ maxWidth: "860px", width: "100%" }}>
        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: "32px" }}>
          <div
            style={{
              display: "inline-block",
              padding: "4px 14px",
              borderRadius: "9999px",
              background: "rgba(99, 102, 241, 0.15)",
              color: "#818cf8",
              fontSize: "12px",
              fontWeight: "600",
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              marginBottom: "12px",
              border: "1px solid rgba(99, 102, 241, 0.3)",
            }}
          >
            Echo Mind — Live Voice Learning System
          </div>
          <h1
            style={{
              fontSize: "30px",
              fontWeight: "800",
              margin: "0 0 8px 0",
              background: "linear-gradient(to right, #ffffff, #cbd5e1)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            Real-Time Learning Document Ingestion
          </h1>
          <p style={{ color: "#94a3b8", margin: 0, fontSize: "14px" }}>
            Stream audio in real-time via AssemblyAI v3 AudioWorklet. Watch words appear live, then process into memory.
          </p>
        </div>

        {/* Action Button & Status */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: "28px" }}>
          <button
            onClick={isStreaming ? stopStreaming : startStreaming}
            disabled={isProcessing}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              padding: "16px 36px",
              fontSize: "16px",
              fontWeight: "600",
              borderRadius: "14px",
              border: "none",
              cursor: isProcessing ? "not-allowed" : "pointer",
              transition: "all 0.2s ease",
              background: isStreaming
                ? "linear-gradient(135deg, #ef4444, #dc2626)"
                : isProcessing
                ? "#334155"
                : "linear-gradient(135deg, #6366f1, #4f46e5)",
              color: "#ffffff",
              boxShadow: isStreaming
                ? "0 0 25px rgba(239, 68, 68, 0.45)"
                : "0 4px 20px rgba(99, 102, 241, 0.3)",
            }}
          >
            {isProcessing ? (
              <>⏳ {statusMessage}</>
            ) : isStreaming ? (
              <>🛑 Stop & Process Note</>
            ) : (
              <>🎤 Start Live Streaming</>
            )}
          </button>
        </div>

        {/* Error Warning */}
        {errorMessage && (
          <div
            style={{
              padding: "14px 18px",
              borderRadius: "12px",
              backgroundColor: "rgba(239, 68, 68, 0.1)",
              border: "1px solid rgba(239, 68, 68, 0.3)",
              color: "#fca5a5",
              fontSize: "14px",
              marginBottom: "24px",
              display: "flex",
              alignItems: "center",
              gap: "10px",
            }}
          >
            <span>⚠️</span>
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Live Real-Time Transcription Box */}
        {(isStreaming || liveTranscript) && (
          <div
            style={{
              backgroundColor: "rgba(15, 23, 42, 0.8)",
              border: "1px solid rgba(99, 102, 241, 0.4)",
              borderRadius: "16px",
              padding: "20px 24px",
              marginBottom: "28px",
              boxShadow: isStreaming ? "0 0 20px rgba(99, 102, 241, 0.2)" : "none",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: "10px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span
                  style={{
                    display: "inline-block",
                    width: "8px",
                    height: "8px",
                    borderRadius: "50%",
                    backgroundColor: isStreaming ? "#ef4444" : "#10b981",
                    boxShadow: isStreaming ? "0 0 8px #ef4444" : "none",
                  }}
                />
                <span
                  style={{
                    fontSize: "12px",
                    fontWeight: "700",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    color: isStreaming ? "#f87171" : "#34d399",
                  }}
                >
                  {isStreaming ? "Live Audio Stream (AssemblyAI v3)" : "Captured Transcript"}
                </span>
              </div>
              {isStreaming && (
                <span style={{ fontSize: "11px", color: "#94a3b8" }}>
                  16 kHz Int16 PCM AudioWorklet
                </span>
              )}
            </div>

            <p
              style={{
                margin: 0,
                fontSize: "16px",
                lineHeight: "1.6",
                color: "#f8fafc",
                minHeight: "48px",
                fontStyle: liveTranscript ? "normal" : "italic",
              }}
            >
              {liveTranscript || "Speak into your microphone... words will stream here live."}
            </p>
          </div>
        )}

        {/* Full Document Viewer */}
        {note && (
          <div
            style={{
              backgroundColor: "#111827",
              borderRadius: "20px",
              border: "1px solid #1f293d",
              padding: "32px",
              boxShadow: "0 12px 36px rgba(0, 0, 0, 0.4)",
              display: "flex",
              flexDirection: "column",
              gap: "28px",
            }}
          >
            {/* 1. Header: Concept Name & Status Badges */}
            <div>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px", marginBottom: "12px" }}>
                {/* Validity Status */}
                {note.validityStatus && (
                  <span
                    style={{
                      fontSize: "12px",
                      fontWeight: "700",
                      padding: "4px 12px",
                      borderRadius: "6px",
                      backgroundColor: getStatusColor(note.validityStatus).bg,
                      color: getStatusColor(note.validityStatus).text,
                      border: `1px solid ${getStatusColor(note.validityStatus).border}`,
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                    }}
                  >
                    Status: {note.validityStatus}
                  </span>
                )}

                {/* Reason Code */}
                {note.reasonCode && (
                  <span
                    style={{
                      fontSize: "12px",
                      padding: "4px 10px",
                      borderRadius: "6px",
                      backgroundColor: "#1e293b",
                      color: "#94a3b8",
                      border: "1px solid #334155",
                    }}
                  >
                    Reason: <code>{note.reasonCode}</code>
                  </span>
                )}

                {/* MongoDB Atlas Persistence Badge */}
                {note.savedToDb && note.memoryId && (
                  <span
                    style={{
                      fontSize: "12px",
                      padding: "4px 10px",
                      borderRadius: "6px",
                      backgroundColor: "rgba(16, 185, 129, 0.15)",
                      color: "#34d399",
                      border: "1px solid rgba(16, 185, 129, 0.3)",
                      display: "flex",
                      alignItems: "center",
                      gap: "5px",
                    }}
                    title={`Document ID: ${note.memoryId}`}
                  >
                    <span>🍃</span>
                    <span>Saved to Atlas ({note.memoryId.slice(-6)})</span>
                  </span>
                )}

                {/* Embedding Status Badge */}
                {note.embeddingStatus && (
                  <span
                    style={{
                      fontSize: "12px",
                      padding: "4px 10px",
                      borderRadius: "6px",
                      backgroundColor:
                        note.embeddingStatus === "ready"
                          ? "rgba(168, 85, 247, 0.15)"
                          : note.embeddingStatus === "failed"
                          ? "rgba(245, 158, 11, 0.15)"
                          : "rgba(100, 116, 139, 0.15)",
                      color:
                        note.embeddingStatus === "ready"
                          ? "#c084fc"
                          : note.embeddingStatus === "failed"
                          ? "#fbbf24"
                          : "#94a3b8",
                      border: `1px solid ${
                        note.embeddingStatus === "ready"
                          ? "rgba(168, 85, 247, 0.3)"
                          : note.embeddingStatus === "failed"
                          ? "rgba(245, 158, 11, 0.3)"
                          : "rgba(100, 116, 139, 0.3)"
                      }`,
                      display: "flex",
                      alignItems: "center",
                      gap: "5px",
                    }}
                  >
                    <span>{note.embeddingStatus === "ready" ? "🧠" : note.embeddingStatus === "failed" ? "⚠️" : "⏳"}</span>
                    <span>
                      {note.embeddingStatus === "ready"
                        ? "Vector Embedded (Nemotron)"
                        : note.embeddingStatus === "failed"
                        ? "Embedding Failed"
                        : "Embedding Pending"}
                    </span>
                  </span>
                )}

                {/* Note Types */}
                {note.noteTypes &&
                  note.noteTypes.map((type, idx) => (
                    <span
                      key={idx}
                      style={{
                        fontSize: "12px",
                        padding: "4px 10px",
                        borderRadius: "6px",
                        backgroundColor: "rgba(99, 102, 241, 0.15)",
                        color: "#a5b4fc",
                        border: "1px solid rgba(99, 102, 241, 0.3)",
                      }}
                    >
                      {type}
                    </span>
                  ))}
              </div>

              {/* Concept Name Title */}
              <h2 style={{ fontSize: "28px", fontWeight: "800", margin: "0 0 10px 0", color: "#ffffff" }}>
                {note.conceptName || "(No specific concept detected)"}
              </h2>

              {/* Search Tags */}
              {note.searchTags && note.searchTags.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginTop: "10px" }}>
                  {note.searchTags.map((tag, idx) => (
                    <span
                      key={idx}
                      style={{
                        fontSize: "12px",
                        padding: "4px 10px",
                        borderRadius: "9999px",
                        backgroundColor: "#1e293b",
                        color: "#cbd5e1",
                        border: "1px solid #334155",
                      }}
                    >
                      #{tag}
                    </span>
                  ))}
                </div>
              )}

              {/* Pipeline Latency Benchmark Bar */}
              {note.timings && (
                <div
                  style={{
                    marginTop: "14px",
                    padding: "10px 14px",
                    borderRadius: "10px",
                    backgroundColor: "rgba(15, 23, 42, 0.75)",
                    border: "1px solid rgba(56, 189, 248, 0.25)",
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "12px",
                    alignItems: "center",
                    fontSize: "12px",
                  }}
                >
                  <span style={{ fontWeight: "700", color: "#38bdf8", display: "flex", alignItems: "center", gap: "4px" }}>
                    <span>⚡</span>
                    <span>Pipeline Latency:</span>
                  </span>
                  {Object.entries(note.timings).map(([step, time]) => (
                    <span
                      key={step}
                      style={{
                        padding: "2px 8px",
                        borderRadius: "6px",
                        backgroundColor: step.includes("Total") ? "rgba(250, 204, 21, 0.15)" : "#1e293b",
                        border: `1px solid ${step.includes("Total") ? "rgba(250, 204, 21, 0.3)" : "#334155"}`,
                        color: step.includes("Total") ? "#facc15" : "#cbd5e1",
                        fontSize: "11px",
                      }}
                    >
                      <strong>{step.replace(/^\d+\.\s*/, "")}:</strong> {time}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <hr style={{ border: "none", borderTop: "1px solid #1f2937", margin: 0 }} />

            {/* 2. Side-by-Side Transcripts Comparison */}
            <div>
              <h3 style={{ fontSize: "16px", fontWeight: "700", margin: "0 0 16px 0", color: "#e2e8f0" }}>
                Transcripts Comparison
              </h3>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                {/* Raw Live Transcript */}
                <div
                  style={{
                    backgroundColor: "#0b0f19",
                    padding: "16px 20px",
                    borderRadius: "12px",
                    border: "1px solid #1e293b",
                  }}
                >
                  <div
                    style={{
                      fontSize: "12px",
                      fontWeight: "700",
                      color: "#94a3b8",
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      marginBottom: "8px",
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                    }}
                  >
                    <span>🎙️</span>
                    <span>Raw Live Stream Transcript</span>
                  </div>
                  <p style={{ margin: 0, fontSize: "14px", lineHeight: "1.6", color: "#cbd5e1" }}>
                    {note.rawTranscript || <em>(Empty raw transcript)</em>}
                  </p>
                </div>

                {/* Cleaned Transcript (LLM) */}
                <div
                  style={{
                    backgroundColor: "#0b0f19",
                    padding: "16px 20px",
                    borderRadius: "12px",
                    border: "1px solid #1e293b",
                  }}
                >
                  <div
                    style={{
                      fontSize: "12px",
                      fontWeight: "700",
                      color: "#818cf8",
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      marginBottom: "8px",
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                    }}
                  >
                    <span>✨</span>
                    <span>Cleaned Transcript (No stutters/fillers)</span>
                  </div>
                  <p style={{ margin: 0, fontSize: "14px", lineHeight: "1.6", color: "#e2e8f0" }}>
                    {note.cleanedTranscript ? (
                      `"${note.cleanedTranscript}"`
                    ) : (
                      <em>(No cleaned transcript generated)</em>
                    )}
                  </p>
                </div>
              </div>
            </div>

            {/* 3. Summary & Concepts */}
            {note.summary && (
              <div>
                <div style={{ fontSize: "13px", fontWeight: "600", color: "#94a3b8", marginBottom: "6px" }}>
                  Summary
                </div>
                <div
                  style={{
                    backgroundColor: "#0b0f19",
                    padding: "14px 18px",
                    borderRadius: "12px",
                    border: "1px solid #1e293b",
                    fontSize: "14px",
                    lineHeight: "1.6",
                    color: "#e2e8f0",
                  }}
                >
                  {note.summary}
                </div>
              </div>
            )}

            {/* Concepts Discussed */}
            {note.concepts && note.concepts.length > 0 && (
              <div>
                <div style={{ fontSize: "13px", fontWeight: "600", color: "#94a3b8", marginBottom: "8px" }}>
                  Concepts Discussed
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                  {note.concepts.map((concept, idx) => (
                    <span
                      key={idx}
                      style={{
                        fontSize: "13px",
                        padding: "6px 14px",
                        borderRadius: "8px",
                        backgroundColor: "#1e293b",
                        color: "#e2e8f0",
                        border: "1px solid #334155",
                      }}
                    >
                      💡 {concept}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* 4. Key Ideas */}
            {note.keyIdeas && note.keyIdeas.length > 0 && (
              <div>
                <div style={{ fontSize: "13px", fontWeight: "600", color: "#94a3b8", marginBottom: "8px" }}>
                  Key Ideas & Reasoning Steps
                </div>
                <ul
                  style={{
                    margin: 0,
                    paddingLeft: "20px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px",
                    color: "#cbd5e1",
                    fontSize: "14px",
                    lineHeight: "1.6",
                  }}
                >
                  {note.keyIdeas.map((idea, idx) => (
                    <li key={idx}>{idea}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* 5. Feedback: Possible Correction & Important Nuance */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
              {/* Possible Correction */}
              <div
                style={{
                  backgroundColor: note.possibleCorrection ? "rgba(239, 68, 68, 0.08)" : "rgba(34, 197, 94, 0.06)",
                  border: `1px solid ${note.possibleCorrection ? "rgba(239, 68, 68, 0.25)" : "rgba(34, 197, 94, 0.2)"}`,
                  padding: "16px 20px",
                  borderRadius: "14px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    color: note.possibleCorrection ? "#f87171" : "#4ade80",
                    fontWeight: "700",
                    fontSize: "14px",
                    marginBottom: "6px",
                  }}
                >
                  <span>{note.possibleCorrection ? "🔍" : "✅"}</span>
                  <span>Possible Correction</span>
                </div>
                <p style={{ margin: 0, fontSize: "14px", lineHeight: "1.6", color: "#e2e8f0" }}>
                  {note.possibleCorrection || "No factual or reasoning misconceptions detected."}
                </p>
              </div>

              {/* Important Nuance */}
              <div
                style={{
                  backgroundColor: note.importantNuance ? "rgba(245, 158, 11, 0.08)" : "rgba(148, 163, 184, 0.06)",
                  border: `1px solid ${note.importantNuance ? "rgba(245, 158, 11, 0.25)" : "rgba(148, 163, 184, 0.2)"}`,
                  padding: "16px 20px",
                  borderRadius: "14px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    color: note.importantNuance ? "#fbbf24" : "#94a3b8",
                    fontWeight: "700",
                    fontSize: "14px",
                    marginBottom: "6px",
                  }}
                >
                  <span>💡</span>
                  <span>Important Nuances & Edge Cases</span>
                </div>
                <p style={{ margin: 0, fontSize: "14px", lineHeight: "1.6", color: "#e2e8f0" }}>
                  {note.importantNuance || "No critical omitted nuances identified."}
                </p>
              </div>
            </div>

            {/* 6. Raw JSON Inspector */}
            <div style={{ marginTop: "12px", borderTop: "1px solid #1f2937", paddingTop: "20px" }}>
              <button
                onClick={() => setShowJson(!showJson)}
                style={{
                  background: "transparent",
                  border: "1px solid #334155",
                  color: "#94a3b8",
                  padding: "8px 16px",
                  borderRadius: "8px",
                  fontSize: "12px",
                  fontWeight: "600",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                <span>{showJson ? "▼" : "▶"}</span>
                <span>{showJson ? "Hide Full JSON Document" : "Show Full JSON Document (Testing)"}</span>
              </button>

              {showJson && (
                <pre
                  style={{
                    marginTop: "14px",
                    backgroundColor: "#070a12",
                    padding: "18px",
                    borderRadius: "12px",
                    border: "1px solid #1e293b",
                    fontSize: "12px",
                    lineHeight: "1.5",
                    color: "#38bdf8",
                    overflowX: "auto",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >
                  {JSON.stringify(note, null, 2)}
                </pre>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
