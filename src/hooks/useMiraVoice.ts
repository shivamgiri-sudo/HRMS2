import { useCallback, useEffect, useRef, useState } from 'react';

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionEventLike extends Event {
  results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionErrorEventLike extends Event {
  error?: string;
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
}

type SpeechRecognitionConstructorLike = new () => SpeechRecognitionLike;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructorLike;
    webkitSpeechRecognition?: SpeechRecognitionConstructorLike;
  }
}

function cleanForSpeech(text: string): string {
  return text
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[•*_#`>|]/g, ' ')
    .replace(/₹/g, ' rupees ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 3000);
}

export function useMiraVoice() {
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState('');
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [autoSpeak, setAutoSpeak] = useState(() => localStorage.getItem('mira_auto_speak') === 'true');

  const recognitionSupported = typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  const speechSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;

  useEffect(() => {
    localStorage.setItem('mira_auto_speak', String(autoSpeak));
  }, [autoSpeak]);

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setListening(false);
    setInterimTranscript('');
  }, []);

  const startListening = useCallback((onFinal: (transcript: string) => void) => {
    if (!recognitionSupported || listening) return;

    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) return;

    setVoiceError(null);
    const recognition = new Recognition();
    recognition.lang = 'en-IN';
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      let interim = '';
      let finalText = '';
      for (let index = 0; index < event.results.length; index += 1) {
        const result = event.results[index];
        const transcript = result?.[0]?.transcript ?? '';
        if (result?.isFinal) finalText += transcript;
        else interim += transcript;
      }
      setInterimTranscript(interim.trim());
      if (finalText.trim()) {
        setInterimTranscript('');
        onFinal(finalText.trim());
      }
    };

    recognition.onerror = (event) => {
      const code = event.error || 'voice_error';
      const message = code === 'not-allowed'
        ? 'Microphone permission was denied.'
        : code === 'no-speech'
          ? 'No speech was detected.'
          : 'Voice input could not be started.';
      setVoiceError(message);
      setListening(false);
    };

    recognition.onend = () => {
      recognitionRef.current = null;
      setListening(false);
      setInterimTranscript('');
    };

    recognitionRef.current = recognition;
    setListening(true);
    try {
      recognition.start();
    } catch {
      setListening(false);
      setVoiceError('Voice input could not be started.');
    }
  }, [listening, recognitionSupported]);

  const stopSpeaking = useCallback(() => {
    if (!speechSupported) return;
    window.speechSynthesis.cancel();
    setSpeaking(false);
  }, [speechSupported]);

  const speak = useCallback((text: string) => {
    if (!speechSupported || !text.trim()) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(cleanForSpeech(text));
    utterance.lang = 'en-IN';
    utterance.rate = 1;
    utterance.pitch = 1.03;

    const voices = window.speechSynthesis.getVoices();
    const preferred = voices.find((voice) => voice.lang === 'en-IN')
      ?? voices.find((voice) => voice.lang.startsWith('en-'));
    if (preferred) utterance.voice = preferred;

    utterance.onstart = () => setSpeaking(true);
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(utterance);
  }, [speechSupported]);

  useEffect(() => () => {
    recognitionRef.current?.abort();
    if (speechSupported) window.speechSynthesis.cancel();
  }, [speechSupported]);

  return {
    recognitionSupported,
    speechSupported,
    listening,
    speaking,
    interimTranscript,
    voiceError,
    autoSpeak,
    setAutoSpeak,
    startListening,
    stopListening,
    speak,
    stopSpeaking,
  };
}
