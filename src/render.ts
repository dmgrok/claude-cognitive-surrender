import chalk from 'chalk';

export function stripAnsi(str: string): string {
  return str.replace(/\x1B\[[0-9;]*m/g, '');
}

export function padRight(str: string, width: number): string {
  const len = stripAnsi(str).length;
  return len >= width ? str : str + ' '.repeat(width - len);
}

export function padLeft(str: string, width: number): string {
  const len = stripAnsi(str).length;
  return len >= width ? str : ' '.repeat(width - len) + str;
}

interface ColorStop {
  pos: number;
  r: number;
  g: number;
  b: number;
}

const SEVERITY_STOPS: ColorStop[] = [
  { pos: 0.0, r: 34,  g: 197, b: 94  }, // green
  { pos: 0.5, r: 234, g: 179, b: 8   }, // amber
  { pos: 1.0, r: 239, g: 68,  b: 68  }, // red
];

function lerpColor(t: number, stops: ColorStop[]): [number, number, number] {
  const clamped = Math.max(0, Math.min(1, t));
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    if (clamped >= a.pos && clamped <= b.pos) {
      const s = (clamped - a.pos) / (b.pos - a.pos);
      return [
        Math.round(a.r + s * (b.r - a.r)),
        Math.round(a.g + s * (b.g - a.g)),
        Math.round(a.b + s * (b.b - a.b)),
      ];
    }
  }
  const last = stops[stops.length - 1];
  return [last.r, last.g, last.b];
}

export function gradientBar(value: number, max: number, width: number): string {
  const filled = Math.round((value / max) * width);
  let result = '';
  for (let i = 0; i < width; i++) {
    if (i < filled) {
      const [r, g, b] = lerpColor(i / (width - 1), SEVERITY_STOPS);
      result += chalk.rgb(r, g, b)('█');
    } else {
      result += chalk.rgb(60, 60, 60)('░');
    }
  }
  return result;
}

const SPARK_CHARS = '▁▂▃▄▅▆▇█';

export function sparkChar(ratio: number): string {
  const idx = Math.min(7, Math.floor(ratio * 8));
  return SPARK_CHARS[idx];
}

export function sparkline(values: number[]): string {
  if (values.length === 0) return '';
  const max = Math.max(...values);
  return values.map(v => {
    const ratio = max === 0 ? 0 : v / max;
    const [r, g, b] = lerpColor(ratio, SEVERITY_STOPS);
    return chalk.rgb(r, g, b)(sparkChar(ratio));
  }).join('');
}

export function gradientText(text: string, startHex: string, endHex: string): string {
  const sr = parseInt(startHex.slice(1, 3), 16);
  const sg = parseInt(startHex.slice(3, 5), 16);
  const sb = parseInt(startHex.slice(5, 7), 16);
  const er = parseInt(endHex.slice(1, 3), 16);
  const eg = parseInt(endHex.slice(3, 5), 16);
  const eb = parseInt(endHex.slice(5, 7), 16);
  if (text.length === 0) return text;
  return text.split('').map((ch, i) => {
    const t = text.length === 1 ? 0 : i / (text.length - 1);
    const r = Math.round(sr + t * (er - sr));
    const g = Math.round(sg + t * (eg - sg));
    const b = Math.round(sb + t * (eb - sb));
    return chalk.rgb(r, g, b)(ch);
  }).join('');
}

const FLAME_CHARS = '▁▃▅▇█';
const FLAME_STOPS: ColorStop[] = [
  { pos: 0.0, r: 255, g: 200, b: 0   },
  { pos: 0.5, r: 255, g: 120, b: 0   },
  { pos: 1.0, r: 239, g: 50,  b: 30  },
];

export function flameBar(level: number, maxWidth = 20): string {
  const len = Math.min(level, maxWidth);
  let result = '';
  for (let i = 0; i < len; i++) {
    const t = len <= 1 ? 0 : i / (len - 1);
    const [r, g, b] = lerpColor(t, FLAME_STOPS);
    const ch = FLAME_CHARS[Math.min(4, Math.floor((i / len) * 5))];
    result += chalk.rgb(r, g, b)(ch);
  }
  return result;
}

export function highlightNumbers(text: string): string {
  return text.replace(/\b(\d+(?:\.\d+)?%?(?:s|ms)?)\b/g, (m) =>
    chalk.bold.hex('#f59e0b')(m)
  );
}

export function divider(width = 65, style: 'thin' | 'dashed' = 'thin'): string {
  const ch = style === 'dashed' ? '╌' : '─';
  return chalk.dim('  ' + ch.repeat(width));
}

interface BoxOpts {
  style?: 'single' | 'double' | 'heavy' | 'rounded';
  title?: string;
  gradientBorder?: boolean;
  width?: number;
  indent?: number;
}

export function box(lines: string[], opts: BoxOpts = {}): string {
  const { style = 'single', title, gradientBorder = false, width = 65, indent = 2 } = opts;
  const pad = ' '.repeat(indent);

  const chars = {
    single:  { tl: '┌', tr: '┐', bl: '└', br: '┘', h: '─', v: '│', th: '─', bh: '─' },
    double:  { tl: '╔', tr: '╗', bl: '╚', br: '╝', h: '═', v: '║', th: '═', bh: '═' },
    heavy:   { tl: '┏', tr: '┓', bl: '┗', br: '┛', h: '━', v: '┃', th: '━', bh: '━' },
    rounded: { tl: '╭', tr: '╮', bl: '╰', br: '╯', h: '─', v: '│', th: '─', bh: '─' },
  }[style];

  const innerWidth = width;

  function renderBorderRow(left: string, right: string, hch: string, titleStr?: string): string {
    let fill: string;
    if (titleStr) {
      const titlePad = ` ${titleStr} `;
      const sides = innerWidth - stripAnsi(titlePad).length;
      const l = Math.floor(sides / 2);
      const r = sides - l;
      fill = hch.repeat(l) + titlePad + hch.repeat(r);
    } else {
      fill = hch.repeat(innerWidth);
    }

    if (gradientBorder) {
      const raw = stripAnsi(fill);
      const gradFill = gradientText(raw, '#f59e0b', '#ef4444');
      return pad + chalk.hex('#f59e0b')(left) + gradFill + chalk.hex('#ef4444')(right);
    }
    return pad + chalk.dim(left + fill + right);
  }

  function renderContentRow(content: string): string {
    const vch = gradientBorder ? chalk.hex('#f59e0b')(chars.v) : chalk.dim(chars.v);
    const contentLen = stripAnsi(content).length;
    const rightPad = ' '.repeat(Math.max(0, innerWidth - contentLen - 2));
    return pad + vch + ' ' + content + rightPad + ' ' + vch;
  }

  const result: string[] = [];
  result.push(renderBorderRow(chars.tl, chars.tr, chars.h, title));
  result.push(renderContentRow(''));
  for (const line of lines) {
    const maxContent = innerWidth - 2;
    const words = line.split(' ');
    const wrapped: string[] = [];
    let cur = '';
    for (const word of words) {
      if (stripAnsi(cur).length + stripAnsi(word).length + (cur ? 1 : 0) > maxContent) {
        if (cur) wrapped.push(cur);
        cur = word;
      } else {
        cur = cur ? `${cur} ${word}` : word;
      }
    }
    if (cur) wrapped.push(cur);
    if (wrapped.length === 0) wrapped.push('');
    for (const w of wrapped) result.push(renderContentRow(w));
  }
  result.push(renderContentRow(''));
  result.push(renderBorderRow(chars.bl, chars.br, chars.h));
  return result.join('\n');
}

interface TableOpts {
  rightAlign?: number[];
  alternateRows?: boolean;
  indent?: number;
}

export function table(headers: string[], rows: string[][], opts: TableOpts = {}): string {
  const { rightAlign = [], alternateRows = true, indent = 2 } = opts;
  const pad = ' '.repeat(indent);
  const allRows = [headers, ...rows];
  const colWidths = headers.map((_, i) =>
    Math.max(...allRows.map(r => stripAnsi(r[i] ?? '').length))
  );

  function fmt(row: string[], isHeader = false, dimRow = false): string {
    const cells = row.map((cell, i) => {
      const w = colWidths[i];
      const align = rightAlign.includes(i) ? padLeft(cell, w) : padRight(cell, w);
      if (isHeader) return chalk.bold(align);
      if (dimRow) return chalk.dim(align);
      return align;
    });
    const sep = chalk.dim(' │ ');
    return pad + cells.join(sep);
  }

  const separator = pad + colWidths.map(w => '─'.repeat(w)).join('─┼─');

  const lines: string[] = [];
  lines.push(fmt(headers, true));
  lines.push(chalk.dim(separator));
  rows.forEach((row, i) => lines.push(fmt(row, false, alternateRows && i % 2 === 1)));
  return lines.join('\n');
}
