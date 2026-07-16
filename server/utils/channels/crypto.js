const { EncryptionManager } = require("../EncryptionManager");

const ENCRYPTED_PREFIX = "enc:";

/**
 * Encrypt a credential for safe storage in the database.
 * Uses AES-256-CBC with random IV, key derived from SIG_KEY/SIG_SALT via scrypt.
 * @param {string} credential
 * @returns {string|null}
 */
function encryptCredential(credential) {
  if (!credential) return null;
  const manager = new EncryptionManager();
  const encrypted = manager.encrypt(credential);
  return encrypted ? ENCRYPTED_PREFIX + encrypted : null;
}

/**
 * Decrypt an encrypted credential from the database.
 * Returns plaintext credentials as-is for backward compatibility.
 * @param {string} encryptedCredential
 * @returns {string|null}
 */
function decryptCredential(encryptedCredential) {
  if (!encryptedCredential) return null;
  if (!encryptedCredential.startsWith(ENCRYPTED_PREFIX))
    return encryptedCredential;
  const manager = new EncryptionManager();
  return manager.decrypt(encryptedCredential.slice(ENCRYPTED_PREFIX.length));
}

/**
 * Encrypt a bot token for safe storage in the database.
 * Backward-compatible alias for encryptCredential.
 * @param {string} token
 * @returns {string|null}
 */
function encryptToken(token) {
  return encryptCredential(token);
}

/**
 * Decrypt an encrypted bot token from the database.
 * Backward-compatible alias for decryptCredential.
 * @param {string} encryptedToken
 * @returns {string|null}
 */
function decryptToken(encryptedToken) {
  return decryptCredential(encryptedToken);
}

module.exports = {
  encryptCredential,
  decryptCredential,
  encryptToken,
  decryptToken,
};
