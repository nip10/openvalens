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

const WHITESPACE = new Set([" ", "\n", "\r", "\t"]);

/**
 * Streams the items of a JSON document's item array without loading the
 * document into memory: the top-level array itself, or the first array that
 * is a direct value of the top-level object. That is the shape of a USDA
 * FoodData Central download (`{"FoundationFoods": [ ... ]}`), whose branded
 * file is several gigabytes. Nested arrays stay inside their item. A
 * malformed item yields `null`, which every adapter rejects.
 */
export async function* readJsonArrayItems(
  chunks: AsyncIterable<Uint8Array | string>,
): AsyncGenerator<unknown> {
  const decoder = new TextDecoder();
  const parse = (text: string): unknown => {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  };
  let depth = 0;
  let itemsDepth = -1;
  let inString = false;
  let escaped = false;
  let capturing = false;
  let primitive = false;
  let carried = "";
  let done = false;

  const consume = function* (text: string): Generator<unknown> {
    let from = 0;
    for (let i = 0; i < text.length && !done; i += 1) {
      const ch = text[i]!;
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (!capturing && depth === itemsDepth && !WHITESPACE.has(ch) && ch !== "," && ch !== "]") {
        capturing = true;
        primitive = ch !== "{" && ch !== "[";
        carried = "";
        from = i;
      }
      if (ch === '"') {
        inString = true;
      } else if (ch === "{" || ch === "[") {
        depth += 1;
        if (ch === "[" && itemsDepth === -1 && depth <= 2) itemsDepth = depth;
      } else if (ch === "}" || ch === "]") {
        if (capturing && primitive && depth === itemsDepth) {
          capturing = false;
          yield parse(carried + text.slice(from, i));
        }
        depth -= 1;
        if (capturing && !primitive && depth === itemsDepth) {
          capturing = false;
          yield parse(carried + text.slice(from, i + 1));
        }
        if (ch === "]" && depth === itemsDepth - 1) done = true;
      } else if (ch === "," && capturing && primitive && depth === itemsDepth) {
        capturing = false;
        yield parse(carried + text.slice(from, i));
      }
    }
    if (capturing) carried += text.slice(from);
  };

  for await (const chunk of chunks) {
    yield* consume(typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true }));
    if (done) return;
  }
  yield* consume(decoder.decode());
}
