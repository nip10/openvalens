/**
 * Streams JSON Lines (one JSON value per line) without loading the artifact
 * into memory. A malformed line yields `null`, which every adapter rejects,
 * so it is counted rather than aborting the import or being logged.
 */
export async function* readJsonLines(
  chunks: AsyncIterable<Uint8Array | string>,
): AsyncGenerator<unknown> {
  const decoder = new TextDecoder();
  let buffer = "";
  const parse = (line: string): unknown => {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  };
  for await (const chunk of chunks) {
    buffer += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) yield parse(line);
      newline = buffer.indexOf("\n");
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) yield parse(buffer.trim());
}
