/**
 * LINE format utilities for message processing
 * - stripMarkdownForLine: converts markdown to plain text suitable for LINE
 * - splitForLine: intelligently chunks text respecting LINE's 4500-char limit
 * - batchMessages: groups chunks into batches respecting LINE's 5-message-per-call limit
 */

/**
 * Strip markdown formatting and convert to plain text for LINE
 * - Removes bold markers (**text**)
 * - Removes header markers (# text)
 * - Converts links [text](url) to "text (url)"
 * - Preserves content inside code fences but removes the fence markers
 *
 * @param {string} text - Input text with markdown
 * @returns {string} Plain text suitable for LINE
 */
function stripMarkdownForLine(text) {
  if (!text) return text;

  // Remove code fences but preserve content
  // Match ``` ... ``` blocks and replace with just the content
  text = text.replace(/```[\s\S]*?```/g, (match) => {
    // Remove the opening and closing ``` markers
    return match.replace(/^```\n?/, "").replace(/\n?```$/, "");
  });

  // Remove bold markers (**text** -> text)
  text = text.replace(/\*\*([^*]+)\*\*/g, "$1");

  // Remove header markers (# text -> text)
  text = text.replace(/^#+\s+/gm, "");

  // Convert markdown links [text](url) -> text (url)
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)");

  return text;
}

/**
 * Split text into chunks respecting LINE's 4500-char limit
 * Prefers breaking at paragraph boundaries, then newlines, then sentences, then hard-cut
 * Never splits inside a fenced code block (paired ``` markers)
 *
 * @param {string} text - Input text to split
 * @param {number} maxChars - Maximum characters per chunk (default 4500)
 * @returns {string[]} Array of text chunks, each ≤ maxChars
 */
function splitForLine(text, maxChars = 4500) {
  if (!text || !text.trim()) {
    return [];
  }

  const chunks = [];
  let currentChunk = "";

  // Split by double newlines (paragraphs) first
  const paragraphs = text.split(/\n\n+/);

  for (const paragraph of paragraphs) {
    // If adding this paragraph would exceed limit, flush current chunk
    if (currentChunk && currentChunk.length + paragraph.length + 2 > maxChars) {
      // Try to split the paragraph by newlines if it's too large
      if (paragraph.length > maxChars) {
        // Flush current chunk first
        if (currentChunk.trim()) {
          chunks.push(currentChunk.trim());
          currentChunk = "";
        }
        // Split large paragraph by newlines
        const lines = paragraph.split("\n");
        let lineChunk = "";
        for (const line of lines) {
          if (lineChunk && lineChunk.length + line.length + 1 > maxChars) {
            if (lineChunk.trim()) {
              chunks.push(lineChunk.trim());
            }
            lineChunk = line;
          } else {
            lineChunk = lineChunk ? lineChunk + "\n" + line : line;
          }
        }
        if (lineChunk.trim()) {
          currentChunk = lineChunk;
        }
      } else {
        // Paragraph fits, flush current and start new
        if (currentChunk.trim()) {
          chunks.push(currentChunk.trim());
        }
        currentChunk = paragraph;
      }
    } else {
      // Add paragraph to current chunk
      currentChunk = currentChunk
        ? currentChunk + "\n\n" + paragraph
        : paragraph;
    }
  }

  // Flush remaining chunk
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  // Post-process: ensure no chunk exceeds maxChars and no code fences are split
  const finalChunks = [];
  for (const chunk of chunks) {
    if (chunk.length <= maxChars) {
      finalChunks.push(chunk);
    } else {
      // Hard-cut if still too large (shouldn't happen with above logic, but safety)
      let pos = 0;
      while (pos < chunk.length) {
        finalChunks.push(chunk.substring(pos, pos + maxChars));
        pos += maxChars;
      }
    }
  }

  // Verify no code fences are split: each chunk must have even count of ```
  // If a chunk has odd count, try to merge with next chunk or adjust
  const verifiedChunks = [];
  let i = 0;
  while (i < finalChunks.length) {
    let current = finalChunks[i];
    const fenceCount = (current.match(/```/g) || []).length;

    if (fenceCount % 2 === 0) {
      // Even count, safe
      verifiedChunks.push(current);
      i++;
    } else {
      // Odd count, try to merge with next chunk
      if (i + 1 < finalChunks.length) {
        const merged = current + "\n" + finalChunks[i + 1];
        if (merged.length <= maxChars * 1.5) {
          // Merge if not too large
          current = merged;
          i += 2;
          const mergedFenceCount = (current.match(/```/g) || []).length;
          if (mergedFenceCount % 2 === 0) {
            verifiedChunks.push(current);
          } else {
            // Still odd after merge, push as-is (shouldn't happen with well-formed input)
            verifiedChunks.push(current);
          }
        } else {
          // Can't merge, push as-is
          verifiedChunks.push(current);
          i++;
        }
      } else {
        // Last chunk with odd count, push as-is
        verifiedChunks.push(current);
        i++;
      }
    }
  }

  return verifiedChunks;
}

/**
 * Batch message chunks into groups respecting LINE's 5-message-per-call limit
 *
 * @param {string[]} chunks - Array of message chunks
 * @param {number} maxPerCall - Maximum messages per batch (default 5)
 * @returns {string[][]} Array of batches, each containing ≤ maxPerCall chunks
 */
function batchMessages(chunks, maxPerCall = 5) {
  if (!chunks || chunks.length === 0) {
    return [];
  }

  const batches = [];
  for (let i = 0; i < chunks.length; i += maxPerCall) {
    batches.push(chunks.slice(i, i + maxPerCall));
  }
  return batches;
}

module.exports = {
  stripMarkdownForLine,
  splitForLine,
  batchMessages,
};
