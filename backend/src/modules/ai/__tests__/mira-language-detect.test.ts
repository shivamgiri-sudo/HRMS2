import { describe, expect, it } from 'vitest';

import { detectLanguage } from '../mira-language-detect.js';

describe('detectLanguage', () => {
  it('returns null for English text', () => {
    expect(detectLanguage('How do I apply for leave?')).toBeNull();
  });

  it('detects Hindi (Devanagari)', () => {
    const result = detectLanguage('मुझे छुट्टी कैसे लेनी है?');
    expect(result?.code).toBe('hi');
    expect(result?.name).toBe('हिंदी');
  });

  it('detects Telugu', () => {
    expect(detectLanguage('నాకు సెలవు ఎలా తీసుకోవాలి?')?.code).toBe('te');
  });

  it('detects Tamil', () => {
    expect(detectLanguage('விடுமுறை எவ்வாறு எடுப்பது?')?.code).toBe('ta');
  });

  it('detects Bengali', () => {
    expect(detectLanguage('ছুটি কিভাবে নেব?')?.code).toBe('bn');
  });

  it('detects Kannada', () => {
    expect(detectLanguage('ನನ್ನ ರಜೆ ಎಷ್ಟು ಬಾಕಿ ಇದೆ?')?.code).toBe('kn');
  });

  it('detects Malayalam', () => {
    expect(detectLanguage('എനിക്ക് അവധി എങ്ങനെ എടുക്കാം?')?.code).toBe('ml');
  });

  it('detects Gujarati', () => {
    expect(detectLanguage('મારી રજા કેટલી બાકી છે?')?.code).toBe('gu');
  });

  it('detects Punjabi (Gurmukhi)', () => {
    expect(detectLanguage('ਮੇਰੀ ਛੁੱਟੀ ਕਿੰਨੀ ਬਾਕੀ ਹੈ?')?.code).toBe('pa');
  });

  it('returns null when an English question carries only a stray Hindi word', () => {
    // 5 of 25 non-whitespace characters are Devanagari — under the 30% bar, so
    // this stays an English question and gets an English answer.
    expect(detectLanguage('How do I apply for leave? ठीक है')).toBeNull();
  });

  it('detects the language when mixed text is mostly non-Latin', () => {
    expect(detectLanguage('मुझे छुट्टी चाहिए, how to apply?')?.code).toBe('hi');
  });

  it('returns null for empty and whitespace-only input', () => {
    expect(detectLanguage('')).toBeNull();
    expect(detectLanguage('   \n\t ')).toBeNull();
  });

  it('returns null for digits and punctuation only', () => {
    expect(detectLanguage('12345 !!! ???')).toBeNull();
  });

  it('picks the dominant script when two Indic scripts appear together', () => {
    // Mostly Tamil with a shorter Devanagari tail.
    expect(detectLanguage('விடுமுறை எவ்வாறு எடுப்பது ठीक')?.code).toBe('ta');
  });
});
