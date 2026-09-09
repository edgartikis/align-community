import crypto from 'node:crypto';

export const hashPassword = password => {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return { salt, hash };
};

export const verifyPassword = (password, salt, expectedHash) => {
  try {
    const actual = crypto.scryptSync(String(password), String(salt), 64);
    const expected = Buffer.from(String(expectedHash), 'hex');
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch (_) {
    return false;
  }
};

export const randomToken = (bytes = 24) => crypto.randomBytes(bytes).toString('base64url');
export const memberCode = prefix => `AL-${prefix}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
