/**
 * Moves vendored body artwork (see `./body-map-paths/README.md`) into the
 * body map's own 200 × 400 view box, so both renderers share one coordinate
 * system whichever figure they draw.
 *
 * `normalizePath` rewrites SVG path data as absolute, upper-case commands
 * with every point scaled and shifted, and reports the drawn points' x range
 * so a part can be assigned to the member's left or right by where it sits.
 */

export type PathTransform = { scale: number; dx: number; dy: number };

export type NormalizedPath = {
  /** Absolute commands only (`M`, `L`, `H`, `V`, `C`, `S`, `Q`, `T`, `A`, `Z`). */
  d: string;
  minX: number;
  maxX: number;
};

const ARITY: Readonly<Record<string, number>> = {
  M: 2,
  L: 2,
  H: 1,
  V: 1,
  C: 6,
  S: 4,
  Q: 4,
  T: 2,
  A: 7,
  Z: 0,
};

const NUMBER = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/y;

function round(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

/**
 * Fits a source view box (`minX minY width height`) into 200 × 400, keeping
 * the aspect ratio and centring the figure.
 */
export function fitViewBox(viewBox: string, width = 200, height = 400): PathTransform {
  const [vx, vy, vw, vh] = viewBox
    .trim()
    .split(/[\s,]+/)
    .map(Number) as [number, number, number, number];
  const scale = Math.min(width / vw, height / vh);
  return {
    scale,
    dx: (width - vw * scale) / 2 - vx * scale,
    dy: (height - vh * scale) / 2 - vy * scale,
  };
}

export function normalizePath(source: string, transform: PathTransform): NormalizedPath {
  const { scale, dx, dy } = transform;
  const X = (x: number) => x * scale + dx;
  const Y = (y: number) => y * scale + dy;
  let index = 0;
  const skip = () => {
    while (index < source.length && /[\s,]/.test(source[index]!)) index++;
  };
  const number = (): number => {
    skip();
    NUMBER.lastIndex = index;
    const match = NUMBER.exec(source);
    if (!match) throw new Error(`Bad path number at ${index}: ${source.slice(index, index + 20)}`);
    index = NUMBER.lastIndex;
    return Number(match[0]);
  };
  // Arc flags are single digits and may run into the next number ("012.89").
  const flag = (): number => {
    skip();
    const char = source[index];
    if (char !== "0" && char !== "1") throw new Error(`Bad arc flag at ${index}`);
    index++;
    return Number(char);
  };

  const out: string[] = [];
  let minX = Infinity;
  let maxX = -Infinity;
  const point = (x: number) => {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
  };
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  let command = "";
  let open = false;

  for (;;) {
    skip();
    if (index >= source.length) break;
    const char = source[index]!;
    if (/[a-zA-Z]/.test(char)) {
      command = char;
      index++;
    } else if (!command || command === "z" || command === "Z") {
      throw new Error(`Path data without a command at ${index}`);
    } else if (command === "m") {
      command = "l";
    } else if (command === "M") {
      command = "L";
    }
    const upper = command.toUpperCase();
    if (!(upper in ARITY)) throw new Error(`Unknown path command ${command}`);
    const relative = command !== upper;
    const ox = relative ? x : 0;
    const oy = relative ? y : 0;

    switch (upper) {
      case "Z":
        out.push("Z");
        x = startX;
        y = startY;
        open = false;
        break;
      case "M":
      case "L":
      case "T": {
        if (upper === "M" && open) out.push("Z");
        x = ox + number();
        y = oy + number();
        if (upper === "M") {
          startX = x;
          startY = y;
          open = true;
        }
        point(x);
        out.push(`${upper}${round(X(x))} ${round(Y(y))}`);
        break;
      }
      case "H":
        x = ox + number();
        point(x);
        out.push(`H${round(X(x))}`);
        break;
      case "V":
        y = oy + number();
        out.push(`V${round(Y(y))}`);
        break;
      case "C":
      case "S":
      case "Q": {
        const pairs = ARITY[upper]! / 2;
        const coords: string[] = [];
        for (let pair = 0; pair < pairs; pair++) {
          const px = ox + number();
          const py = oy + number();
          coords.push(`${round(X(px))} ${round(Y(py))}`);
          if (pair === pairs - 1) {
            x = px;
            y = py;
            point(x);
          }
        }
        out.push(`${upper}${coords.join(" ")}`);
        break;
      }
      case "A": {
        const rx = number();
        const ry = number();
        const rotation = number();
        const large = flag();
        const sweep = flag();
        x = ox + number();
        y = oy + number();
        point(x);
        out.push(
          `A${round(rx * scale)} ${round(ry * scale)} ${round(rotation)} ${large} ${sweep} ${round(X(x))} ${round(Y(y))}`,
        );
        break;
      }
    }
  }
  if (open) out.push("Z");
  return { d: out.join(""), minX: X(minX), maxX: X(maxX) };
}
