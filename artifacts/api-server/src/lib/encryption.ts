import CryptoJS from "crypto-js";

const ENCRYPTION_KEY =
  process.env.ENCRYPTION_KEY ?? "fallback-dev-key-32chars-change!";

export function encryptMessage(plainText: string): string {
  return CryptoJS.AES.encrypt(plainText, ENCRYPTION_KEY).toString();
}

export function decryptMessage(cipherText: string): string {
  try {
    const bytes = CryptoJS.AES.decrypt(cipherText, ENCRYPTION_KEY);
    return bytes.toString(CryptoJS.enc.Utf8);
  } catch {
    return "[decryption failed]";
  }
}
