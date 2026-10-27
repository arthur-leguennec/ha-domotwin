/**
 * Home Assistant's templates, as far as the sandbox reads them (D-057): one `{{ … }}` expression
 * (or several in a text) over the copy's states, the time and the run's variables. Home
 * Assistant's templates are Jinja with hundreds of functions of its own; what the sandbox cannot
 * read is refused with its reason, never guessed.
 */
import type { HassEntity } from "../ha/types";
import { moment, parseClock, parseDuration, parseMoment, zoned } from "./time";

/** Something the sandbox cannot play, and why (a key of `sandbox.why`, and its detail). */
export class Unplayable extends Error {
  constructor(
    readonly reason: string,
    readonly detail = "",
  ) {
    super(detail ? `${reason}: ${detail}` : reason);
  }
}

/** What a template reads. */
export interface TemplateScope {
  state(id: string): HassEntity | undefined;
  /** Every entity id, for `states.domain`. */
  ids(): string[];
  /** The area of an entity, for `area_entities` and `area_name`. */
  areaOf(id: string): string | undefined;
  areaName(area: string): string | undefined;
  /** The sandbox's time (ms) and Home Assistant's time zone. */
  now: number;
  zone: string;
  variables: Record<string, unknown>;
}

/** A moment, as Jinja's `now()` gives one. */
export class DateTime {
  constructor(
    readonly ms: number,
    readonly zone: string,
  ) {}
}

/** A length of time, as `timedelta(…)` gives one. */
export class TimeDelta {
  constructor(readonly ms: number) {}
}

const UNDEFINED = Symbol("undefined");
type Value = unknown;

// ---------------------------------------------------------------------------------- tokens

type Token =
  | { kind: "number"; value: number }
  | { kind: "string"; value: string }
  | { kind: "name"; value: string }
  | { kind: "op"; value: string }
  | { kind: "end" };

const OPS = [
  "//",
  "==",
  "!=",
  "<=",
  ">=",
  "**",
  "(",
  ")",
  "[",
  "]",
  "{",
  "}",
  ".",
  ",",
  "|",
  ":",
  "<",
  ">",
  "+",
  "-",
  "*",
  "/",
  "%",
  "~",
  "=",
];

function tokens(source: string): Token[] {
  const found: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const c = source[i] ?? "";
    if (/\s/.test(c)) {
      i += 1;
      continue;
    }
    if (/[0-9]/.test(c)) {
      const match = /^\d+(\.\d+)?/.exec(source.slice(i));
      const text = match?.[0] ?? c;
      found.push({ kind: "number", value: Number(text) });
      i += text.length;
      continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1;
      let text = "";
      while (j < source.length && source[j] !== c) {
        if (source[j] === "\\" && j + 1 < source.length) {
          const next = source.charAt(j + 1);
          text += next === "n" ? "\n" : next === "t" ? "\t" : next;
          j += 2;
        } else {
          text += source.charAt(j);
          j += 1;
        }
      }
      if (j >= source.length) throw new Unplayable("template", "unclosed string");
      found.push({ kind: "string", value: text });
      i = j + 1;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(i));
      const text = match?.[0] ?? c;
      found.push({ kind: "name", value: text });
      i += text.length;
      continue;
    }
    const op = OPS.find((o) => source.startsWith(o, i));
    if (!op) throw new Unplayable("template", `“${c}”`);
    found.push({ kind: "op", value: op });
    i += op.length;
  }
  found.push({ kind: "end" });
  return found;
}

// ----------------------------------------------------------------------------------- tree

type Node =
  | { t: "literal"; value: Value }
  | { t: "name"; name: string }
  | { t: "list"; items: Node[] }
  | { t: "dict"; entries: [Node, Node][] }
  | { t: "attr"; of: Node; name: string }
  | { t: "index"; of: Node; index: Node }
  | { t: "call"; of: Node; args: Node[]; kwargs: [string, Node][] }
  | { t: "filter"; of: Node; name: string; args: Node[]; kwargs: [string, Node][] }
  | { t: "test"; of: Node; name: string; negate: boolean; args: Node[] }
  | { t: "unary"; op: string; of: Node }
  | { t: "binary"; op: string; left: Node; right: Node }
  | { t: "if"; then: Node; test: Node; otherwise?: Node };

class Parser {
  private at = 0;
  constructor(private readonly list: Token[]) {}

  private peek(): Token {
    return this.list[this.at] ?? { kind: "end" };
  }

  private next(): Token {
    const token = this.peek();
    this.at += 1;
    return token;
  }

  private isOp(value: string): boolean {
    const token = this.peek();
    return token.kind === "op" && token.value === value;
  }

  private isName(value: string): boolean {
    const token = this.peek();
    return token.kind === "name" && token.value === value;
  }

  private expect(value: string): void {
    if (!this.isOp(value)) throw new Unplayable("template", `“${value}” expected`);
    this.at += 1;
  }

  parse(): Node {
    const node = this.expression();
    if (this.peek().kind !== "end") throw new Unplayable("template", "unexpected text");
    return node;
  }

  private expression(): Node {
    const then = this.or();
    if (this.isName("if")) {
      this.at += 1;
      const test = this.or();
      if (this.isName("else")) {
        this.at += 1;
        return { t: "if", then, test, otherwise: this.expression() };
      }
      return { t: "if", then, test };
    }
    return then;
  }

  private or(): Node {
    let left = this.and();
    while (this.isName("or")) {
      this.at += 1;
      left = { t: "binary", op: "or", left, right: this.and() };
    }
    return left;
  }

  private and(): Node {
    let left = this.not();
    while (this.isName("and")) {
      this.at += 1;
      left = { t: "binary", op: "and", left, right: this.not() };
    }
    return left;
  }

  private not(): Node {
    if (this.isName("not")) {
      this.at += 1;
      return { t: "unary", op: "not", of: this.not() };
    }
    return this.compare();
  }

  private compare(): Node {
    let left = this.concat();
    for (;;) {
      const token = this.peek();
      if (token.kind === "op" && ["==", "!=", "<", "<=", ">", ">="].includes(token.value)) {
        this.at += 1;
        left = { t: "binary", op: token.value, left, right: this.concat() };
      } else if (this.isName("in")) {
        this.at += 1;
        left = { t: "binary", op: "in", left, right: this.concat() };
      } else if (this.isName("not") && this.list[this.at + 1]?.kind === "name") {
        const after = this.list[this.at + 1] as { value: string };
        if (after.value !== "in") break;
        this.at += 2;
        left = { t: "unary", op: "not", of: { t: "binary", op: "in", left, right: this.concat() } };
      } else if (this.isName("is")) {
        this.at += 1;
        let negate = false;
        if (this.isName("not")) {
          this.at += 1;
          negate = true;
        }
        const name = this.next();
        if (name.kind !== "name") throw new Unplayable("template", "a test expected");
        const args: Node[] = [];
        if (this.isOp("(")) {
          this.at += 1;
          while (!this.isOp(")")) {
            args.push(this.expression());
            if (!this.isOp(")")) this.expect(",");
          }
          this.at += 1;
        } else if (
          this.peek().kind === "number" ||
          this.peek().kind === "string" ||
          (this.peek().kind === "name" && !["and", "or", "if", "else"].includes(this.peekName()))
        ) {
          args.push(this.concat());
        }
        left = { t: "test", of: left, name: name.value, negate, args };
      } else break;
    }
    return left;
  }

  private peekName(): string {
    const token = this.peek();
    return token.kind === "name" ? token.value : "";
  }

  private concat(): Node {
    let left = this.add();
    while (this.isOp("~")) {
      this.at += 1;
      left = { t: "binary", op: "~", left, right: this.add() };
    }
    return left;
  }

  private add(): Node {
    let left = this.mul();
    for (;;) {
      if (this.isOp("+") || this.isOp("-")) {
        const op = (this.next() as { value: string }).value;
        left = { t: "binary", op, left, right: this.mul() };
      } else break;
    }
    return left;
  }

  private mul(): Node {
    let left = this.unary();
    for (;;) {
      if (this.isOp("*") || this.isOp("/") || this.isOp("//") || this.isOp("%")) {
        const op = (this.next() as { value: string }).value;
        left = { t: "binary", op, left, right: this.unary() };
      } else break;
    }
    return left;
  }

  private unary(): Node {
    if (this.isOp("-") || this.isOp("+")) {
      const op = (this.next() as { value: string }).value;
      return { t: "unary", op, of: this.unary() };
    }
    return this.postfix();
  }

  private args(): { args: Node[]; kwargs: [string, Node][] } {
    const args: Node[] = [];
    const kwargs: [string, Node][] = [];
    this.expect("(");
    while (!this.isOp(")")) {
      const token = this.peek();
      const after = this.list[this.at + 1];
      if (token.kind === "name" && after?.kind === "op" && after.value === "=") {
        this.at += 2;
        kwargs.push([token.value, this.expression()]);
      } else args.push(this.expression());
      if (!this.isOp(")")) this.expect(",");
    }
    this.at += 1;
    return { args, kwargs };
  }

  private postfix(): Node {
    let node = this.primary();
    for (;;) {
      if (this.isOp(".")) {
        this.at += 1;
        const name = this.next();
        if (name.kind !== "name" && name.kind !== "number") {
          throw new Unplayable("template", "a name expected");
        }
        node = { t: "attr", of: node, name: String(name.value) };
      } else if (this.isOp("[")) {
        this.at += 1;
        const index = this.expression();
        this.expect("]");
        node = { t: "index", of: node, index };
      } else if (this.isOp("(")) {
        node = { t: "call", of: node, ...this.args() };
      } else if (this.isOp("|")) {
        this.at += 1;
        const name = this.next();
        if (name.kind !== "name") throw new Unplayable("template", "a filter expected");
        const call = this.isOp("(") ? this.args() : { args: [], kwargs: [] };
        node = { t: "filter", of: node, name: name.value, ...call };
      } else break;
    }
    return node;
  }

  private primary(): Node {
    const token = this.next();
    switch (token.kind) {
      case "number":
        return { t: "literal", value: token.value };
      case "string":
        return { t: "literal", value: token.value };
      case "name":
        switch (token.value) {
          case "true":
          case "True":
            return { t: "literal", value: true };
          case "false":
          case "False":
            return { t: "literal", value: false };
          case "none":
          case "None":
            return { t: "literal", value: null };
          default:
            return { t: "name", name: token.value };
        }
      case "op":
        if (token.value === "(") {
          const inner = this.expression();
          if (this.isOp(",")) {
            const items = [inner];
            while (this.isOp(",")) {
              this.at += 1;
              if (this.isOp(")")) break;
              items.push(this.expression());
            }
            this.expect(")");
            return { t: "list", items };
          }
          this.expect(")");
          return inner;
        }
        if (token.value === "[") {
          const items: Node[] = [];
          while (!this.isOp("]")) {
            items.push(this.expression());
            if (!this.isOp("]")) this.expect(",");
          }
          this.at += 1;
          return { t: "list", items };
        }
        if (token.value === "{") {
          const entries: [Node, Node][] = [];
          while (!this.isOp("}")) {
            const key = this.expression();
            this.expect(":");
            entries.push([key, this.expression()]);
            if (!this.isOp("}")) this.expect(",");
          }
          this.at += 1;
          return { t: "dict", entries };
        }
        throw new Unplayable("template", `“${token.value}”`);
      default:
        throw new Unplayable("template", "unexpected end");
    }
  }
}

const parsed = new Map<string, Node>();

function parseExpression(source: string): Node {
  let node = parsed.get(source);
  if (!node) {
    node = new Parser(tokens(source)).parse();
    if (parsed.size > 2000) parsed.clear();
    parsed.set(source, node);
  }
  return node;
}

// -------------------------------------------------------------------------------- values

/** A state as `states.domain.object` gives it. */
class StateObject {
  constructor(
    readonly entity: HassEntity,
    readonly zone: string,
  ) {}
}

/** `states.domain`, or `states` itself. */
class StatesProxy {
  constructor(readonly domain?: string) {}
}

const isNumber = (value: Value): value is number => typeof value === "number";

/** As Python writes a value in a rendered template. */
export function pythonText(value: Value): string {
  if (value === null || value === undefined || value === UNDEFINED)
    return value === null ? "None" : "";
  if (value === true) return "True";
  if (value === false) return "False";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : String(value);
  if (typeof value === "string") return value;
  if (value instanceof DateTime) {
    const read = zoned(value.ms, value.zone);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${read.year}-${pad(read.month)}-${pad(read.day)} ${pad(read.hour)}:${pad(read.minute)}:${pad(read.second)}`;
  }
  if (value instanceof TimeDelta) return `${value.ms / 1000} seconds`;
  if (value instanceof StateObject)
    return `<state ${value.entity.entity_id}=${value.entity.state}>`;
  if (Array.isArray(value)) return `[${value.map(repr).join(", ")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${repr(k)}: ${repr(v)}`)
      .join(", ")}}`;
  }
  // A function, a symbol or a big number: never in a configuration.
  return "";
}

function repr(value: Value): string {
  return typeof value === "string" ? `'${value}'` : pythonText(value);
}

function truth(value: Value): boolean {
  if (value === UNDEFINED || value === null || value === undefined) return false;
  if (typeof value === "string") return value.length > 0;
  if (typeof value === "number") return value !== 0;
  if (Array.isArray(value)) return value.length > 0;
  if (value instanceof TimeDelta) return value.ms !== 0;
  if (typeof value === "boolean") return value;
  if (typeof value === "object") return Object.keys(value).length > 0 || !isPlain(value);
  return Boolean(value);
}

function isPlain(value: unknown): boolean {
  return Object.getPrototypeOf(value) === Object.prototype;
}

/** A number from a value as `float` reads it, or `undefined`. */
function toNumber(value: Value): number | undefined {
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return undefined;
}

function equal(a: Value, b: Value): boolean {
  if (a instanceof DateTime && b instanceof DateTime) return a.ms === b.ms;
  if (a instanceof TimeDelta && b instanceof TimeDelta) return a.ms === b.ms;
  if (typeof a === "number" && typeof b === "boolean") return a === (b ? 1 : 0);
  if (typeof b === "number" && typeof a === "boolean") return b === (a ? 1 : 0);
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, k) => equal(item, b[k]));
  }
  if (a === UNDEFINED) return b === UNDEFINED;
  return a === b;
}

function order(a: Value, b: Value): number {
  if (a instanceof DateTime && b instanceof DateTime) return a.ms - b.ms;
  if (a instanceof TimeDelta && b instanceof TimeDelta) return a.ms - b.ms;
  if ((isNumber(a) || typeof a === "boolean") && (isNumber(b) || typeof b === "boolean")) {
    return Number(a) - Number(b);
  }
  if (typeof a === "string" && typeof b === "string") return a < b ? -1 : a > b ? 1 : 0;
  // Python refuses to order a number and a text: so does the sandbox.
  throw new Unplayable("template", `${repr(a)} and ${repr(b)} cannot be compared`);
}

// ------------------------------------------------------------------------------ evaluation

/** Reads `node` in `scope`. */
function evaluate(node: Node, scope: TemplateScope): Value {
  switch (node.t) {
    case "literal":
      return node.value;
    case "list":
      return node.items.map((item) => evaluate(item, scope));
    case "dict": {
      const out: Record<string, unknown> = {};
      for (const [key, value] of node.entries) {
        out[pythonText(evaluate(key, scope))] = evaluate(value, scope);
      }
      return out;
    }
    case "name":
      return lookup(node.name, scope);
    case "attr":
      return attribute(evaluate(node.of, scope), node.name, scope);
    case "index": {
      const of = evaluate(node.of, scope);
      const index = evaluate(node.index, scope);
      if (Array.isArray(of) && isNumber(index)) {
        return of[index < 0 ? of.length + index : index] ?? UNDEFINED;
      }
      if (typeof of === "string" && isNumber(index)) return of.at(index) ?? UNDEFINED;
      return attribute(of, pythonText(index), scope);
    }
    case "call":
      return call(node, scope);
    case "filter":
      return filter(
        node.name,
        evaluate(node.of, scope),
        node.args.map((a) => evaluate(a, scope)),
        Object.fromEntries(node.kwargs.map(([k, v]) => [k, evaluate(v, scope)])),
        scope,
      );
    case "test": {
      const result = test(
        node.name,
        evaluate(node.of, scope),
        node.args.map((a) => evaluate(a, scope)),
      );
      return node.negate ? !result : result;
    }
    case "unary": {
      const of = evaluate(node.of, scope);
      if (node.op === "not") return !truth(of);
      const n = toNumber(of);
      if (n === undefined) throw new Unplayable("template", `${node.op}${repr(of)}`);
      return node.op === "-" ? -n : n;
    }
    case "if":
      return truth(evaluate(node.test, scope))
        ? evaluate(node.then, scope)
        : node.otherwise
          ? evaluate(node.otherwise, scope)
          : UNDEFINED;
    case "binary":
      return binary(node, scope);
  }
}

function binary(node: Extract<Node, { t: "binary" }>, scope: TemplateScope): Value {
  if (node.op === "and") {
    const left = evaluate(node.left, scope);
    return truth(left) ? evaluate(node.right, scope) : left;
  }
  if (node.op === "or") {
    const left = evaluate(node.left, scope);
    return truth(left) ? left : evaluate(node.right, scope);
  }
  const a = evaluate(node.left, scope);
  const b = evaluate(node.right, scope);
  switch (node.op) {
    case "==":
      return equal(a, b);
    case "!=":
      return !equal(a, b);
    case "<":
      return order(a, b) < 0;
    case "<=":
      return order(a, b) <= 0;
    case ">":
      return order(a, b) > 0;
    case ">=":
      return order(a, b) >= 0;
    case "in":
      if (typeof b === "string") return b.includes(pythonText(a));
      if (Array.isArray(b)) return b.some((item) => equal(item, a));
      if (b && typeof b === "object" && isPlain(b)) return pythonText(a) in b;
      throw new Unplayable("template", `in ${repr(b)}`);
    case "~":
      return pythonText(a) + pythonText(b);
    case "+":
      if (a instanceof DateTime && b instanceof TimeDelta) return new DateTime(a.ms + b.ms, a.zone);
      if (a instanceof TimeDelta && b instanceof TimeDelta) return new TimeDelta(a.ms + b.ms);
      if (typeof a === "string" && typeof b === "string") return a + b;
      if (Array.isArray(a) && Array.isArray(b)) return [...(a as unknown[]), ...(b as unknown[])];
      return arithmetic(a, b, (x, y) => x + y, "+");
    case "-":
      if (a instanceof DateTime && b instanceof TimeDelta) return new DateTime(a.ms - b.ms, a.zone);
      if (a instanceof DateTime && b instanceof DateTime) return new TimeDelta(a.ms - b.ms);
      if (a instanceof TimeDelta && b instanceof TimeDelta) return new TimeDelta(a.ms - b.ms);
      return arithmetic(a, b, (x, y) => x - y, "-");
    case "*":
      if (a instanceof TimeDelta && isNumber(b)) return new TimeDelta(a.ms * b);
      return arithmetic(a, b, (x, y) => x * y, "*");
    case "/":
      return arithmetic(a, b, (x, y) => divide(x, y), "/");
    case "//":
      return arithmetic(a, b, (x, y) => Math.floor(divide(x, y)), "//");
    case "%":
      return arithmetic(a, b, (x, y) => ((x % y) + y) % y, "%");
    default:
      throw new Unplayable("template", node.op);
  }
}

function divide(x: number, y: number): number {
  if (y === 0) throw new Unplayable("template", "division by zero");
  return x / y;
}

function arithmetic(a: Value, b: Value, f: (x: number, y: number) => number, op: string): number {
  if ((isNumber(a) || typeof a === "boolean") && (isNumber(b) || typeof b === "boolean")) {
    return f(Number(a), Number(b));
  }
  // Python does not add a text and a number: neither does the sandbox.
  throw new Unplayable("template", `${repr(a)} ${op} ${repr(b)}`);
}

function lookup(name: string, scope: TemplateScope): Value {
  if (Object.hasOwn(scope.variables, name)) return scope.variables[name];
  switch (name) {
    case "states":
      return new StatesProxy();
    case "now":
    case "utcnow":
    case "today_at":
    case "is_state":
    case "is_state_attr":
    case "state_attr":
    case "has_value":
    case "float":
    case "int":
    case "bool":
    case "iif":
    case "min":
    case "max":
    case "abs":
    case "round":
    case "as_timestamp":
    case "timedelta":
    case "area_entities":
    case "area_name":
    case "area_id":
    case "is_number":
    case "range":
    case "as_datetime":
    case "states_fn":
      return { builtin: name };
    default:
      return UNDEFINED;
  }
}

function attribute(of: Value, name: string, scope: TemplateScope): Value {
  if (of instanceof StatesProxy) {
    if (!of.domain) return new StatesProxy(name);
    const entity = scope.state(`${of.domain}.${name}`);
    return entity ? new StateObject(entity, scope.zone) : UNDEFINED;
  }
  if (of instanceof StateObject) {
    const entity = of.entity;
    switch (name) {
      case "state":
        return entity.state;
      case "entity_id":
        return entity.entity_id;
      case "attributes":
        return entity.attributes;
      case "domain":
        return entity.entity_id.split(".")[0];
      case "object_id":
        return entity.entity_id.split(".")[1];
      case "name":
        return entity.attributes.friendly_name ?? entity.entity_id;
      case "last_changed":
      case "last_updated": {
        const at = Date.parse(entity[name]);
        return Number.isFinite(at) ? new DateTime(at, of.zone) : UNDEFINED;
      }
      default:
        return UNDEFINED;
    }
  }
  if (of instanceof DateTime) {
    const read = zoned(of.ms, of.zone);
    switch (name) {
      case "hour":
      case "minute":
      case "second":
      case "year":
      case "month":
      case "day":
        return read[name];
      case "weekday":
      case "isoweekday":
      case "timestamp":
      case "date":
      case "strftime":
      case "isoformat":
      case "replace":
        return { method: name, of };
      default:
        return UNDEFINED;
    }
  }
  if (of instanceof TimeDelta) {
    if (name === "total_seconds") return { method: name, of };
    if (name === "seconds") return Math.floor((of.ms / 1000) % 86_400);
    if (name === "days") return Math.floor(of.ms / 86_400_000);
    return UNDEFINED;
  }
  if (of && typeof of === "object" && !Array.isArray(of)) {
    const record = of as Record<string, unknown>;
    if (Object.hasOwn(record, name)) return record[name];
    // Home Assistant's `trigger.to_state` is a state object.
    return UNDEFINED;
  }
  return UNDEFINED;
}

/** A state as an object (`trigger.to_state`), read the same way as `states.x.y`. */
export function stateValue(entity: HassEntity | undefined, zone: string): Value {
  return entity ? new StateObject(entity, zone) : null;
}

function callArgs(
  node: Extract<Node, { t: "call" }>,
  scope: TemplateScope,
): { args: Value[]; kwargs: Record<string, Value> } {
  return {
    args: node.args.map((a) => evaluate(a, scope)),
    kwargs: Object.fromEntries(node.kwargs.map(([k, v]) => [k, evaluate(v, scope)])),
  };
}

function call(node: Extract<Node, { t: "call" }>, scope: TemplateScope): Value {
  const of = evaluate(node.of, scope);
  const { args, kwargs } = callArgs(node, scope);
  if (of instanceof StatesProxy && !of.domain) return builtin("states", args, kwargs, scope);
  if (of && typeof of === "object" && "builtin" in of) {
    return builtin((of as { builtin: string }).builtin, args, kwargs, scope);
  }
  if (of && typeof of === "object" && "method" in of) {
    const { method, of: on } = of as { method: string; of: Value };
    if (on instanceof TimeDelta && method === "total_seconds") return on.ms / 1000;
    if (on instanceof DateTime) {
      const read = zoned(on.ms, on.zone);
      switch (method) {
        case "weekday":
          return read.weekday;
        case "isoweekday":
          return read.weekday + 1;
        case "timestamp":
          return on.ms / 1000;
        case "date":
          return new DateTime(moment(on.zone, read.year, read.month, read.day), on.zone);
        case "isoformat":
          return pythonText(on).replace(" ", "T");
        case "strftime":
          return strftime(on, pythonText(args[0] ?? ""));
        case "replace": {
          const field = (key: string, fallback: number): number => {
            const given = kwargs[key];
            return isNumber(given) ? given : fallback;
          };
          return new DateTime(
            moment(
              on.zone,
              field("year", read.year),
              field("month", read.month),
              field("day", read.day),
              field("hour", read.hour),
              field("minute", read.minute),
              field("second", read.second),
            ),
            on.zone,
          );
        }
      }
    }
  }
  throw new Unplayable("template", "a function the sandbox does not know");
}

function entityId(value: Value): string {
  if (value instanceof StateObject) return value.entity.entity_id;
  return pythonText(value);
}

function builtin(
  name: string,
  args: Value[],
  kwargs: Record<string, Value>,
  scope: TemplateScope,
): Value {
  const arg = (k: number, key?: string): Value =>
    key !== undefined && Object.hasOwn(kwargs, key) ? kwargs[key] : args[k];
  switch (name) {
    case "states": {
      const entity = scope.state(entityId(arg(0)));
      return entity ? entity.state : "unknown";
    }
    case "is_state": {
      const entity = scope.state(entityId(arg(0)));
      const wanted = arg(1);
      if (!entity) return false;
      return Array.isArray(wanted)
        ? wanted.some((w) => pythonText(w) === entity.state)
        : entity.state === pythonText(wanted);
    }
    case "state_attr": {
      const entity = scope.state(entityId(arg(0)));
      return entity?.attributes[pythonText(arg(1))] ?? null;
    }
    case "is_state_attr": {
      const entity = scope.state(entityId(arg(0)));
      return entity !== undefined && equal(entity.attributes[pythonText(arg(1))], arg(2));
    }
    case "has_value": {
      const entity = scope.state(entityId(arg(0)));
      return entity !== undefined && !["unknown", "unavailable"].includes(entity.state);
    }
    case "now":
    case "utcnow":
      return new DateTime(scope.now, name === "utcnow" ? "UTC" : scope.zone);
    case "today_at": {
      const seconds = parseClock(pythonText(arg(0) ?? "00:00"));
      if (seconds === undefined) throw new Unplayable("template", "today_at");
      const read = zoned(scope.now, scope.zone);
      return new DateTime(
        moment(
          scope.zone,
          read.year,
          read.month,
          read.day,
          Math.floor(seconds / 3600),
          Math.floor(seconds / 60) % 60,
          seconds % 60,
        ),
        scope.zone,
      );
    }
    case "as_datetime": {
      const value = arg(0);
      if (value instanceof DateTime) return value;
      const at = parseMoment(pythonText(value), scope.zone);
      return at !== undefined ? new DateTime(at, scope.zone) : (arg(1) ?? null);
    }
    case "as_timestamp": {
      const value = arg(0);
      if (value instanceof DateTime) return value.ms / 1000;
      const at = parseMoment(pythonText(value), scope.zone);
      if (at !== undefined) return at / 1000;
      if (args.length > 1 || "default" in kwargs) return arg(1, "default");
      throw new Unplayable("template", "as_timestamp");
    }
    case "timedelta": {
      const ms = parseDuration(
        Object.fromEntries(
          Object.entries(kwargs).filter(([k]) =>
            ["days", "hours", "minutes", "seconds", "milliseconds"].includes(k),
          ),
        ),
      );
      if (ms === undefined) throw new Unplayable("template", "timedelta");
      return new TimeDelta(ms);
    }
    case "float":
    case "int":
    case "bool":
      return filter(name, arg(0), args.slice(1), kwargs, scope);
    case "iif": {
      const value = arg(0);
      if (value === null || value === undefined || value === UNDEFINED) {
        return args.length > 3 ? arg(3) : (arg(2) ?? false);
      }
      return truth(value) ? (args.length > 1 ? arg(1) : true) : args.length > 2 ? arg(2) : false;
    }
    case "min":
    case "max": {
      const list = args.length === 1 && Array.isArray(args[0]) ? (args[0] as Value[]) : args;
      return filter(name, list, [], {}, scope);
    }
    case "abs":
    case "round":
      return filter(name, arg(0), args.slice(1), kwargs, scope);
    case "is_number":
      return toNumber(arg(0)) !== undefined && typeof arg(0) !== "boolean";
    case "range": {
      const n = toNumber(arg(0));
      if (n === undefined || n > 1000) throw new Unplayable("template", "range");
      return Array.from({ length: Math.max(0, Math.floor(n)) }, (_, k) => k);
    }
    case "area_entities": {
      const area = pythonText(arg(0));
      return scope.ids().filter((id) => scope.areaOf(id) === area);
    }
    case "area_name": {
      const value = pythonText(arg(0));
      return scope.areaName(value) ?? scope.areaName(scope.areaOf(value) ?? "") ?? null;
    }
    case "area_id":
      return scope.areaOf(pythonText(arg(0))) ?? null;
    default:
      throw new Unplayable("template", `${name}()`);
  }
}

function filter(
  name: string,
  value: Value,
  args: Value[],
  kwargs: Record<string, Value>,
  scope: TemplateScope,
): Value {
  const fallback = (): Value => {
    if (args.length > 0) return args[0];
    if ("default" in kwargs) return kwargs.default;
    // Home Assistant refuses a value it cannot convert when no default is given.
    throw new Unplayable("template", `${name}(${repr(value)})`);
  };
  switch (name) {
    case "float": {
      const n = toNumber(value);
      return n === undefined ? fallback() : n;
    }
    case "int": {
      const n = toNumber(value);
      return n === undefined ? fallback() : Math.trunc(n);
    }
    case "bool": {
      const text = pythonText(value).toLowerCase();
      if (["true", "yes", "on", "enable", "1"].includes(text)) return true;
      if (["false", "no", "off", "disable", "0", "none"].includes(text)) return false;
      return fallback();
    }
    case "round": {
      const n = toNumber(value);
      if (n === undefined) return fallback();
      const digits = toNumber(args[0] ?? 0) ?? 0;
      const f = 10 ** digits;
      return Math.round(n * f) / f;
    }
    case "abs": {
      const n = toNumber(value);
      if (n === undefined) throw new Unplayable("template", `abs(${repr(value)})`);
      return Math.abs(n);
    }
    case "lower":
      return pythonText(value).toLowerCase();
    case "upper":
      return pythonText(value).toUpperCase();
    case "title":
      return pythonText(value).replace(/\b\w/g, (c) => c.toUpperCase());
    case "trim":
      return pythonText(value).trim();
    case "string":
      return pythonText(value);
    case "default":
    case "d":
      return value === UNDEFINED || (args[1] === true && !truth(value)) ? args[0] : value;
    case "length":
    case "count":
      if (typeof value === "string" || Array.isArray(value)) return value.length;
      if (value && typeof value === "object") return Object.keys(value).length;
      throw new Unplayable("template", "length");
    case "list":
      return Array.isArray(value) ? value : typeof value === "string" ? Array.from(value) : [];
    case "first":
      return Array.isArray(value) ? (value[0] ?? UNDEFINED) : UNDEFINED;
    case "last":
      return Array.isArray(value) ? (value.at(-1) ?? UNDEFINED) : UNDEFINED;
    case "join":
      return Array.isArray(value) ? value.map(pythonText).join(pythonText(args[0] ?? "")) : "";
    case "replace":
      return pythonText(value).split(pythonText(args[0])).join(pythonText(args[1]));
    case "min":
    case "max":
    case "sum": {
      if (!Array.isArray(value)) throw new Unplayable("template", name);
      const items = value as unknown[];
      if (name === "sum") return items.reduce<number>((total, v) => total + (toNumber(v) ?? 0), 0);
      if (items.length === 0) return UNDEFINED;
      return items.reduce((best, v) =>
        (name === "min" ? order(v, best) < 0 : order(v, best) > 0) ? v : best,
      );
    }
    case "as_timestamp":
      return builtin("as_timestamp", [value, ...args], kwargs, scope);
    case "is_number":
      return toNumber(value) !== undefined;
    default:
      throw new Unplayable("template", `|${name}`);
  }
}

function test(name: string, value: Value, args: Value[]): boolean {
  switch (name) {
    case "defined":
      return value !== UNDEFINED;
    case "undefined":
      return value === UNDEFINED;
    case "none":
      return value === null;
    case "number":
      return typeof value === "number";
    case "string":
      return typeof value === "string";
    case "true":
      return value === true;
    case "false":
      return value === false;
    case "boolean":
      return typeof value === "boolean";
    case "eq":
    case "equalto":
      return equal(value, args[0]);
    case "in":
      return Array.isArray(args[0]) && args[0].some((item) => equal(item, value));
    case "is_state":
    default:
      throw new Unplayable("template", `is ${name}`);
  }
}

function strftime(at: DateTime, format: string): string {
  const read = zoned(at.ms, at.zone);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  return format.replace(/%([a-zA-Z%])/g, (_, c: string) => {
    switch (c) {
      case "H":
        return pad(read.hour);
      case "M":
        return pad(read.minute);
      case "S":
        return pad(read.second);
      case "Y":
        return String(read.year);
      case "m":
        return pad(read.month);
      case "d":
        return pad(read.day);
      case "A":
        return days[read.weekday] ?? "";
      case "a":
        return (days[read.weekday] ?? "").slice(0, 3);
      case "%":
        return "%";
      default:
        throw new Unplayable("template", `%${c}`);
    }
  });
}

// ------------------------------------------------------------------------------- rendering

/** Whether `value` is a template (a text with `{{` or `{%`). */
export function isTemplate(value: unknown): value is string {
  return typeof value === "string" && (value.includes("{{") || value.includes("{%"));
}

/**
 * Renders `template`: the value itself when it is one `{{ … }}` and nothing else (as Home
 * Assistant's native rendering), else the text with each expression written in.
 */
export function render(template: string, scope: TemplateScope): unknown {
  if (template.includes("{%")) throw new Unplayable("template", "{% … %}");
  const whole = /^\s*\{\{([\s\S]*?)\}\}\s*$/.exec(template);
  if (whole && !(whole[1] ?? "").includes("}}")) {
    const value = evaluate(parseExpression(whole[1] ?? ""), scope);
    return native(value);
  }
  return template.replace(/\{\{([\s\S]*?)\}\}/g, (_, source: string) =>
    pythonText(evaluate(parseExpression(source), scope)),
  );
}

/** A rendered value as Home Assistant's native rendering gives it. */
function native(value: Value): unknown {
  if (value === UNDEFINED) return "";
  if (value instanceof DateTime) return pythonText(value);
  if (value instanceof TimeDelta) return value.ms / 1000;
  if (value instanceof StateObject) return pythonText(value);
  // A text that reads as a number or a boolean is one (Home Assistant's `parse_result`).
  if (typeof value === "string") {
    const text = value.trim();
    if (/^-?\d+(\.\d+)?$/.test(text) && !/^-?0\d/.test(text)) return Number(text);
    if (text === "True") return true;
    if (text === "False") return false;
  }
  return value;
}

/** A template condition, as Home Assistant reads one: true when it renders `true`. */
export function renderCondition(template: string, scope: TemplateScope): boolean {
  if (template.includes("{%")) throw new Unplayable("template", "{% … %}");
  const text = template.replace(/\{\{([\s\S]*?)\}\}/g, (_, source: string) =>
    pythonText(evaluate(parseExpression(source), scope)),
  );
  return text.trim().toLowerCase() === "true";
}

/**
 * Whether a template trigger's template holds, as Home Assistant reads its result: true, a number
 * other than zero, or a text saying yes (`on`, `yes`, `enable`, `1`).
 */
export function renderTruth(template: string, scope: TemplateScope): boolean {
  const value = render(template, scope);
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value !== "string") return false;
  const text = value.trim().toLowerCase();
  if (["1", "true", "yes", "on", "enable"].includes(text)) return true;
  const number = Number(text);
  return text !== "" && Number.isFinite(number) && number !== 0;
}

/** Renders every template in `value` (an action's data). */
export function renderDeep(value: unknown, scope: TemplateScope, depth = 0): unknown {
  if (depth > 20) throw new Unplayable("template", "too deep");
  if (isTemplate(value)) return render(value, scope);
  if (Array.isArray(value)) return value.map((item) => renderDeep(item, scope, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, renderDeep(item, scope, depth + 1)]),
    );
  }
  return value;
}
