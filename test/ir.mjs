/**
 * Builders of canonical IR (obix-dop-ir/3) by hand, for the unit tests of the native runtime. They write plain data, exactly the shape the frontends lower into — nothing here
 * knows a frontend. Ids are paths, as the frontends write them, and are given by the caller where a test needs them.
 */
export const SCHEMA = 'obix-dop-ir/3';

let next = 0;
const id = (prefix = 'n') => `${prefix}.${next++}`;

export const lit = (value) => ({ kind: 'literal', value });
export const ref = (scope, name) => ({ kind: 'reference', scope, name });
export const state = (name) => ref('state', name);
export const prop = (name) => ref('prop', name);
export const derived = (name) => ref('derived', name);
export const local = (name) => ref('local', name);
export const payload = () => ({ kind: 'event-payload' });
export const member = (object, property) => ({ kind: 'member', object, property });
export const index = (object, i) => ({ kind: 'index', object, index: i });
export const unary = (operator, operand) => ({ kind: 'unary', operator, operand });
export const binary = (operator, left, right) => ({ kind: 'binary', operator, left, right });
export const logical = (operator, left, right) => ({ kind: 'logical', operator, left, right });
export const choice = (test, consequent, alternate) => ({ kind: 'choice', test, consequent, alternate });
export const call = (fn, ...args) => ({ kind: 'call', function: fn, arguments: args });
export const array = (...elements) => ({ kind: 'array', elements });
export const object = (entries) => ({ kind: 'object', entries: Object.entries(entries).map(([key, value]) => ({ key, value })) });

export const assign = (target, value) => ({ kind: 'assign', id: id('step'), target, value });
export const invoke = (action, ...args) => ({ kind: 'invoke', id: id('step'), action, arguments: args });
export const output = (channel, value = null) => ({ kind: 'output', id: id('step'), channel, value });

export const attr = (name, value) => ({ id: id('attr'), name, value });
export const bind = (name, value) => ({ id: id('bind'), name, value });
export const on = (event, ...steps) => ({ id: id('event'), event, steps });

/** An element: `el('p', { attributes, properties, a11y: { attributes, properties }, events }, ...children)`. */
export function el(tag, options = {}, ...children) {
  return {
    kind: 'element',
    id: options.id ?? id('el'),
    tag,
    attributes: options.attributes ?? [],
    properties: options.properties ?? [],
    accessibility: { attributes: options.a11y?.attributes ?? [], properties: options.a11y?.properties ?? [] },
    events: options.events ?? [],
    children,
  };
}

/** A text of parts: a string is a static part, anything else an expression shown. */
export const text = (...parts) => ({
  kind: 'text',
  id: id('text'),
  parts: parts.map((part) => (typeof part === 'string' ? { kind: 'static', value: part } : { kind: 'display', expression: part })),
});

export const branch = (condition, ...body) => ({ id: id('branch'), condition, body });
export const conditional = (branches, otherwise = null) => ({ kind: 'conditional', id: id('if'), branches, otherwise });
export const iteration = (source, item, body, { index = null, key = null } = {}) => ({ kind: 'iteration', id: id('for'), source, item, index, key, body });
export const invocation = (component, { attributes = [], properties = [], children = [], interactions = [] } = {}) => ({ kind: 'invocation', id: id('inv'), component, attributes, properties, children, interactions });
export const content = (slot, body, parameters = []) => ({ id: id('content'), slot, parameters, body });
export const interaction = (channel, ...steps) => ({ id: id('interaction'), channel, steps });
export const projection = (slot, fallback = [], args = []) => ({ kind: 'projection', id: id('slot'), slot, arguments: args.map(([name, value]) => ({ id: id('arg'), name, value })), fallback });

/** A component. Everything but the view is optional. */
export function component(name, view, parts = {}) {
  return {
    schema: SCHEMA,
    kind: 'component',
    id: 'component',
    name,
    props: (parts.props ?? []).map((p) => ({ id: id('prop'), required: false, default: null, type: 'unknown', ...p })),
    state: Object.entries(parts.state ?? {}).map(([n, initial]) => ({ id: id('state'), name: n, initial })),
    derived: Object.entries(parts.derived ?? {}).map(([n, expression]) => ({ id: id('derived'), name: n, expression })),
    outputs: (parts.outputs ?? []).map((o) => ({ id: id('output'), payload: null, ...o })),
    actions: Object.entries(parts.actions ?? {}).map(([n, a]) => ({ id: id('action'), name: n, parameters: a.parameters ?? [], steps: a.steps })),
    effects: (parts.effects ?? []).map((e) => ({ id: id('effect'), parameters: [], ...e })),
    dependencies: Object.entries(parts.dependencies ?? {}).map(([localName, specifier]) => ({ id: id('dep'), local: localName, specifier, export: 'default' })),
    view,
    styles: [],
  };
}
