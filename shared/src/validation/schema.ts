// Lightweight schema validator — Goja-safe (no regex /v flag, no import.meta).
// API: obj(), str(), int(), num(), bool(), literal(), optional(), parse().

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: string[] };

export interface Schema<T> {
  _parse(value: unknown, path: string): ParseResult<T>;
}

function fail(path: string, msg: string): ParseResult<never> {
  return { ok: false, errors: [`${path}: ${msg}`] };
}

function ok<T>(value: T): ParseResult<T> {
  return { ok: true, value };
}

// --- Primitives ---

export interface StrSchema extends Schema<string> {
  min(n: number): StrSchema;
  max(n: number): StrSchema;
  pattern(re: RegExp): StrSchema;
}

export function str(): StrSchema {
  let minLen: number | undefined;
  let maxLen: number | undefined;
  let re: RegExp | undefined;

  const s: StrSchema = {
    _parse(value: unknown, path: string): ParseResult<string> {
      if (typeof value !== 'string') return fail(path, 'expected string');
      if (minLen !== undefined && value.length < minLen)
        return fail(path, `min length ${minLen}`);
      if (maxLen !== undefined && value.length > maxLen)
        return fail(path, `max length ${maxLen}`);
      if (re !== undefined && !re.test(value))
        return fail(path, 'pattern mismatch');
      return ok(value);
    },
    min(n: number) { minLen = n; return s; },
    max(n: number) { maxLen = n; return s; },
    pattern(r: RegExp) { re = r; return s; },
  };
  return s;
}

export interface IntSchema extends Schema<number> {
  min(n: number): IntSchema;
  max(n: number): IntSchema;
}

export function int(): IntSchema {
  let minVal: number | undefined;
  let maxVal: number | undefined;

  const s: IntSchema = {
    _parse(value: unknown, path: string): ParseResult<number> {
      if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value))
        return fail(path, 'expected integer');
      if (minVal !== undefined && value < minVal)
        return fail(path, `min ${minVal}`);
      if (maxVal !== undefined && value > maxVal)
        return fail(path, `max ${maxVal}`);
      return ok(value);
    },
    min(n: number) { minVal = n; return s; },
    max(n: number) { maxVal = n; return s; },
  };
  return s;
}

export interface NumSchema extends Schema<number> {
  min(n: number): NumSchema;
  max(n: number): NumSchema;
}

export function num(): NumSchema {
  let minVal: number | undefined;
  let maxVal: number | undefined;

  const s: NumSchema = {
    _parse(value: unknown, path: string): ParseResult<number> {
      if (typeof value !== 'number' || !Number.isFinite(value))
        return fail(path, 'expected number');
      if (minVal !== undefined && value < minVal)
        return fail(path, `min ${minVal}`);
      if (maxVal !== undefined && value > maxVal)
        return fail(path, `max ${maxVal}`);
      return ok(value);
    },
    min(n: number) { minVal = n; return s; },
    max(n: number) { maxVal = n; return s; },
  };
  return s;
}

export function bool(): Schema<boolean> {
  return {
    _parse(value: unknown, path: string): ParseResult<boolean> {
      if (typeof value !== 'boolean') return fail(path, 'expected boolean');
      return ok(value);
    },
  };
}

export function literal<T extends string | number | boolean>(expected: T): Schema<T> {
  return {
    _parse(value: unknown, path: string): ParseResult<T> {
      if (value !== expected) return fail(path, `expected ${JSON.stringify(expected)}`);
      return ok(value as T);
    },
  };
}

export function oneOf<T extends string | number>(...values: T[]): Schema<T> {
  return {
    _parse(value: unknown, path: string): ParseResult<T> {
      if (values.indexOf(value as T) === -1)
        return fail(path, `expected one of ${values.join(', ')}`);
      return ok(value as T);
    },
  };
}

// --- Object ---

type ObjShape = Record<string, Schema<unknown>>;
type InferObj<S extends ObjShape> = { [K in keyof S]: S[K] extends Schema<infer T> ? T : never };

export function obj<S extends ObjShape>(shape: S): Schema<InferObj<S>> {
  return {
    _parse(value: unknown, path: string): ParseResult<InferObj<S>> {
      if (!value || typeof value !== 'object' || Array.isArray(value))
        return fail(path, 'expected object');
      const result: Record<string, unknown> = {};
      const errors: string[] = [];
      for (const key of Object.keys(shape)) {
        const fieldSchema = shape[key]!;
        const fieldValue = (value as Record<string, unknown>)[key];
        const fieldResult = fieldSchema._parse(fieldValue, path ? `${path}.${key}` : key);
        if (fieldResult.ok) {
          result[key] = fieldResult.value;
        } else {
          errors.push(...fieldResult.errors);
        }
      }
      if (errors.length > 0) return { ok: false, errors };
      return ok(result as InferObj<S>);
    },
  };
}

// --- Optional wrapper ---

export function optional<T>(schema: Schema<T>): Schema<T | undefined> {
  return {
    _parse(value: unknown, path: string): ParseResult<T | undefined> {
      if (value === undefined || value === null) return ok(undefined);
      return schema._parse(value, path);
    },
  };
}

// --- Top-level parse ---

export function parse<T>(schema: Schema<T>, value: unknown): ParseResult<T> {
  return schema._parse(value, '');
}
