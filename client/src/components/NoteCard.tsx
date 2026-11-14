import { useState } from "react";
import type { LearningCaptureNote } from "../types";

interface NoteCardProps {
  note: LearningCaptureNote;
}

export function NoteCard({ note }: NoteCardProps) {
  const [showJson, setShowJson] = useState(false);

  return (
    <article className="note-card">
      <header className="note-card-header">
        <div>
          <h2 className="concept-title">
            {note.conceptName || "Uncategorized Thought"}
          </h2>
          <div className="badge-row">
            <span className={`badge badge-${note.validityStatus}`}>
              {note.validityStatus}
            </span>
            {note.embeddingStatus === "ready" && (
              <span className="badge badge-indexed">2048 dims indexed</span>
            )}
            {note.noteTypes?.map((type) => (
              <span key={type} className="badge badge-tag">
                {type}
              </span>
            ))}
          </div>
        </div>
      </header>

      {note.summary && (
        <section className="note-section">
          <h3 className="section-title">Summary</h3>
          <p className="section-content">{note.summary}</p>
        </section>
      )}

      {note.keyIdeas && note.keyIdeas.length > 0 && (
        <section className="note-section">
          <h3 className="section-title">Key Ideas</h3>
          <ul className="key-ideas-list">
            {note.keyIdeas.map((idea, i) => (
              <li key={i}>{idea}</li>
            ))}
          </ul>
        </section>
      )}

      {note.cleanedTranscript && (
        <section className="note-section">
          <h3 className="section-title">What You Said</h3>
          <blockquote className="spoken-quote">
            "{note.cleanedTranscript}"
          </blockquote>
        </section>
      )}

      {(note.possibleCorrection || note.importantNuance) && (
        <aside className="nuance-callout">
          {note.possibleCorrection && (
            <div className="callout-item">
              <span className="callout-icon">⚠️</span>
              <div>
                <strong>Correction:</strong> {note.possibleCorrection}
              </div>
            </div>
          )}
          {note.importantNuance && (
            <div className="callout-item">
              <span className="callout-icon">💡</span>
              <div>
                <strong>Key Nuance:</strong> {note.importantNuance}
              </div>
            </div>
          )}
        </aside>
      )}

      {note.searchTags && note.searchTags.length > 0 && (
        <footer className="note-tags">
          {note.searchTags.map((tag) => (
            <span key={tag} className="search-tag">
              #{tag}
            </span>
          ))}
        </footer>
      )}

      {/* Developer Raw JSON Toggle */}
      <div className="json-inspector">
        <button
          className="btn-text"
          onClick={() => setShowJson(!showJson)}
        >
          {showJson ? "Hide Raw JSON ▲" : "Inspect JSON ▼"}
        </button>

        {showJson && (
          <pre className="json-block">
            {JSON.stringify(note, null, 2)}
          </pre>
        )}
      </div>
    </article>
  );
}
