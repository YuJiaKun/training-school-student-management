const crypto = require('node:crypto');

const HASH_ALGORITHM = 'sha256';
const HASH_ITERATIONS = 210000;
const HASH_KEY_LENGTH = 32;
const HASH_PREFIX = 'pbkdf2_sha256';

function generateInitialPassword() {
  return crypto.randomBytes(9).toString('base64url');
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('base64url');
  const digest = crypto
    .pbkdf2Sync(String(password || ''), salt, HASH_ITERATIONS, HASH_KEY_LENGTH, HASH_ALGORITHM)
    .toString('base64url');
  return `${HASH_PREFIX}$${HASH_ITERATIONS}$${salt}$${digest}`;
}

function verifyPassword(password, passwordHash) {
  const parts = String(passwordHash || '').split('$');
  if (parts.length !== 4 || parts[0] !== HASH_PREFIX) return false;

  const iterations = Number(parts[1]);
  const salt = parts[2];
  const expected = Buffer.from(parts[3], 'base64url');
  if (!Number.isInteger(iterations) || iterations <= 0 || !salt || !expected.length) return false;

  const actual = crypto.pbkdf2Sync(String(password || ''), salt, iterations, expected.length, HASH_ALGORITHM);
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

module.exports = {
  generateInitialPassword,
  hashPassword,
  verifyPassword
};
