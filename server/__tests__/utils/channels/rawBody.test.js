const http = require("http");
const bodyParser = require("body-parser");
const express = require("express");

describe("rawBody capture for webhook signature verification", () => {
  let server;
  let port;

  beforeEach((done) => {
    const app = express();
    const FILE_LIMIT = "3GB";

    // Replicate the exact bodyParser.json mount from server/index.js
    // with the verify hook that captures rawBody
    app.use(
      bodyParser.json({
        limit: FILE_LIMIT,
        verify: (req, _res, buf) => {
          req.rawBody = buf.toString("utf8");
        },
      })
    );

    // Test endpoint that echoes back what it received
    app.post("/test", (req, res) => {
      res.json({
        rawBody: req.rawBody,
        parsedBody: req.body,
      });
    });

    server = app.listen(0, () => {
      port = server.address().port;
      done();
    });
  });

  afterEach((done) => {
    if (server) {
      server.close(done);
    } else {
      done();
    }
  });

  it("should capture rawBody as a string equal to the sent body", async () => {
    const testBody = '{"events":[],"x":"ü"}';

    const response = await fetch(`http://localhost:${port}/test`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: testBody,
    });

    const result = await response.json();

    // Assert rawBody is a string
    expect(typeof result.rawBody).toBe("string");

    // Assert rawBody is strictly equal to the sent body (byte-exact, including unicode)
    expect(result.rawBody).toBe(testBody);
  });

  it("should still parse req.body correctly as JSON", async () => {
    const testBody = '{"events":[],"x":"ü"}';

    const response = await fetch(`http://localhost:${port}/test`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: testBody,
    });

    const result = await response.json();

    // Assert req.body is correctly parsed
    expect(result.parsedBody).toEqual({
      events: [],
      x: "ü",
    });
  });

  it("should handle complex JSON with nested structures", async () => {
    const testBody = JSON.stringify({
      events: [
        {
          type: "message",
          replyToken: "rt-test",
          timestamp: 1234567890,
          source: {
            type: "user",
            userId: "Uabcdef1234567890abcdef1234567890",
          },
          message: {
            type: "text",
            text: "hello ü",
          },
        },
      ],
    });

    const response = await fetch(`http://localhost:${port}/test`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: testBody,
    });

    const result = await response.json();

    // Assert rawBody matches exactly
    expect(result.rawBody).toBe(testBody);

    // Assert body is parsed correctly
    expect(result.parsedBody.events).toHaveLength(1);
    expect(result.parsedBody.events[0].message.text).toBe("hello ü");
  });

  it("should preserve multibyte UTF-8 characters in rawBody", async () => {
    const testBody = '{"text":"こんにちは"}'; // Japanese "hello"

    const response = await fetch(`http://localhost:${port}/test`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: testBody,
    });

    const result = await response.json();

    // Assert rawBody preserves the exact UTF-8 bytes
    expect(result.rawBody).toBe(testBody);
    expect(result.parsedBody.text).toBe("こんにちは");
  });
});
