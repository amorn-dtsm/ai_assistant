const {
  stripMarkdownForLine,
  splitForLine,
  batchMessages,
} = require("../../../../utils/channels/line/format");

describe("LINE format utils", () => {
  describe("stripMarkdownForLine", () => {
    test("strips bold markdown markers", () => {
      const input = "This is **bold** text";
      const result = stripMarkdownForLine(input);
      expect(result).toBe("This is bold text");
    });

    test("strips header markdown markers", () => {
      const input = "# Header\nSome text";
      const result = stripMarkdownForLine(input);
      expect(result).toBe("Header\nSome text");
    });

    test("converts markdown links to plain text with URL", () => {
      const input = "Check [this link](https://example.com) out";
      const result = stripMarkdownForLine(input);
      expect(result).toBe("Check this link (https://example.com) out");
    });

    test("preserves content inside code fences without fence markers", () => {
      const input = "Here is code:\n```\nconst x = 1;\n```\nEnd";
      const result = stripMarkdownForLine(input);
      expect(result).toBe("Here is code:\nconst x = 1;\nEnd");
    });

    test("handles multiple markdown elements", () => {
      const input = "# Title\n**Bold** and [link](http://x.com)\n```\ncode\n```";
      const result = stripMarkdownForLine(input);
      expect(result).toBe("Title\nBold and link (http://x.com)\ncode");
    });
  });

  describe("splitForLine", () => {
    test("splits 12000-char text into chunks each ≤4500 chars", () => {
      const input = "A".repeat(12000);
      const chunks = splitForLine(input);
      expect(chunks.length).toBeGreaterThanOrEqual(3);
      chunks.forEach((chunk) => {
        expect(chunk.length).toBeLessThanOrEqual(4500);
      });
    });

    test("returns empty array for empty string", () => {
      const result = splitForLine("");
      expect(result).toEqual([]);
    });

    test("returns empty array for whitespace-only input", () => {
      const result = splitForLine("   \n\t  ");
      expect(result).toEqual([]);
    });

    test("never splits inside a fenced code block", () => {
      // Create a test string with a ~3000-char code block embedded in filler
      const intro = "intro ".repeat(400); // ~2400 chars
      const codeBlock = "```\n" + "x".repeat(3000) + "\n```";
      const input = intro + codeBlock;

      const chunks = splitForLine(input);

      // Every chunk must have an EVEN count of ``` markers (no open fences)
      chunks.forEach((chunk) => {
        const fenceCount = (chunk.match(/```/g) || []).length;
        expect(fenceCount % 2).toBe(0);
      });
    });

    test("respects custom maxChars parameter", () => {
      const input = "A".repeat(5000);
      const chunks = splitForLine(input, 2000);
      chunks.forEach((chunk) => {
        expect(chunk.length).toBeLessThanOrEqual(2000);
      });
    });
  });

  describe("batchMessages", () => {
    test("groups 3 chunks into 1 batch of 3", () => {
      const chunks = ["msg1", "msg2", "msg3"];
      const batches = batchMessages(chunks);
      expect(batches.length).toBe(1);
      expect(batches[0]).toEqual(chunks);
    });

    test("groups 8 chunks into 2 batches shaped [5,3]", () => {
      const chunks = Array.from({ length: 8 }, (_, i) => `msg${i + 1}`);
      const batches = batchMessages(chunks);
      expect(batches.length).toBe(2);
      expect(batches[0].length).toBe(5);
      expect(batches[1].length).toBe(3);
    });

    test("enforces maxPerCall=5 by default", () => {
      const chunks = Array.from({ length: 12 }, (_, i) => `msg${i + 1}`);
      const batches = batchMessages(chunks);
      batches.forEach((batch) => {
        expect(batch.length).toBeLessThanOrEqual(5);
      });
    });

    test("respects custom maxPerCall parameter", () => {
      const chunks = Array.from({ length: 10 }, (_, i) => `msg${i + 1}`);
      const batches = batchMessages(chunks, 3);
      batches.forEach((batch) => {
        expect(batch.length).toBeLessThanOrEqual(3);
      });
    });

    test("returns empty array for empty chunks", () => {
      const result = batchMessages([]);
      expect(result).toEqual([]);
    });
  });
});
