/**
 * The props of a component, from the inputs it is given — the IR's rules:
 *
 *   - an input that is `undefined` is not given; an input the component does not declare is refused (OBIX_RUNTIME_INPUT);
 *   - a prop that is not given is its default — a constant, evaluated when it is needed — or `undefined` when it has none;
 *   - a prop of type `boolean` means what an HTML boolean attribute means: not given is `false` (unless it has a default), given as the empty string — a bare attribute — or as
 *     its own name hyphenated (`isOn` → `is-on`, as an attribute writes it) is `true`.
 */
import { ObixRuntimeError } from 'obix-runtime-dom';
import { evaluate } from './evaluate.js';
import type { Scope } from './evaluate.js';
import type { ObixIrComponent, ObixIrProp } from './ir.js';

/** `isOn` → `is-on`. */
const hyphenate = (name: string): string => name.replace(/\B([A-Z])/g, '-$1').toLowerCase();

/** The scope of a constant — a default, an initial state — which reads no name. */
export const CONSTANT_SCOPE: Scope = {
  prop: () => undefined,
  state: () => undefined,
  derived: () => undefined,
  local: () => undefined,
  event: undefined,
};

/** Refuse an input the component does not declare. */
export function checkInputs(ir: ObixIrComponent, inputs: Readonly<Record<string, unknown>>): void {
  const declared = new Set(ir.props.map((p) => p.name));
  for (const name of Object.keys(inputs)) {
    if (!declared.has(name)) throw new ObixRuntimeError('OBIX_RUNTIME_INPUT', `${ir.name} is given the input ${name}, which it does not declare`);
  }
}

/** The value of one prop, given `inputs`. */
export function propValue(prop: ObixIrProp, inputs: Readonly<Record<string, unknown>>): unknown {
  const given = Object.prototype.hasOwnProperty.call(inputs, prop.name) ? inputs[prop.name] : undefined;
  if (prop.type === 'boolean') {
    if (given === '' || given === hyphenate(prop.name)) return true;
    if (given === undefined && prop.default === null) return false;
  }
  if (given !== undefined) return given;
  return prop.default === null ? undefined : evaluate(prop.default, CONSTANT_SCOPE);
}
