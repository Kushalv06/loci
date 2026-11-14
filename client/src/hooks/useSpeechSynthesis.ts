import { useState, useEffect, useCallback, useRef } from "react";

export interface UseSpeechSynthesisReturn {
  isSpeaking: boolean;
  speak: (text: string) => void;
  stop: () => void;
  supported: boolean;
}

export function useSpeechSynthesis(): UseSpeechSynthesisReturn {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const supported = typeof window !== "undefined" && "speechSynthesis" in window;
  const isSpeakingRef = useRef(false);

  const stop = useCallback(() => {
    if (!supported) return;
    window.speechSynthesis.cancel();
    isSpeakingRef.current = false;
    setIsSpeaking(false);
  }, [supported]);

  const speak = useCallback(
    (text: string) => {
      if (!supported || !text.trim()) return;

      // Cancel any ongoing speech first
      window.speechSynthesis.cancel();

      // Remove recognized Markdown wrappers while retaining their content.
      const cleanText = text
        .replace(/^ {0,3}#{1,6}\s+/gm, "")
        .replace(/^ {0,3}(`{3,}|~{3,})[^\n]*$/gm, "")
        .replace(/\[([^\]\n]+)\]\([^\s)]+\)/g, "$1")
        .replace(/(\*\*|__)(?=\S)(.+?\S|\S)\1/g, "$2")
        .replace(/(^|\s)(\*|_)(?=\S)(.+?\S|\S)\2(?=\s|[.,!?;:]|$)/g, "$1$3")
        .replace(/(`+)([^`]+)\1/g, "$2")
        .trim();

      const utterance = new SpeechSynthesisUtterance(cleanText);
      utterance.rate = 1.0;
      utterance.pitch = 1.0;

      // Select an English voice if available
      const voices = window.speechSynthesis.getVoices();
      const naturalVoice =
        voices.find((v) => v.lang.startsWith("en") && (v.name.includes("Natural") || v.name.includes("Google"))) ||
        voices.find((v) => v.lang.startsWith("en"));
      if (naturalVoice) {
        utterance.voice = naturalVoice;
      }

      utterance.onstart = () => {
        isSpeakingRef.current = true;
        setIsSpeaking(true);
      };

      utterance.onend = () => {
        isSpeakingRef.current = false;
        setIsSpeaking(false);
      };

      utterance.onerror = () => {
        isSpeakingRef.current = false;
        setIsSpeaking(false);
      };

      window.speechSynthesis.speak(utterance);
    },
    [supported]
  );

  useEffect(() => {
    return () => {
      if (supported) {
        window.speechSynthesis.cancel();
      }
    };
  }, [supported]);

  return { isSpeaking, speak, stop, supported };
}

