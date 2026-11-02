// API Key 不落地明文：用 Worker secret 派生的密钥做 AES-GCM，存进 settings。
// secret 变了就解不开，此时当作"没有密钥"，让用户重新填一次。

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function fromBase64(text) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function deriveKey(secret) {
  const material = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    'HKDF',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: encoder.encode('roam-settings'),
      info: encoder.encode('api-key'),
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptValue(secret, plain) {
  const key = await deriveKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(plain),
  );
  return `enc1:${toBase64(iv)}:${toBase64(new Uint8Array(cipher))}`;
}

export async function decryptValue(secret, stored) {
  if (!stored) return '';
  if (!stored.startsWith('enc1:')) return stored; // 兼容早期明文
  const [, iv, body] = stored.split(':');
  try {
    const key = await deriveKey(secret);
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(iv) },
      key,
      fromBase64(body),
    );
    return decoder.decode(plain);
  } catch {
    return '';
  }
}

export { toBase64, fromBase64 };
