import { useState, useRef, useEffect, useCallback } from "react";
import { getStreamingToken } from "../services/api";

export interface UseAudioStreamingReturn {
  isStreaming: boolean;
  isProcessing: boolean;
  recordingSeconds: number;
  statusMessage: string;
  liveTranscript: string;
  errorMessage: string | null;
  startStreaming: () => Promise<void>;
  stopStreaming: () => Promise<string | null>;
  resetTranscript: () => void;
  clearError: () => void;
}

export interface AudioStreamingOptions {
  onTurnComplete?: (transcript: string) => void;
  onSpeechDetected?: () => void;
}

// Resolve on acknowledgement, cancellation, or a bounded timeout.
function completionSignal(timeoutMs: number) {
  let complete!: (success: boolean) => void;
  const promise = new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => complete(false), timeoutMs);
    complete = (success) => {
      clearTimeout(timer);
      resolve(success);
    };
  });
  return { promise, complete };
}

export function useAudioStreaming(options?: AudioStreamingOptions): UseAudioStreamingReturn {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const [isStreaming, setIsStreaming] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [statusMessage, setStatusMessage] = useState("");
  const [liveTranscript, setLiveTranscript] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Audio Context & Hardware Refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const isStreamingRef = useRef<boolean>(false);

  const mountedRef = useRef(false);
  const generationRef = useRef(0);
  const busyRef = useRef(false);
  const stoppingRef = useRef(false);
  const flushCompleteRef = useRef<((success: boolean) => void) | null>(null);
  const terminationCompleteRef = useRef<((success: boolean) => void) | null>(null);

  // Turn Accumulation Refs
  const accumulatedTranscriptRef = useRef<string>("");
  const currentTurnRef = useRef<string>("");
  const timerIntervalRef = useRef<number | null>(null);

  const clearTimer = () => {
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
  };

  // Teardown Web Audio hardware cleanly without triggering duplicate errors
  const teardownAudioHardware = useCallback(async () => {
    clearTimer();
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
    const audioContext = audioContextRef.current;
    audioContextRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (audioContext) {
      try {
        await audioContext.close();
      } catch {}
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      busyRef.current = false;
      flushCompleteRef.current?.(false);
      terminationCompleteRef.current?.(false);
      isStreamingRef.current = false;
      teardownAudioHardware();
      if (socketRef.current) {
        socketRef.current.close();
        socketRef.current = null;
      }
    };
  }, [teardownAudioHardware]);

  const startStreaming = useCallback(async () => {
    if (!mountedRef.current || busyRef.current || stoppingRef.current) return;
    busyRef.current = true;
    const generation = ++generationRef.current;
    const isCurrent = () => mountedRef.current && generationRef.current === generation;
    try {
      setErrorMessage(null);
      accumulatedTranscriptRef.current = "";
      currentTurnRef.current = "";
      setLiveTranscript("");
      setRecordingSeconds(0);
      setStatusMessage("Initializing microphone & audio context...");
      setIsProcessing(true);

      // 1. Request microphone permission with hardware echo cancellation for hands-free interaction
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      if (!isCurrent()) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;

      // 2. Initialize 16kHz AudioContext
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const audioContext = new AudioContextClass({ sampleRate: 16000 });
      audioContextRef.current = audioContext;

      if (audioContext.state === "suspended") {
        await audioContext.resume();
        if (!isCurrent()) return;
      }

      // 3. Register PCM processor worklet
      await audioContext.audioWorklet.addModule("/pcm-processor.js");
      if (!isCurrent()) return;
      const workletNode = new AudioWorkletNode(audioContext, "pcm-processor", {
        numberOfInputs: 1,
        numberOfOutputs: 0,
      });
      workletNodeRef.current = workletNode;

      // 4. Connect microphone source to worklet sink node
      const source = audioContext.createMediaStreamSource(stream);
      sourceNodeRef.current = source;
      source.connect(workletNode);

      // 5. Fetch streaming token from backend
      setStatusMessage("Connecting to AssemblyAI...");
      const token = await getStreamingToken();
      if (!isCurrent()) return;

      // 6. Open direct WebSocket to AssemblyAI v3
      const wsUrl = `wss://streaming.assemblyai.com/v3/ws?sample_rate=16000&encoding=pcm_s16le&token=${token}`;
      const ws = new WebSocket(wsUrl);
      socketRef.current = ws;

      ws.onopen = async () => {
        if (!isCurrent()) return;
        if (audioContextRef.current && audioContextRef.current.state === "suspended") {
          try {
            await audioContextRef.current.resume();
          } catch {}
        }
        if (!isCurrent()) return;
        setStatusMessage("Listening in real-time...");
        isStreamingRef.current = true;
        setIsStreaming(true);
        setIsProcessing(false);

        // Start elapsed seconds timer
        clearTimer();
        timerIntervalRef.current = window.setInterval(() => {
          setRecordingSeconds((prev) => prev + 1);
        }, 1000);
      };

      // Pipe Int16 PCM chunks from worklet to WebSocket
      workletNode.port.onmessage = (event) => {
        if (!isCurrent()) return;
        if (event.data?.type === "FLUSH_COMPLETE") {
          flushCompleteRef.current?.(true);
          return;
        }
        if (event.data?.type === "WARN_SAMPLE_RATE") {
          console.warn(`[AudioWorklet Warning] Sample rate is ${event.data.actualSampleRate}Hz (expected 16000Hz)`);
          return;
        }
        if (ws.readyState === WebSocket.OPEN && event.data instanceof ArrayBuffer) {
          ws.send(event.data);
        }
      };

      ws.onmessage = (event) => {
        if (!isCurrent()) return;
        try {
          const data = JSON.parse(event.data);
          if (data.type === "Termination") {
            terminationCompleteRef.current?.(true);
          } else if (data.type === "Turn") {
            const turnTranscript = (data.transcript || "").trim();

            if (data.end_of_turn) {
              if (turnTranscript) {
                accumulatedTranscriptRef.current = accumulatedTranscriptRef.current
                  ? `${accumulatedTranscriptRef.current} ${turnTranscript}`
                  : turnTranscript;
                optionsRef.current?.onTurnComplete?.(turnTranscript);
              }
              currentTurnRef.current = "";
              setLiveTranscript(accumulatedTranscriptRef.current);
            } else {
              if (turnTranscript) {
                optionsRef.current?.onSpeechDetected?.();
              }
              currentTurnRef.current = turnTranscript;
              const liveCombined = accumulatedTranscriptRef.current
                ? `${accumulatedTranscriptRef.current} ${turnTranscript}`
                : turnTranscript;
              setLiveTranscript(liveCombined);
            }
          }
        } catch (err) {
          console.error("Error parsing WebSocket message:", err);
        }
      };

      ws.onerror = (event) => {
        if (!isCurrent()) return;
        terminationCompleteRef.current?.(false);
        if (stoppingRef.current) return;
        busyRef.current = false;
        generationRef.current += 1;
        ws.close();
        if (socketRef.current === ws) socketRef.current = null;
        console.error("AssemblyAI WebSocket error:", event);
        setErrorMessage("AssemblyAI connection encountered an error.");
        isStreamingRef.current = false;
        teardownAudioHardware();
        setIsStreaming(false);
        setIsProcessing(false);
      };

      ws.onclose = () => {
        if (!isCurrent()) return;
        terminationCompleteRef.current?.(false);
        if (stoppingRef.current) return;
        busyRef.current = false;
        generationRef.current += 1;
        if (isStreamingRef.current || socketRef.current === ws) {
          isStreamingRef.current = false;
          teardownAudioHardware();
          setIsStreaming(false);
          setIsProcessing(false);
        }
      };
    } catch (err: any) {
      if (!isCurrent()) return;
      console.error("Start streaming error:", err);
      isStreamingRef.current = false;
      await teardownAudioHardware();
      if (socketRef.current) {
        socketRef.current.close();
        socketRef.current = null;
      }
      if (!isCurrent()) return;
      busyRef.current = false;
      setIsStreaming(false);
      setIsProcessing(false);

      if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
        setErrorMessage("Microphone access denied: please allow microphone permission in your browser.");
      } else {
        setErrorMessage(err.message || "Failed to start streaming.");
      }
    }
  }, [teardownAudioHardware]);

  const stopStreaming = useCallback(async (): Promise<string | null> => {
    if (!busyRef.current || stoppingRef.current) return null;
    // A stop during startup cancels every pending continuation.
    if (!isStreamingRef.current) {
      generationRef.current += 1;
      await teardownAudioHardware();
      socketRef.current?.close();
      socketRef.current = null;
      busyRef.current = false;
      if (mountedRef.current) {
        setIsProcessing(false);
        setStatusMessage("");
      }
      return null;
    }

    stoppingRef.current = true;
    const generation = generationRef.current;
    const isCurrent = () => mountedRef.current && generationRef.current === generation;
    const ws = socketRef.current;
    clearTimer();
    isStreamingRef.current = false;
    setIsStreaming(false);
    setIsProcessing(true);
    setStatusMessage("Flushing audio buffer...");

    let finalized = false;
    try {
      // Freeze capture, then wait until the tail has been forwarded to the socket.
      sourceNodeRef.current?.disconnect();
      sourceNodeRef.current = null;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      if (!workletNodeRef.current) throw new Error("Audio worklet unavailable");
      const flush = completionSignal(2000);
      flushCompleteRef.current = flush.complete;
      workletNodeRef.current.port.postMessage("flush");
      const flushed = await flush.promise;
      flushCompleteRef.current = null;
      if (!flushed || !isCurrent()) throw new Error("Audio flush incomplete");

      if (!ws || ws.readyState !== WebSocket.OPEN) throw new Error("Socket unavailable");
      setStatusMessage("Finalizing transcript...");
      const termination = completionSignal(5000);
      terminationCompleteRef.current = termination.complete;
      ws.send(JSON.stringify({ type: "Terminate" }));
      finalized = await termination.promise;
    } catch (err) {
      console.error("Stream finalization error:", err);
    } finally {
      flushCompleteRef.current?.(false);
      terminationCompleteRef.current?.(false);
      flushCompleteRef.current = null;
      terminationCompleteRef.current = null;
      await teardownAudioHardware();
      ws?.close();
      if (socketRef.current === ws) socketRef.current = null;
      stoppingRef.current = false;
      busyRef.current = false;
    }
    if (!isCurrent()) return null;
    generationRef.current += 1;
    setIsProcessing(false);
    setStatusMessage("");
    if (!finalized) {
      setErrorMessage("Transcript finalization incomplete. Please try recording again.");
      return null;
    }

    // 6. Compute authoritative final transcript
    let finalTranscript = accumulatedTranscriptRef.current.trim();
    if (currentTurnRef.current.trim() && !finalTranscript.endsWith(currentTurnRef.current.trim())) {
      finalTranscript = finalTranscript
        ? `${finalTranscript} ${currentTurnRef.current.trim()}`
        : currentTurnRef.current.trim();
    }
    currentTurnRef.current = "";
    setLiveTranscript(finalTranscript);

    setIsProcessing(false);
    setStatusMessage("");

    if (!finalTranscript) {
      setErrorMessage("No speech was detected.");
      return null;
    }

    return finalTranscript;
  }, [teardownAudioHardware]);

  const resetTranscript = useCallback(() => {
    accumulatedTranscriptRef.current = "";
    currentTurnRef.current = "";
    setLiveTranscript("");
  }, []);

  const clearError = useCallback(() => {
    setErrorMessage(null);
  }, []);

  return {
    isStreaming,
    isProcessing,
    recordingSeconds,
    statusMessage,
    liveTranscript,
    errorMessage,
    startStreaming,
    stopStreaming,
    resetTranscript,
    clearError,
  };
}
