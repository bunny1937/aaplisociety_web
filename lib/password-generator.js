/**
 * lib/password-generator.js
 *
 * Simple, readable temp passwords for newly-created accounts (members
 * replace theirs during onboarding). Avoids visually ambiguous characters
 * (0/O, 1/l/I) since these often get read off a screen or printed sheet.
 */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
export function generatePassword(length = 8) {
  let pwd = "";
  for (let i = 0; i < length; i++) {
    pwd += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return pwd;
}
