/**
 * Reading a component of canonical IR before it is run. The runtime is not the IR's checker (that is `checkIr`, a compiler-side tool it does not depend on); it reads what it
 * is about to run and refuses, before a single node is made, what it could not run faithfully:
 *
 *   OBIX_RUNTIME_SCHEMA       not a component of obix-dop-ir/3
 *   OBIX_RUNTIME_INVALID_IR   a node, a text part, an expression, a step or an operator of a kind the IR does not have; a call of a function the IR does not have, or with the
 *                             wrong number of arguments; a reference to a prop, a state, a derived value or a local the component does not declare where it is written; an
 *                             assign to a state it does not declare; an invoke of an action it does not declare; an output on a channel it does not declare; an invocation of a
 *                             component it does not declare as a dependency; the event payload outside an event handler or an interaction
 *
 * What it returns is the same component, now known to be one the runtime can run.
 */
import { ObixRuntimeError } from 'obix-runtime-dom';
import { OBIX_RUNTIME_IR } from './ir.js';
import type { ObixIrComponent, ObixIrExpression, ObixIrNode, ObixIrStep } from './ir.js';

const invalid = (component: string, message: string): ObixRuntimeError => new ObixRuntimeError('OBIX_RUNTIME_INVALID_IR', `${component}: ${message}`);

const has = (table: readonly string[], value: unknown): boolean => typeof value === 'string' && table.includes(value);
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const list = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : []);

/** Where an expression or a step is written: the locals in scope, and whether the event payload exists there. */
interface Place {
  readonly locals: ReadonlySet<string>;
  readonly event: boolean;
}

/** Read `value` as a component the runtime can run, or refuse it. */
export function readComponent(value: unknown): ObixIrComponent {
  if (!isRecord(value) || value['kind'] !== 'component' || value['schema'] !== OBIX_RUNTIME_IR.schema) {
    const what = isRecord(value) ? `a ${String(value['kind'])} of schema ${String(value['schema'])}` : value === null ? 'null' : `a ${typeof value}`;
    throw new ObixRuntimeError('OBIX_RUNTIME_SCHEMA', `the native runtime reads components of ${OBIX_RUNTIME_IR.schema}; it was given ${what}`);
  }
  const ir = value as unknown as ObixIrComponent;
  const name = typeof ir.name === 'string' && ir.name !== '' ? ir.name : 'a component';
  const names = (entries: readonly unknown[], member: string): Set<string> =>
    new Set(entries.filter(isRecord).map((entry) => entry[member]).filter((n): n is string => typeof n === 'string'));
  const declared = {
    props: names(list(ir.props), 'name'),
    state: names(list(ir.state), 'name'),
    derived: names(list(ir.derived), 'name'),
    actions: new Map(list(ir.actions).filter(isRecord).map((a) => [String(a['name']), a])),
    outputs: names(list(ir.outputs), 'channel'),
    dependencies: names(list(ir.dependencies), 'local'),
  };

  const expression = (e: unknown, place: Place, where: string): void => {
    if (!isRecord(e) || !has(OBIX_RUNTIME_IR.expressionKinds, e['kind'])) throw invalid(name, `${where}: an expression of kind ${isRecord(e) ? String(e['kind']) : typeof e}, which the IR does not have`);
    const x = e as unknown as ObixIrExpression;
    switch (x.kind) {
      case 'literal':
        return;
      case 'array':
        list(x.elements).forEach((element, i) => expression(element, place, `${where}.elements[${i}]`));
        return;
      case 'object':
        list(x.entries).forEach((entry, i) => expression(isRecord(entry) ? entry['value'] : entry, place, `${where}.entries[${i}]`));
        return;
      case 'reference': {
        if (!has(OBIX_RUNTIME_IR.referenceScopes, x.scope)) throw invalid(name, `${where}: a reference of scope ${String(x.scope)}, which the IR does not have`);
        const known = x.scope === 'local' ? place.locals : x.scope === 'prop' ? declared.props : x.scope === 'state' ? declared.state : declared.derived;
        if (!known.has(x.name)) throw invalid(name, `${where}: ${x.scope} ${x.name} is not declared ${x.scope === 'local' ? 'where it is read' : 'by the component'}`);
        return;
      }
      case 'event-payload':
        if (!place.event) throw invalid(name, `${where}: the event payload is read outside an event handler`);
        return;
      case 'member':
        expression(x.object, place, `${where}.object`);
        return;
      case 'index':
        expression(x.object, place, `${where}.object`);
        expression(x.index, place, `${where}.index`);
        return;
      case 'unary':
        if (!has(OBIX_RUNTIME_IR.unaryOperators, x.operator)) throw invalid(name, `${where}: the unary operator ${String(x.operator)}, which the IR does not have`);
        expression(x.operand, place, `${where}.operand`);
        return;
      case 'binary':
        if (!has(OBIX_RUNTIME_IR.binaryOperators, x.operator)) throw invalid(name, `${where}: the binary operator ${String(x.operator)}, which the IR does not have`);
        expression(x.left, place, `${where}.left`);
        expression(x.right, place, `${where}.right`);
        return;
      case 'logical':
        if (!has(OBIX_RUNTIME_IR.logicalOperators, x.operator)) throw invalid(name, `${where}: the logical operator ${String(x.operator)}, which the IR does not have`);
        expression(x.left, place, `${where}.left`);
        expression(x.right, place, `${where}.right`);
        return;
      case 'choice':
        expression(x.test, place, `${where}.test`);
        expression(x.consequent, place, `${where}.consequent`);
        expression(x.alternate, place, `${where}.alternate`);
        return;
      case 'call': {
        if (!has(OBIX_RUNTIME_IR.functions, x.function)) throw invalid(name, `${where}: a call of ${String(x.function)}, which is not a function of the IR`);
        const args = list(x.arguments);
        if (args.length !== OBIX_RUNTIME_IR.functionArity[x.function]) throw invalid(name, `${where}: ${x.function} takes ${OBIX_RUNTIME_IR.functionArity[x.function]} argument(s), it is given ${args.length}`);
        args.forEach((argument, i) => expression(argument, place, `${where}.arguments[${i}]`));
        return;
      }
    }
  };

  const steps = (value: unknown, place: Place, where: string): void => {
    list(value).forEach((s, i) => {
      const at = `${where}[${i}]`;
      if (!isRecord(s) || !has(OBIX_RUNTIME_IR.stepKinds, s['kind'])) throw invalid(name, `${at}: a step of kind ${isRecord(s) ? String(s['kind']) : typeof s}, which the IR does not have`);
      const step = s as unknown as ObixIrStep;
      switch (step.kind) {
        case 'assign':
          if (!declared.state.has(step.target)) throw invalid(name, `${at}: an assign to ${step.target}, which is not a state of the component`);
          expression(step.value, place, `${at}.value`);
          return;
        case 'invoke': {
          const action = declared.actions.get(step.action);
          if (action === undefined) throw invalid(name, `${at}: an invoke of ${step.action}, which is not an action of the component`);
          list(step.arguments).forEach((argument, j) => expression(argument, place, `${at}.arguments[${j}]`));
          return;
        }
        case 'output':
          if (!declared.outputs.has(step.channel)) throw invalid(name, `${at}: an output on ${step.channel}, which is not an output of the component`);
          if (step.value !== null) expression(step.value, place, `${at}.value`);
          return;
      }
    });
  };

  const nodes = (value: unknown, place: Place, where: string): void => {
    list(value).forEach((n, i) => {
      const at = `${where}[${i}]`;
      if (!isRecord(n) || !has(OBIX_RUNTIME_IR.nodeKinds, n['kind'])) throw invalid(name, `${at}: a node of kind ${isRecord(n) ? String(n['kind']) : typeof n}, which the IR does not have`);
      const node = n as unknown as ObixIrNode;
      switch (node.kind) {
        case 'element': {
          for (const [key, bindings] of [['properties', node.properties], ['accessibility.properties', node.accessibility?.properties]] as const) {
            list(bindings).forEach((b, j) => expression(isRecord(b) ? b['value'] : b, place, `${at}.${key}[${j}].value`));
          }
          list(node.events).forEach((e, j) => steps(isRecord(e) ? e['steps'] : [], { locals: place.locals, event: true }, `${at}.events[${j}].steps`));
          nodes(node.children, place, `${at}.children`);
          return;
        }
        case 'text':
          list(node.parts).forEach((p, j) => {
            if (!isRecord(p) || (p['kind'] !== 'static' && p['kind'] !== 'display')) throw invalid(name, `${at}.parts[${j}]: a text part of kind ${isRecord(p) ? String(p['kind']) : typeof p}, which the IR does not have`);
            if (p['kind'] === 'display') expression(p['expression'], place, `${at}.parts[${j}].expression`);
          });
          return;
        case 'conditional':
          list(node.branches).forEach((b, j) => {
            const branch = isRecord(b) ? b : {};
            expression(branch['condition'], place, `${at}.branches[${j}].condition`);
            nodes(branch['body'], place, `${at}.branches[${j}].body`);
          });
          if (node.otherwise !== null) nodes(node.otherwise, place, `${at}.otherwise`);
          return;
        case 'iteration': {
          expression(node.source, place, `${at}.source`);
          const inner = { locals: new Set([...place.locals, node.item, ...(node.index === null ? [] : [node.index])]), event: place.event };
          if (node.key !== null) expression(node.key, inner, `${at}.key`);
          nodes(node.body, inner, `${at}.body`);
          return;
        }
        case 'invocation':
          if (!declared.dependencies.has(node.component)) throw invalid(name, `${at}: an invocation of ${node.component}, which is not a dependency of the component`);
          list(node.properties).forEach((b, j) => expression(isRecord(b) ? b['value'] : b, place, `${at}.properties[${j}].value`));
          list(node.children).forEach((c, j) => {
            const content = isRecord(c) ? c : {};
            const parameters = list(content['parameters']).filter(isRecord).map((p) => String(p['local']));
            nodes(content['body'], { locals: new Set([...place.locals, ...parameters]), event: place.event }, `${at}.children[${j}].body`);
          });
          list(node.interactions).forEach((x, j) => steps(isRecord(x) ? x['steps'] : [], { locals: place.locals, event: true }, `${at}.interactions[${j}].steps`));
          return;
        case 'projection':
          list(node.arguments).forEach((a, j) => expression(isRecord(a) ? a['value'] : a, place, `${at}.arguments[${j}].value`));
          nodes(node.fallback, place, `${at}.fallback`);
          return;
      }
    });
  };

  const top: Place = { locals: new Set(), event: false };
  list(ir.props).forEach((p, i) => { if (isRecord(p) && p['default'] !== null && p['default'] !== undefined) expression(p['default'], top, `props[${i}].default`); });
  list(ir.state).forEach((s, i) => expression(isRecord(s) ? s['initial'] : s, top, `state[${i}].initial`));
  list(ir.derived).forEach((d, i) => expression(isRecord(d) ? d['expression'] : d, top, `derived[${i}].expression`));
  list(ir.actions).forEach((a, i) => {
    const action = isRecord(a) ? a : {};
    steps(action['steps'], { locals: new Set(list(action['parameters']).map(String)), event: false }, `actions[${i}].steps`);
  });
  list(ir.effects).forEach((e, i) => {
    const effect = isRecord(e) ? e : {};
    expression(effect['watch'], top, `effects[${i}].watch`);
    steps(effect['steps'], { locals: new Set(list(effect['parameters']).map(String)), event: false }, `effects[${i}].steps`);
  });
  nodes(ir.view, top, 'view');
  derivedCircle(ir, name);
  return ir;
}

/** The derived values an expression reads directly. */
function derivedReads(expression: unknown, out: Set<string>): Set<string> {
  if (Array.isArray(expression)) {
    for (const item of expression) derivedReads(item, out);
  } else if (isRecord(expression)) {
    if (expression['kind'] === 'reference' && expression['scope'] === 'derived') out.add(String(expression['name']));
    for (const value of Object.values(expression)) derivedReads(value, out);
  }
  return out;
}

/** Refuse a circle of derived values — one that reads itself, directly or through others — naming it: `a → b → a`. */
function derivedCircle(ir: ObixIrComponent, name: string): void {
  const reads = new Map(ir.derived.map((d) => [d.name, derivedReads(d.expression, new Set())]));
  const done = new Set<string>();
  const visit = (current: string, path: readonly string[]): void => {
    if (path.includes(current)) throw invalid(name, `a circle of derived values: ${[...path.slice(path.indexOf(current)), current].join(' → ')}`);
    if (done.has(current)) return;
    for (const next of reads.get(current) ?? []) visit(next, [...path, current]);
    done.add(current);
  };
  for (const derived of ir.derived) visit(derived.name, []);
}
