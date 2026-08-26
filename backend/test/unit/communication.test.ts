import {
  isReactionAllowed,
  isReactionId,
  normalizeChatBody,
} from '../../src/services/communication';

describe('communication validation', () => {
  it('normalizes valid messages and rejects empty or oversized bodies', () => {
    expect(normalizeChatBody('  Hallo zusammen!  ')).toBe('Hallo zusammen!');
    expect(normalizeChatBody('   ')).toBeNull();
    expect(normalizeChatBody('x'.repeat(501))).toBeNull();
    expect(normalizeChatBody({ body: 'nope' })).toBeNull();
  });

  it('accepts only catalog reaction ids', () => {
    expect(isReactionId('hello')).toBe(true);
    expect(isReactionId('technical')).toBe(true);
    expect(isReactionId('custom-html')).toBe(false);
  });

  it('enforces the phase-specific reaction catalog', () => {
    expect(isReactionAllowed('hello', 'waiting')).toBe(true);
    expect(isReactionAllowed('hello', 'active')).toBe(false);
    expect(isReactionAllowed('think', 'active')).toBe(true);
    expect(isReactionAllowed('think', 'finished')).toBe(false);
    expect(isReactionAllowed('technical', 'countdown')).toBe(true);
  });
});
