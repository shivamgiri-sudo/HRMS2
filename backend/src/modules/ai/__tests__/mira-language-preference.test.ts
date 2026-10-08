import { beforeEach, describe, expect, it } from 'vitest';

import { clearConversation, getPreferredLanguage, recordTurn } from '../ai-conversation.service.js';

const USER = 'user-lang-pref';

const HINDI = 'मुझे छुट्टी कैसे लेनी है?';
const TELUGU = 'నాకు సెలవు ఎలా తీసుకోవాలి?';
const ENGLISH = 'How do I apply for leave?';

function ask(question: string): void {
  recordTurn(USER, { question, answer: 'ok', externalSafe: true });
}

describe('thread language preference', () => {
  beforeEach(() => {
    clearConversation(USER);
  });

  it('stays null for an all-English thread', () => {
    ask(ENGLISH);
    ask(ENGLISH);
    expect(getPreferredLanguage(USER)).toBeNull();
  });

  it('adopts the first detected language immediately', () => {
    ask(HINDI);
    expect(getPreferredLanguage(USER)?.code).toBe('hi');
  });

  it('needs two consecutive turns to switch to a different language', () => {
    ask(HINDI);
    ask(TELUGU);
    // One Telugu message is not enough to move an established session.
    expect(getPreferredLanguage(USER)?.code).toBe('hi');
    ask(TELUGU);
    expect(getPreferredLanguage(USER)?.code).toBe('te');
  });

  it('does not switch when the other language is not consecutive', () => {
    ask(HINDI);
    ask(TELUGU);
    ask(ENGLISH);
    ask(TELUGU);
    expect(getPreferredLanguage(USER)?.code).toBe('hi');
  });

  it('reverts to English only after three consecutive English turns', () => {
    ask(HINDI);
    ask(ENGLISH);
    expect(getPreferredLanguage(USER)?.code).toBe('hi');
    ask(ENGLISH);
    expect(getPreferredLanguage(USER)?.code).toBe('hi');
    ask(ENGLISH);
    expect(getPreferredLanguage(USER)).toBeNull();
  });

  it('resets the English streak when the language is used again', () => {
    ask(HINDI);
    ask(ENGLISH);
    ask(ENGLISH);
    ask(HINDI);
    ask(ENGLISH);
    ask(ENGLISH);
    expect(getPreferredLanguage(USER)?.code).toBe('hi');
  });

  it('keeps a long-established language on a single stray other-script turn', () => {
    for (let i = 0; i < 5; i += 1) ask(HINDI);
    ask(TELUGU);
    expect(getPreferredLanguage(USER)?.code).toBe('hi');
  });

  it('keeps preferences separate per user', () => {
    ask(HINDI);
    recordTurn('other-user', { question: TELUGU, answer: 'ok', externalSafe: true });
    expect(getPreferredLanguage(USER)?.code).toBe('hi');
    expect(getPreferredLanguage('other-user')?.code).toBe('te');
    clearConversation('other-user');
  });

  it('returns null for a user with no thread', () => {
    expect(getPreferredLanguage('nobody-here')).toBeNull();
  });
});
