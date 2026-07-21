const crypto = require("crypto");
const { verifyLineSignature, lineSignatureMiddleware } = require("../../../../utils/channels/line/signature");

describe("LINE HMAC Signature Verification", () => {
  describe("verifyLineSignature", () => {
    const testSecret = "test-line-secret-abc123";
    const testBody = '{"events":[]}';

    it("(a) should return true for valid signature", () => {
      const signature = crypto
        .createHmac("sha256", testSecret)
        .update(testBody)
        .digest("base64");

      const result = verifyLineSignature(testBody, signature, testSecret);
      expect(result).toBe(true);
    });

    it("(b) should return false when wrong secret used to compute header", () => {
      const wrongSecret = "wrong-secret";
      const signature = crypto
        .createHmac("sha256", wrongSecret)
        .update(testBody)
        .digest("base64");

      const result = verifyLineSignature(testBody, signature, testSecret);
      expect(result).toBe(false);
    });

    it("(c) should return false when body is tampered (header computed for different body)", () => {
      const signature = crypto
        .createHmac("sha256", testSecret)
        .update(testBody)
        .digest("base64");

      const tamperedBody = '{"events":[],"tampered":true}';
      const result = verifyLineSignature(tamperedBody, signature, testSecret);
      expect(result).toBe(false);
    });

    it("(d) should return false for missing or empty signature header without throwing", () => {
      expect(verifyLineSignature(testBody, "", testSecret)).toBe(false);
      expect(verifyLineSignature(testBody, undefined, testSecret)).toBe(false);
      expect(verifyLineSignature(testBody, null, testSecret)).toBe(false);
    });

    it("(e) should return false for signature of different length via safe comparison without throwing", () => {
      // Short garbage string that's definitely not a valid base64 HMAC
      const shortSignature = "AAAA";

      // This should NOT throw even though lengths differ
      const result = verifyLineSignature(testBody, shortSignature, testSecret);
      expect(result).toBe(false);
    });
  });

  describe("lineSignatureMiddleware", () => {
    it("should return a middleware function", () => {
      const getSecret = async () => "test-secret";
      const middleware = lineSignatureMiddleware(getSecret);
      expect(typeof middleware).toBe("function");
      expect(middleware.length).toBe(3); // (req, res, next)
    });

    it("should call next() for valid signature", async () => {
      const testSecret = "test-line-secret-abc123";
      const testBody = '{"events":[]}';
      const signature = crypto
        .createHmac("sha256", testSecret)
        .update(testBody)
        .digest("base64");

      const getSecret = async () => testSecret;
      const middleware = lineSignatureMiddleware(getSecret);

      const req = {
        rawBody: testBody,
        get: (header) => (header === "x-line-signature" ? signature : undefined),
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
      };
      const next = jest.fn();

      await middleware(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it("should respond 401 for invalid signature", async () => {
      const testSecret = "test-line-secret-abc123";
      const testBody = '{"events":[]}';

      const getSecret = async () => testSecret;
      const middleware = lineSignatureMiddleware(getSecret);

      const req = {
        rawBody: testBody,
        get: (header) => (header === "x-line-signature" ? "invalid-sig" : undefined),
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
      };
      const next = jest.fn();

      await middleware(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: "Invalid signature" });
      expect(next).not.toHaveBeenCalled();
    });

    it("should respond 401 for missing signature header", async () => {
      const testSecret = "test-line-secret-abc123";
      const testBody = '{"events":[]}';

      const getSecret = async () => testSecret;
      const middleware = lineSignatureMiddleware(getSecret);

      const req = {
        rawBody: testBody,
        get: (header) => undefined, // No signature header
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
      };
      const next = jest.fn();

      await middleware(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: "Invalid signature" });
      expect(next).not.toHaveBeenCalled();
    });

    it("should respond 500 when rawBody is missing", async () => {
      const getSecret = async () => "test-secret";
      const middleware = lineSignatureMiddleware(getSecret);

      const req = {
        rawBody: undefined, // Missing rawBody
        get: (header) => "some-sig",
      };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
      };
      const next = jest.fn();

      await middleware(req, res, next);
      expect(res.status).toHaveBeenCalledWith(500);
      expect(next).not.toHaveBeenCalled();
    });
  });
});
