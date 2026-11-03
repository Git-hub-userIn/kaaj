import crypto from 'node:crypto';

const ENCRYPTION_SECRET =
  process.env.TOKEN_ENCRYPTION_KEY ||
  process.env.DEV_AUTH_TOKEN ||
  'kaaj-secret-master-token-encryption-32-bytes!';

function getDerivedKey(secret = ENCRYPTION_SECRET): Buffer {
  return crypto.scryptSync(secret, 'kaaj-token-salt', 32);
}

/**
 * Encrypts arbitrary token data into an AES-256-GCM ciphertext payload.
 */
export function encryptTokenData(data: any): string {
  const iv = crypto.randomBytes(12);
  const key = getDerivedKey();
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = JSON.stringify(data);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * Decrypts an AES-256-GCM ciphertext payload back to its original JSON value.
 * Supports transparent fallback to plaintext JSON for backwards compatibility.
 */
export function decryptTokenData<T = any>(ciphertext: string): T | null {
  try {
    const trimmed = ciphertext.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      return JSON.parse(trimmed) as T;
    }
    const parts = trimmed.split(':');
    if (parts.length !== 3) {
      return null;
    }
    const [ivHex, tagHex, encryptedHex] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(tagHex, 'hex');
    const key = getDerivedKey();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return JSON.parse(decrypted) as T;
  } catch {
    return null;
  }
}
