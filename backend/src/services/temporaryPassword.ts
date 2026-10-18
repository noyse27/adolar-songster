import crypto from 'crypto';

// Avoids visually ambiguous characters (0/O, 1/I/l) since this is read off
// screen and typed back in by a human relaying it over phone/chat.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
const LENGTH = 16;

export function generateTemporaryPassword(): string {
  const bytes = crypto.randomBytes(LENGTH);
  let password = '';
  for (let i = 0; i < LENGTH; i += 1) {
    password += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return password;
}
