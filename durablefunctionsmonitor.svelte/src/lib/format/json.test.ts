import { describe, expect, it } from 'vitest';
import { formatJson, isBlobUrl, parseMaybeJson, previewJson, tokenizeJson } from './json';

describe('parseMaybeJson', () => {
  it('passes non-string values through unchanged', () => {
    expect(parseMaybeJson(42)).toBe(42);
    expect(parseMaybeJson(true)).toBe(true);
    expect(parseMaybeJson(null)).toBe(null);
    expect(parseMaybeJson(undefined)).toBe(undefined);
    const obj = { a: 1 };
    expect(parseMaybeJson(obj)).toBe(obj);
  });

  it('parses a string that is valid JSON', () => {
    expect(parseMaybeJson('{"a":1}')).toEqual({ a: 1 });
    expect(parseMaybeJson('[1,2,3]')).toEqual([1, 2, 3]);
    expect(parseMaybeJson('42')).toBe(42);
    expect(parseMaybeJson('null')).toBe(null);
  });

  it('returns a string that is not valid JSON unchanged', () => {
    expect(parseMaybeJson('hello world')).toBe('hello world');
    expect(parseMaybeJson('')).toBe('');
    expect(parseMaybeJson('{not json')).toBe('{not json');
  });

  it('unwraps a double-encoded JSON string one level deep', () => {
    const inner = { orderId: 'A-1043' };
    const level1 = JSON.stringify(inner); // '{"orderId":"A-1043"}'
    const level2 = JSON.stringify(level1); // a JSON string containing that string
    expect(parseMaybeJson(level2)).toEqual(inner);
  });

  it('does not unwrap a third level of encoding', () => {
    const inner = { a: 1 };
    const level1 = JSON.stringify(inner);
    const level2 = JSON.stringify(level1);
    const level3 = JSON.stringify(level2);
    // Two parses only: level3 -> level2 -> level1 (still a JSON-encoded string, not the object).
    expect(parseMaybeJson(level3)).toBe(level1);
  });
});

describe('formatJson', () => {
  it('pretty-prints a JSON string with two-space indentation', () => {
    expect(formatJson('{"a":1}')).toBe('{\n  "a": 1\n}');
  });

  it('fully expands a nested object/array value, never collapsing to [...]', () => {
    const result = formatJson({ a: [1, { b: null }] });
    expect(result).toBe(JSON.stringify({ a: [1, { b: null }] }, null, 2));
    expect(result).not.toContain('[...]');
    expect(result).toContain('[\n    1,\n    {\n      "b": null\n    }\n  ]');
  });

  it('returns an empty string for null and undefined', () => {
    expect(formatJson(null)).toBe('');
    expect(formatJson(undefined)).toBe('');
  });

  it('returns a non-JSON string unchanged', () => {
    expect(formatJson('hello world')).toBe('hello world');
    expect(formatJson('')).toBe('');
  });

  it('unwraps a double-encoded JSON string before pretty-printing', () => {
    const inner = { orderId: 'A-1043' };
    const level2 = JSON.stringify(JSON.stringify(inner));
    expect(formatJson(level2)).toBe(JSON.stringify(inner, null, 2));
  });

  it('pretty-prints a long string of digits parsed as a JSON number', () => {
    expect(formatJson('88214')).toBe('88214');
  });
});

describe('previewJson', () => {
  it('matches the accept example: compact single-line JSON.stringify', () => {
    expect(previewJson({ step: 'ChargePayment', attempt: 2 })).toBe('{"step":"ChargePayment","attempt":2}');
  });

  it('returns an empty string for null and undefined', () => {
    expect(previewJson(null)).toBe('');
    expect(previewJson(undefined)).toBe('');
  });

  it('collapses internal whitespace of a plain (non-JSON) string', () => {
    expect(previewJson('line one\nline two   with   spaces')).toBe('line one line two with spaces');
  });

  it('unwraps a JSON-string field before previewing', () => {
    expect(previewJson('{"a":1,"b":2}')).toBe('{"a":1,"b":2}');
  });

  it('does not truncate a value exactly at the max length', () => {
    const value = 'x'.repeat(120);
    const result = previewJson(value, 120);
    expect(result).toBe(value);
    expect(result.length).toBe(120);
    expect(result.endsWith('…')).toBe(false);
  });

  it('truncates with an ellipsis one character past the max length', () => {
    const value = 'x'.repeat(121);
    const result = previewJson(value, 120);
    expect(result).toBe(`${'x'.repeat(120)}…`);
    expect(result.length).toBe(121);
  });

  it('defaults max to 120', () => {
    const value = 'y'.repeat(200);
    expect(previewJson(value)).toBe(`${'y'.repeat(120)}…`);
  });
});

describe('tokenizeJson', () => {
  it('classifies every token of a sample with nested arrays and escaped quotes', () => {
    const sample = {
      name: 'He said "hi" to me',
      tags: ['a', 'b'],
      count: 3,
      ok: true,
      missing: null,
    };
    const text = formatJson(sample);
    const tokens = tokenizeJson(text);

    // Lossless round trip: concatenating every token's text reproduces the original text.
    expect(tokens.map((t) => t.text).join('')).toBe(text);

    const classes = new Set(tokens.map((t) => t.cls));
    expect(classes.has('jk')).toBe(true);
    expect(classes.has('js')).toBe(true);
    expect(classes.has('jn')).toBe(true);
    expect(classes.has('jb')).toBe(true);
    expect(classes.has('jz')).toBe(true);
    expect(classes.has('jp')).toBe(true);
    expect(classes.has('')).toBe(true); // whitespace/indentation

    // Keys are quoted strings immediately followed (modulo whitespace) by a colon.
    const nameKeyToken = tokens.find((t) => t.text === '"name"');
    expect(nameKeyToken?.cls).toBe('jk');

    // The escaped-quote string value (contains literal " characters) is tokenized as one 'js'
    // span, escapes and surrounding quotes included, not split at the escaped inner quotes.
    const expectedNameValue = JSON.stringify(sample.name);
    const nameValueToken = tokens.find((t) => t.cls === 'js' && t.text === expectedNameValue);
    expect(nameValueToken).toBeDefined();
    expect(expectedNameValue).toBe('"He said \\"hi\\" to me"');

    // Punctuation: braces, brackets, colon, comma.
    for (const p of ['{', '}', '[', ']', ':', ',']) {
      expect(tokens.some((t) => t.cls === 'jp' && t.text === p)).toBe(true);
    }

    const numberToken = tokens.find((t) => t.text === '3');
    expect(numberToken?.cls).toBe('jn');

    const boolToken = tokens.find((t) => t.text === 'true');
    expect(boolToken?.cls).toBe('jb');

    const nullToken = tokens.find((t) => t.text === 'null');
    expect(nullToken?.cls).toBe('jz');
  });

  it('classifies a compact object with no whitespace between tokens', () => {
    const tokens = tokenizeJson('{"a":1,"b":[true,false,null]}');
    const nonEmpty = tokens.filter((t) => t.text !== '');
    expect(nonEmpty.map((t) => t.text).join('')).toBe('{"a":1,"b":[true,false,null]}');
    expect(tokens.find((t) => t.text === '"a"')?.cls).toBe('jk');
    expect(tokens.find((t) => t.text === '1')?.cls).toBe('jn');
    expect(tokens.find((t) => t.text === '"b"')?.cls).toBe('jk');
    expect(tokens.find((t) => t.text === 'true')?.cls).toBe('jb');
    expect(tokens.find((t) => t.text === 'false')?.cls).toBe('jb');
    expect(tokens.find((t) => t.text === 'null')?.cls).toBe('jz');
  });

  it('classifies negative and fractional numbers', () => {
    const tokens = tokenizeJson('[-1, 2.5, 3e10, -4.2e-3]');
    const numbers = tokens.filter((t) => t.cls === 'jn').map((t) => t.text);
    expect(numbers).toEqual(['-1', '2.5', '3e10', '-4.2e-3']);
  });
});

describe('isBlobUrl', () => {
  it('recognises an https blob URL with a container/blob path', () => {
    expect(isBlobUrl('https://myaccount.blob.core.windows.net/myhub-largemessages/abc.gz')).toBe(true);
  });

  it('recognises an http (emulator) blob URL', () => {
    expect(isBlobUrl('http://127.0.0.1:10000/devstoreaccount1/myhub-largemessages/abc.gz')).toBe(true);
  });

  it('rejects a plain string', () => {
    expect(isBlobUrl('hello world')).toBe(false);
  });

  it('rejects a JSON string', () => {
    expect(isBlobUrl('{"a":1}')).toBe(false);
  });

  it('rejects an absolute URL with no blob path (fewer than two path segments)', () => {
    expect(isBlobUrl('https://example.com')).toBe(false);
    expect(isBlobUrl('https://example.com/')).toBe(false);
    expect(isBlobUrl('https://example.com/onlyone')).toBe(false);
  });

  it('rejects a non-http(s) absolute URL', () => {
    expect(isBlobUrl('ftp://example.com/a/b')).toBe(false);
  });

  it('rejects non-string values', () => {
    expect(isBlobUrl(42)).toBe(false);
    expect(isBlobUrl(null)).toBe(false);
    expect(isBlobUrl(undefined)).toBe(false);
    expect(isBlobUrl({ url: 'https://example.com/a/b' })).toBe(false);
  });
});
