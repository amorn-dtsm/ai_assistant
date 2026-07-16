const crypto = require("crypto");

/**
 * Verify LINE webhook HMAC-SHA256 signature using timing-safe comparison.
 *
 * @param {string} rawBody - The raw request body (as string/buffer)
 * @param {string} signature - The X-Line-Signature header value (base64)
 * @param {string} channelSecret - The LINE channel secret
 * @returns {boolean} True if signature is valid, false otherwise (never throws)
 */
function verifyLineSignature(rawBody, signature, channelSecret) {
  // Handle missing or empty signature
  if (!signature) {
    return false;
  }

  try {
    // Compute expected HMAC-SHA256 digest
    const expected = crypto
      .createHmac("sha256", channelSecret)
      .update(rawBody)
      .digest("base64");

    // Convert both to buffers for timing-safe comparison
    const expectedBuffer = Buffer.from(expected, "utf8");
    const signatureBuffer = Buffer.from(signature, "utf8");

    // Check lengths match BEFORE calling timingSafeEqual to avoid length-mismatch exception
    if (expectedBuffer.length !== signatureBuffer.length) {
      return false;
    }

    // Timing-safe comparison
    return crypto.timingSafeEqual(expectedBuffer, signatureBuffer);
  } catch {
    // Catch any unexpected errors (e.g., invalid encoding) and return false
    return false;
  }
}

/**
 * Express middleware factory for LINE webhook HMAC verification.
 *
 * @param {Function} getSecret - Async function that resolves the channel secret
 * @returns {Function} Express middleware (req, res, next)
 */
function lineSignatureMiddleware(getSecret) {
  return async (req, res, next) => {
    // Check for rawBody (set by bodyParser verify hook in server/index.js)
    if (!req.rawBody) {
      console.error("rawBody missing — check bodyParser verify hook");
      return res.status(500).json({ error: "Internal server error" });
    }

    // Get signature from header
    const signature = req.get("x-line-signature");

    // Get channel secret
    let channelSecret;
    try {
      channelSecret = await getSecret();
    } catch (err) {
      console.error("Failed to retrieve channel secret:", err.message);
      return res.status(500).json({ error: "Internal server error" });
    }

    // Verify signature
    if (!verifyLineSignature(req.rawBody, signature, channelSecret)) {
      console.log("LINE HMAC verification failed");
      return res.status(401).json({ error: "Invalid signature" });
    }

    // Signature valid, proceed
    next();
  };
}

module.exports = {
  verifyLineSignature,
  lineSignatureMiddleware,
};
