interface LiveTranscriptProps {
  transcript: string;
  isStreaming: boolean;
}

export function LiveTranscript({ transcript, isStreaming }: LiveTranscriptProps) {
  if (!transcript && !isStreaming) return null;

  return (
    <div className="transcript-box">
      <div className="transcript-header">
        <span className="transcript-title">
          {isStreaming ? "Live Transcript" : "Last Recorded Transcript"}
        </span>
        {isStreaming && <span className="transcript-live-tag">Streaming</span>}
      </div>

      <p className="transcript-body">
        {transcript || <span className="transcript-placeholder">Listening...</span>}
      </p>
    </div>
  );
}
