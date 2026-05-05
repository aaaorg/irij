import { describe, expect, it } from 'vitest';
import { bool, int, literal, num, obj, oneOf, optional, parse, str } from './schema.js';

describe('str()', () => {
  it('accepts string', () => {
    expect(parse(str(), 'hello')).toEqual({ ok: true, value: 'hello' });
  });
  it('rejects number', () => {
    const r = parse(str(), 42);
    expect(r.ok).toBe(false);
  });
  it('enforces min length', () => {
    const r = parse(str().min(3), 'ab');
    expect(r.ok).toBe(false);
  });
  it('enforces max length', () => {
    const r = parse(str().max(2), 'abc');
    expect(r.ok).toBe(false);
  });
  it('enforces pattern', () => {
    const r = parse(str().pattern(/^[a-z]+$/), 'ABC');
    expect(r.ok).toBe(false);
    expect(parse(str().pattern(/^[a-z]+$/), 'abc')).toEqual({ ok: true, value: 'abc' });
  });
});

describe('int()', () => {
  it('accepts integer', () => {
    expect(parse(int(), 5)).toEqual({ ok: true, value: 5 });
  });
  it('rejects float', () => {
    expect(parse(int(), 3.14).ok).toBe(false);
  });
  it('rejects NaN', () => {
    expect(parse(int(), NaN).ok).toBe(false);
  });
  it('rejects Infinity', () => {
    expect(parse(int(), Infinity).ok).toBe(false);
  });
  it('rejects string', () => {
    expect(parse(int(), '5').ok).toBe(false);
  });
  it('enforces min', () => {
    expect(parse(int().min(0), -1).ok).toBe(false);
    expect(parse(int().min(0), 0)).toEqual({ ok: true, value: 0 });
  });
  it('enforces max', () => {
    expect(parse(int().max(10), 11).ok).toBe(false);
    expect(parse(int().max(10), 10)).toEqual({ ok: true, value: 10 });
  });
});

describe('num()', () => {
  it('accepts float', () => {
    expect(parse(num(), 3.14)).toEqual({ ok: true, value: 3.14 });
  });
  it('accepts integer', () => {
    expect(parse(num(), 5)).toEqual({ ok: true, value: 5 });
  });
  it('rejects NaN', () => {
    expect(parse(num(), NaN).ok).toBe(false);
  });
  it('rejects Infinity', () => {
    expect(parse(num(), Infinity).ok).toBe(false);
  });
});

describe('bool()', () => {
  it('accepts true', () => {
    expect(parse(bool(), true)).toEqual({ ok: true, value: true });
  });
  it('rejects 0', () => {
    expect(parse(bool(), 0).ok).toBe(false);
  });
});

describe('literal()', () => {
  it('accepts matching value', () => {
    expect(parse(literal('M'), 'M')).toEqual({ ok: true, value: 'M' });
  });
  it('rejects non-matching', () => {
    expect(parse(literal('M'), 'F').ok).toBe(false);
  });
});

describe('oneOf()', () => {
  it('accepts one of the values', () => {
    expect(parse(oneOf('M', 'F'), 'F')).toEqual({ ok: true, value: 'F' });
  });
  it('rejects other values', () => {
    expect(parse(oneOf('M', 'F'), 'X').ok).toBe(false);
  });
});

describe('optional()', () => {
  it('accepts undefined', () => {
    expect(parse(optional(int()), undefined)).toEqual({ ok: true, value: undefined });
  });
  it('accepts null as undefined', () => {
    expect(parse(optional(int()), null)).toEqual({ ok: true, value: undefined });
  });
  it('validates present values', () => {
    expect(parse(optional(int()), 5)).toEqual({ ok: true, value: 5 });
    expect(parse(optional(int()), 'x').ok).toBe(false);
  });
});

describe('obj()', () => {
  it('parses valid object', () => {
    const schema = obj({ name: str(), age: int() });
    const result = parse(schema, { name: 'Alice', age: 30 });
    expect(result).toEqual({ ok: true, value: { name: 'Alice', age: 30 } });
  });

  it('rejects non-object', () => {
    const schema = obj({ name: str() });
    expect(parse(schema, 'hello').ok).toBe(false);
    expect(parse(schema, null).ok).toBe(false);
    expect(parse(schema, []).ok).toBe(false);
  });

  it('reports multiple errors', () => {
    const schema = obj({ x: int(), y: int() });
    const result = parse(schema, { x: 'a', y: 'b' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBe(2);
    }
  });

  it('supports nested objects', () => {
    const schema = obj({
      target: obj({ x: num(), y: num() }),
      seq: int(),
    });
    const result = parse(schema, { target: { x: 1.5, y: 2.5 }, seq: 1 });
    expect(result).toEqual({ ok: true, value: { target: { x: 1.5, y: 2.5 }, seq: 1 } });
  });

  it('rejects when nested field invalid', () => {
    const schema = obj({
      target: obj({ x: num(), y: num() }),
    });
    const result = parse(schema, { target: { x: 'bad', y: 2 } });
    expect(result.ok).toBe(false);
  });

  it('ignores extra fields', () => {
    const schema = obj({ a: int() });
    const result = parse(schema, { a: 1, b: 2 });
    expect(result).toEqual({ ok: true, value: { a: 1 } });
  });
});
