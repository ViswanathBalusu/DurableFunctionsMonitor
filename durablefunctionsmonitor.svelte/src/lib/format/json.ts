// JSON display rule (decision D4, contracts §9): every JSON value shown in the UI is pretty-printed
// with two spaces and fully expanded, except a one-line truncated preview inside a table cell.

/** The syntax-highlight class for one token of pretty-printed JSON text, or '' for plain whitespace. */
export type JsonTokenClass = 'jk' | 'js' | 'jn' | 'jb' | 'jz' | 'jp' | '';

export interface JsonToken {
  cls: JsonTokenClass;
  text: string;
}

interface ParseResult {
  ok: boolean;
  value?: unknown;
}

function tryParseJson(text: string): ParseResult {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

/**
 * The backend sometimes returns JSON encoded as a string (an orchestration's Input/Output column
 * is itself a JSON-serialised value). Strings that parse as JSON are parsed; when the parsed result
 * is itself a string that also parses as JSON (double-encoded), it is parsed one more time - but no
 * further. Everything else (already-parsed values, non-JSON strings) is returned as is.
 */
export function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }

  const outer = tryParseJson(value);
  if (!outer.ok) {
    return value;
  }

  if (typeof outer.value === 'string') {
    const inner = tryParseJson(outer.value);
    if (inner.ok) {
      return inner.value;
    }
  }

  return outer.value;
}

/**
 * Pretty-prints a value with two-space indentation, fully expanded. `null`/`undefined` render as an
 * empty string. A string that does not parse as JSON is returned unchanged (contracts §9).
 */
export function formatJson(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value !== 'string') {
    return JSON.stringify(value, null, 2);
  }

  const outer = tryParseJson(value);
  if (!outer.ok) {
    return value;
  }

  return JSON.stringify(parseMaybeJson(value), null, 2);
}

/**
 * A single-line, whitespace-collapsed preview for table cells - the only place JSON is not fully
 * expanded (contracts §9). JSON values render compact (`JSON.stringify` without indentation); plain
 * strings have their internal whitespace collapsed to single spaces. Truncated with an ellipsis
 * beyond `max` characters.
 */
export function previewJson(value: unknown, max = 120): string {
  if (value === null || value === undefined) {
    return '';
  }

  const normalized = parseMaybeJson(value);
  const text = (typeof normalized === 'string' ? normalized : JSON.stringify(normalized)).replace(/\s+/g, ' ').trim();

  return text.length > max ? `${text.slice(0, max)}…` : text;
}

const TOKEN_PATTERN = /"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|[{}[\],:]|\s+/g;

function classify(raw: string, text: string, index: number): JsonTokenClass {
  if (raw.charCodeAt(0) === 34 /* " */) {
    let i = index + raw.length;
    while (i < text.length && /\s/.test(text[i])) {
      i++;
    }
    return text[i] === ':' ? 'jk' : 'js';
  }

  if (raw === 'true' || raw === 'false') {
    return 'jb';
  }

  if (raw === 'null') {
    return 'jz';
  }

  if (raw === '{' || raw === '}' || raw === '[' || raw === ']' || raw === ',' || raw === ':') {
    return 'jp';
  }

  if (/^-?\d/.test(raw)) {
    return 'jn';
  }

  // whitespace (or, defensively, anything unrecognised)
  return '';
}

/**
 * Tokenizes pretty-printed JSON text (as produced by `formatJson`) into spans for syntax
 * highlighting: keys (`jk`), strings (`js`), numbers (`jn`), booleans (`jb`), `null` (`jz`),
 * punctuation (`jp`), and plain whitespace (`''`). Used by `JsonPre`.
 */
export function tokenizeJson(text: string): JsonToken[] {
  const tokens: JsonToken[] = [];
  let lastIndex = 0;
  TOKEN_PATTERN.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = TOKEN_PATTERN.exec(text))) {
    if (match.index > lastIndex) {
      tokens.push({ cls: '', text: text.slice(lastIndex, match.index) });
    }

    const raw = match[0];
    tokens.push({ cls: classify(raw, text, match.index), text: raw });
    lastIndex = TOKEN_PATTERN.lastIndex;
  }

  if (lastIndex < text.length) {
    tokens.push({ cls: '', text: text.slice(lastIndex) });
  }

  return tokens;
}

/**
 * Whether a field value is a blob-backed reference (a large payload offloaded by the engine) rather
 * than inline JSON: an absolute `http(s)://` URL whose path ends in a blob name (contracts §9).
 */
export function isBlobUrl(value: unknown): boolean {
  if (typeof value !== 'string' || !/^https?:\/\//i.test(value)) {
    return false;
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  const segments = url.pathname.split('/').filter((s) => s.length > 0);
  return segments.length >= 2;
}
