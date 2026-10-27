import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';

// Password hashing with scrypt at OWASP's recommended cost (N=2^17, r=8, p=1).
// Stored as scrypt:<log2 N>:<r>:<p>:<salt>:<hash>, base64, so the cost can be raised
// later and old hashes still verify.

const LOG2_N = 17;
const R = 8;
const P = 1;
const KEY_LEN = 32;
const SALT_LEN = 16;

export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 256;

function scrypt(password: string, salt: Buffer, opts: { logN: number; r: number; p: number }): Promise<Buffer> {
  const N = 2 ** opts.logN;
  const options: ScryptOptions = { N, r: opts.r, p: opts.p, maxmem: 256 * N * opts.r };
  return new Promise((resolve, reject) =>
    scryptCb(password.normalize('NFKC'), salt, KEY_LEN, options, (err, key) => (err ? reject(err) : resolve(key))));
}

/** Why a password is unacceptable, or null if it is fine. */
export function passwordProblem(password: string): string | null {
  if (password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (password.length > PASSWORD_MAX) return `Use at most ${PASSWORD_MAX} characters.`;
  return null;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LEN);
  const key = await scrypt(password, salt, { logN: LOG2_N, r: R, p: P });
  return ['scrypt', LOG2_N, R, P, salt.toString('base64'), key.toString('base64')].join(':');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(':');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, logN, r, p, salt, hash] = parts;
  const expected = Buffer.from(hash!, 'base64');
  const actual = await scrypt(password, Buffer.from(salt!, 'base64'), {
    logN: Number(logN), r: Number(r), p: Number(p),
  });
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/**
 * A hash of a random password, verified against when an email has no account, so a
 * failed sign-in takes as long whether or not the account exists.
 */
let dummy: Promise<string> | undefined;
export function dummyHash(): Promise<string> {
  dummy ??= hashPassword(randomBytes(24).toString('base64'));
  return dummy;
}

export function normalizeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}
