/**
 * The expressions of the canonical IR, evaluated by the native runtime: a small structured language over plain data, with the meaning ECMAScript gives each operator on the
 * values it is given — `+ - * / %`, strict equality and order, `! - +`, the short-circuit `&& || ??` (the right side is not evaluated when the left decides), the choice
 * `a ? b : c`, member and index access (a member of `null` or `undefined` throws a TypeError, as in ECMAScript), and the intrinsic functions of the IR (`round` is `Math.round`).
 * A literal array or object is a NEW value each time it is evaluated.
 *
 * Where a name is read from is the `Scope`: the props, state and derived values of the component, the locals in scope, and the event payload inside a handler.
 */
import type { ObixIrExpression } from './ir.js';

export interface Scope {
  /** a prop of the component */
  prop(name: string): unknown;
  /** a state of the component */
  state(name: string): unknown;
  /** a derived value of the component */
  derived(name: string): unknown;
  /** a local in scope where the expression is written */
  local(name: string): unknown;
  /** the event payload, inside a handler */
  readonly event: unknown;
}

export function evaluate(expression: ObixIrExpression, scope: Scope): unknown {
  switch (expression.kind) {
    case 'literal':
      return expression.value;
    case 'array':
      return expression.elements.map((element) => evaluate(element, scope));
    case 'object': {
      const object: Record<string, unknown> = {};
      for (const entry of expression.entries) object[entry.key] = evaluate(entry.value, scope);
      return object;
    }
    case 'reference':
      switch (expression.scope) {
        case 'prop':
          return scope.prop(expression.name);
        case 'state':
          return scope.state(expression.name);
        case 'derived':
          return scope.derived(expression.name);
        case 'local':
          return scope.local(expression.name);
      }
      break;
    case 'event-payload':
      return scope.event;
    case 'member':
      return (evaluate(expression.object, scope) as Record<string, unknown>)[expression.property];
    case 'index':
      return (evaluate(expression.object, scope) as Record<PropertyKey, unknown>)[evaluate(expression.index, scope) as PropertyKey];
    case 'unary': {
      const operand = evaluate(expression.operand, scope) as number;
      switch (expression.operator) {
        case '!':
          return !operand;
        case '-':
          return -operand;
        case '+':
          return +operand;
      }
      break;
    }
    case 'binary': {
      const left = evaluate(expression.left, scope) as number;
      const right = evaluate(expression.right, scope) as number;
      switch (expression.operator) {
        case '+':
          return left + right;
        case '-':
          return left - right;
        case '*':
          return left * right;
        case '/':
          return left / right;
        case '%':
          return left % right;
        case '===':
          return left === right;
        case '!==':
          return left !== right;
        case '<':
          return left < right;
        case '<=':
          return left <= right;
        case '>':
          return left > right;
        case '>=':
          return left >= right;
      }
      break;
    }
    case 'logical': {
      const left = evaluate(expression.left, scope);
      switch (expression.operator) {
        case '&&':
          return left ? evaluate(expression.right, scope) : left;
        case '||':
          return left ? left : evaluate(expression.right, scope);
        case '??':
          return left ?? evaluate(expression.right, scope);
      }
      break;
    }
    case 'choice':
      return evaluate(expression.test, scope) ? evaluate(expression.consequent, scope) : evaluate(expression.alternate, scope);
    case 'call': {
      const args = expression.arguments.map((argument) => evaluate(argument, scope));
      switch (expression.function) {
        case 'round':
          return Math.round(args[0] as number);
      }
      break;
    }
  }
  // readComponent refuses every kind, scope, operator and function the IR does not have before anything is evaluated
  throw new TypeError(`an expression the runtime does not read: ${JSON.stringify(expression)}`);
}
