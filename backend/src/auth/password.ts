import { randomBytes, scrypt as scryptCb, timingSafeEqual, ScryptOptions } from 'node:crypto';

// scrypt (memory-hard KDF from Node's standard library). Format: scrypt$N$r$p$salt$hash (base64).
const N = 2 ** 15, R = 8, P = 1, KEYLEN = 64;
const MAXMEM = 64 * 1024 * 1024;

function scrypt(password: string, salt: Buffer, keylen: number, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => scryptCb(password, salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key))));
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return ['scrypt', N, R, P, salt.toString('base64'), hash.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, n, r, p, saltB64, hashB64] = stored.split('$');
  if (algo !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length, { N: Number(n), r: Number(r), p: Number(p), maxmem: MAXMEM });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Hash used to keep login timing equal when the email does not exist. */
export const DUMMY_HASH = 'scrypt$32768$8$1$c2RzLWNybS1kdW1teQ==$' + Buffer.alloc(64).toString('base64');

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;
