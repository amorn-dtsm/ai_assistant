const {
  replyMessage,
  pushMessage,
  getBotInfo,
  LINE_API_BASE,
} = require("../../../../utils/channels/line/client");

describe("LINE API Client", () => {
  const TOKEN = "test-channel-access-token";
  let fetchSpy;

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  describe("LINE_API_BASE constant", () => {
    it("should export the LINE API base URL", () => {
      expect(LINE_API_BASE).toBe("https://api.line.me");
    });
  });

  describe("replyMessage", () => {
    const REPLY_TOKEN = "test-reply-token-abc";

    it("(a) should POST to /v2/bot/message/reply with correct headers and body", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({}),
      });

      const result = await replyMessage(TOKEN, REPLY_TOKEN, ["Hello", "World"]);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, opts] = fetchSpy.mock.calls[0];
      expect(url).toBe("https://api.line.me/v2/bot/message/reply");
      expect(opts.method).toBe("POST");
      expect(opts.headers["Authorization"]).toBe(`Bearer ${TOKEN}`);
      expect(opts.headers["Content-Type"]).toBe("application/json");

      const body = JSON.parse(opts.body);
      expect(body.replyToken).toBe(REPLY_TOKEN);
      expect(body.messages).toEqual([
        { type: "text", text: "Hello" },
        { type: "text", text: "World" },
      ]);
      expect(result).toEqual({ success: true });
    });

    it("(a2) should reject when texts exceed 5-message limit", async () => {
      const sixTexts = ["a", "b", "c", "d", "e", "f"];
      await expect(replyMessage(TOKEN, REPLY_TOKEN, sixTexts)).rejects.toThrow(
        /5.message/i
      );
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("(d) should return {success: false} on non-2xx reply response", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ message: "Bad request" }),
      });

      const result = await replyMessage(TOKEN, REPLY_TOKEN, ["Hi"]);
      expect(result.success).toBe(false);
      expect(result.status).toBe(400);
      expect(result.error).toBeDefined();
    });

    it("(e) should return {success: false} on network error (fetch rejects)", async () => {
      fetchSpy.mockRejectedValueOnce(new Error("Network failure"));

      const result = await replyMessage(TOKEN, REPLY_TOKEN, ["Hi"]);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Network failure/);
    });
  });

  describe("pushMessage", () => {
    const TO = "U1234567890abcdef";

    it("(b) should POST to /v2/bot/message/push with correct body shape", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({}),
      });

      const result = await pushMessage(TOKEN, TO, ["Push text"]);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, opts] = fetchSpy.mock.calls[0];
      expect(url).toBe("https://api.line.me/v2/bot/message/push");
      expect(opts.method).toBe("POST");
      expect(opts.headers["Authorization"]).toBe(`Bearer ${TOKEN}`);

      const body = JSON.parse(opts.body);
      expect(body.to).toBe(TO);
      expect(body.messages).toEqual([{ type: "text", text: "Push text" }]);
      expect(result).toEqual({ success: true });
    });

    it("(b2) should reject when texts exceed 5-message limit", async () => {
      await expect(
        pushMessage(TOKEN, TO, ["1", "2", "3", "4", "5", "6"])
      ).rejects.toThrow(/5.message/i);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("(d2) should return {success: false} on non-2xx push response", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: false,
        status: 429,
        json: async () => ({ message: "Rate limited" }),
      });

      const result = await pushMessage(TOKEN, TO, ["Hi"]);
      expect(result.success).toBe(false);
      expect(result.status).toBe(429);
      expect(result.error).toBeDefined();
    });

    it("(e2) should return {success: false} on network error", async () => {
      fetchSpy.mockRejectedValueOnce(new Error("DNS resolution failed"));

      const result = await pushMessage(TOKEN, TO, ["Hi"]);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/DNS resolution failed/);
    });
  });

  describe("getBotInfo", () => {
    it("(c) should GET /v2/bot/info and return {valid, basicId, displayName} on 200", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          userId: "U0123456789abcdef0123456789abcdef",
          basicId: "@bot123",
          displayName: "Test Bot",
          pictureUrl: "https://example.com/pic.png",
        }),
      });

      const result = await getBotInfo(TOKEN);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, opts] = fetchSpy.mock.calls[0];
      expect(url).toBe("https://api.line.me/v2/bot/info");
      expect(opts.method).toBe("GET");
      expect(opts.headers["Authorization"]).toBe(`Bearer ${TOKEN}`);

      expect(result).toEqual({
        valid: true,
        basicId: "@bot123",
        displayName: "Test Bot",
      });
    });

    it("(c2) should return {valid: false, error} on 401", async () => {
      fetchSpy.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ message: "Authentication failed" }),
      });

      const result = await getBotInfo(TOKEN);
      expect(result).toEqual({
        valid: false,
        error: "Authentication failed",
      });
    });

    it("(c3) should return {valid: false, error} on network error", async () => {
      fetchSpy.mockRejectedValueOnce(new Error("Timeout"));

      const result = await getBotInfo(TOKEN);
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/Timeout/);
    });
  });

  describe("AbortSignal.timeout usage", () => {
    it("should pass signal option to every fetch call", async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ basicId: "@b", displayName: "B" }),
      });

      await replyMessage(TOKEN, "rt", ["Hi"]);
      await pushMessage(TOKEN, "U1", ["Hi"]);
      await getBotInfo(TOKEN);

      expect(fetchSpy).toHaveBeenCalledTimes(3);
      for (const call of fetchSpy.mock.calls) {
        expect(call[1].signal).toBeDefined();
      }
    });
  });
});
