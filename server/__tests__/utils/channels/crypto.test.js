const {
  encryptCredential,
  decryptCredential,
  encryptToken,
  decryptToken,
} = require("../../../utils/channels/crypto");

describe("Shared Credential Crypto Utilities", () => {
  describe("encryptCredential / decryptCredential", () => {
    it("should round-trip encrypt and decrypt a credential", () => {
      const secret = "secret-x";
      const encrypted = encryptCredential(secret);
      expect(encrypted).toBeTruthy();
      expect(encrypted).not.toBe(secret);
      const decrypted = decryptCredential(encrypted);
      expect(decrypted).toBe(secret);
    });

    it("should handle empty/null credentials gracefully", () => {
      expect(encryptCredential(null)).toBeNull();
      expect(encryptCredential("")).toBeNull();
      expect(decryptCredential(null)).toBeNull();
      expect(decryptCredential("")).toBeNull();
    });

    it("should produce different ciphertexts for the same plaintext (due to random IV)", () => {
      const secret = "same-secret";
      const encrypted1 = encryptCredential(secret);
      const encrypted2 = encryptCredential(secret);
      expect(encrypted1).not.toBe(encrypted2);
      expect(decryptCredential(encrypted1)).toBe(secret);
      expect(decryptCredential(encrypted2)).toBe(secret);
    });
  });

  describe("encryptToken / decryptToken (backward compat aliases)", () => {
    it("should round-trip encrypt and decrypt a token", () => {
      const token = "bot-token-123";
      const encrypted = encryptToken(token);
      expect(encrypted).toBeTruthy();
      expect(encrypted).not.toBe(token);
      const decrypted = decryptToken(encrypted);
      expect(decrypted).toBe(token);
    });

    it("should handle null/empty tokens gracefully", () => {
      expect(encryptToken(null)).toBeNull();
      expect(encryptToken("")).toBeNull();
      expect(decryptToken(null)).toBeNull();
      expect(decryptToken("")).toBeNull();
    });
  });

  describe("Cross-path equivalence (backward compatibility)", () => {
    it("should decrypt ciphertext produced by new encryptCredential using old decryptToken", () => {
      // This test ensures the algorithm is identical between the two paths
      const secret = "cross-path-test";
      const encrypted = encryptCredential(secret);
      // Both should use the same underlying algorithm
      const decrypted = decryptToken(encrypted);
      expect(decrypted).toBe(secret);
    });

    it("should decrypt ciphertext produced by new encryptToken using old decryptCredential", () => {
      const token = "cross-path-token";
      const encrypted = encryptToken(token);
      const decrypted = decryptCredential(encrypted);
      expect(decrypted).toBe(token);
    });
  });
});
