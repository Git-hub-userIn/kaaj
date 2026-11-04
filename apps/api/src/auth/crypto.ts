import crypto from 'node:crypto';

/**
 * Derive a 32-byte key from TOKEN_ENC_KEY.
 * Parse 64 hex characters as buffer or hash input with SHA-256.
 */
function getEncryptionKey(): Buffer {
  const rawKey = process.env.TOKEN_ENC_KEY;
  if (!rawKey) {
    throw new Error('TOKEN_ENC_KEY is not defined.');
  }
  const trimmed = rawKey.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, 'hex');
  }
  return crypto.createHash('sha256').update(trimmed, 'utf8').digest();
}

/**
 * Encrypt a plaintext token using AES-256-GCM.
 * Return serialized hex format: iv:authTag:ciphertext.
 */
export function encryptToken(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const key = getEncryptionKey();
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let ciphertext = cipher.update(plaintext, 'utf8', 'hex');
  ciphertext += cipher.final('hex');
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext}`;
}

/**
 * Decrypt an AES-256-GCM serialized payload.
 * Expect serialized hex format: iv:authTag:ciphertext.
 */
export function decryptToken(serialized: string): string {
  const parts = serialized.trim().split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid token payload: expected 3 colon-separated parts.');
  }
  const [ivHex, tagHex, ciphertextHex] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(tagHex, 'hex');
  const key = getEncryptionKey();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(ciphertextHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}
