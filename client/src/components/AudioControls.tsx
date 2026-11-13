interface AudioControlsProps {
  isStreaming: boolean;
  isProcessing: boolean;
  recordingSeconds: number;
  statusMessage: string;
  onStart: () => void;
  onStop: () => void;
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

export function AudioControls({
  isStreaming,
  isProcessing,
  recordingSeconds,
  statusMessage,
  onStart,
  onStop,
}: AudioControlsProps) {
  return (
    <div className="audio-controls">
      {isStreaming ? (
        <button
          className="btn-record active"
          onClick={onStop}
          disabled={isProcessing}
        >
          <span className="rec-indicator" />
          <span>Stop</span>
          <span className="rec-timer">{formatTime(recordingSeconds)}</span>
        </button>
      ) : (
        <button
          className="btn-record"
          onClick={onStart}
          disabled={isProcessing}
        >
          <span className="rec-dot" />
          <span>{isProcessing ? "Processing..." : "Record Thought"}</span>
        </button>
      )}

      {statusMessage && (
        <p className="status-caption">{statusMessage}</p>
      )}
    </div>
  );
}
