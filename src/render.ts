/**
 * Rendering the view of a component into DOM nodes, by the document of the target (the runtime reads no global). A view is a list of PIECES, each of which knows the DOM nodes it
 * shows NOW, in order: an element or a text is one node for good; a conditional (N5) is the body it shows followed by an anchor — an empty comment the page does not show — that
 * marks its place, so a new body goes where the old one was; an iteration (N6) is the bodies of its elements, in order, followed by its anchor; an invocation (N7) is the view of
 * the component it invokes; a projection (N7) is what the invoker put into its slot, or its fallback, followed by its anchor.
 *
 * Everything a piece makes — bindings, listeners, the pieces inside it — belongs to the effect scope running when it is made, and goes away with it: a conditional gives each body
 * it shows a scope of its own and stops it when it shows another.
 *
 * Every piece is rendered in a NAMESPACE (obix-runtime-dom): an element is made in the namespace an HTML parser would give it where it stands — `svg` and what is inside it SVG,
 * `math` MathML, a `foreignObject`'s content HTML again — and the namespace follows the view into its bodies, into the components it invokes and into projected content.
 */
import { ObixRuntimeError, computed, effectScope, onScopeDispose, ref, untracked } from 'obix-runtime-reactivity';
import type { ComputedRef, EffectScope, Ref } from 'obix-runtime-reactivity';
import { contentNamespace, createElementIn, displayText, elementNamespace, setAttributeValue, setBoundAttribute } from 'obix-runtime-dom';
import type { Namespace } from 'obix-runtime-dom';
import { evaluate } from './evaluate.js';
import { Instance, NO_LOCALS, withLocals } from './instance.js';
import type { Listener, Locals, Provided } from './instance.js';
import { runSteps } from './steps.js';
import type { ObixIrAttribute, ObixIrConditional, ObixIrElement, ObixIrInvocation, ObixIrIteration, ObixIrNode, ObixIrProjection, ObixIrPropertyBinding, ObixIrText } from './ir.js';

/** Something the view shows: the DOM nodes it is made of now, in order. */
export interface Piece {
  nodes(): Node[];
}

/** The DOM nodes of `pieces`, in order. */
export const nodesOf = (pieces: readonly Piece[]): Node[] => pieces.flatMap((piece) => piece.nodes());

const fixed = (node: Node): Piece => ({ nodes: () => [node] });

/** Put `nodes` before `anchor`, in its parent. */
function insertBefore(anchor: Node, nodes: readonly Node[]): void {
  const parent = anchor.parentNode;
  if (parent === null) return;
  for (const node of nodes) parent.insertBefore(node, anchor);
}

const remove = (nodes: readonly Node[]): void => {
  for (const node of nodes) node.parentNode?.removeChild(node);
};

/**
 * The writers of an element's attributes, each name with the one that decides it: the LAST in the IR's order — attributes, bound attributes, accessibility attributes, bound
 * accessibility attributes — as the IR's meaning writes them one after another (a later `null` takes an earlier value away).
 */
function attributeWriters(node: ObixIrElement): Map<string, ObixIrAttribute | ObixIrPropertyBinding> {
  const writers = new Map<string, ObixIrAttribute | ObixIrPropertyBinding>();
  for (const writer of [...node.attributes, ...node.properties, ...node.accessibility.attributes, ...node.accessibility.properties]) {
    writers.delete(writer.name);
    writers.set(writer.name, writer);
  }
  return writers;
}

function renderElement(node: ObixIrElement, instance: Instance, locals: Locals, where: Namespace): Piece {
  const namespace = elementNamespace(node.tag, where);
  const element = createElementIn(instance.document, node.tag, namespace);
  // the children first: a select's value is one of its options, which must be there when the value is written
  element.append(...nodesOf(renderNodes(node.children, instance, locals, contentNamespace(node.tag, namespace))));
  const scope = instance.scopeWith(locals, undefined);
  for (const [name, writer] of attributeWriters(node)) {
    const value = writer.value;
    if (typeof value === 'string') setAttributeValue(element, name, value);
    else instance.bind(() => setBoundAttribute(element, name, evaluate(value, scope)));
  }
  for (const binding of node.events) {
    const listener = (event: Event): void => runSteps(binding.steps, instance, locals, event);
    element.addEventListener(binding.event, listener);
    onScopeDispose(() => element.removeEventListener(binding.event, listener));
  }
  return fixed(element);
}

function renderText(node: ObixIrText, instance: Instance, locals: Locals): Piece {
  const text = instance.document.createTextNode('');
  if (node.parts.every((part) => part.kind === 'static')) {
    text.data = node.parts.map((part) => (part.kind === 'static' ? part.value : '')).join('');
    return fixed(text);
  }
  const scope = instance.scopeWith(locals, undefined);
  instance.bind(() => {
    const data = node.parts.map((part) => (part.kind === 'static' ? part.value : displayText(evaluate(part.expression, scope)))).join('');
    if (text.data !== data) text.data = data;
  });
  return fixed(text);
}

/** What a region shows now: the pieces of a body, and the scope they belong to. */
interface Shown {
  readonly pieces: Piece[];
  readonly owner: EffectScope;
}

/** Render `body` in a scope of its own, inside `region`. */
function renderBody(region: EffectScope, body: readonly ObixIrNode[], instance: Instance, locals: Locals, where: Namespace): Shown {
  return region.run(() => {
    const owner = effectScope();
    const pieces = owner.run(() => untracked(() => renderNodes(body, instance, locals, where)))!;
    return { pieces, owner };
  })!;
}

/** Take a body out of the page and stop everything it made. */
function takeOut(shown: Shown): void {
  const nodes = nodesOf(shown.pieces);
  shown.owner.stop();
  remove(nodes);
}

/**
 * A conditional: the body of the FIRST branch whose condition is truthy (the conditions are read in order, and none after it), else `otherwise`, else nothing. The choice is a
 * binding: when it changes, the body shown is taken out and the new one put in its place; when it does not, nothing is rebuilt.
 */
function renderConditional(node: ObixIrConditional, instance: Instance, locals: Locals, where: Namespace): Piece {
  const anchor = instance.document.createComment('');
  const scope = instance.scopeWith(locals, undefined);
  const region = effectScope();
  const NONE = -2;
  const OTHERWISE = -1;
  let index: number | null = null;
  let shown: Shown | null = null;
  const choose = (): number => {
    for (let i = 0; i < node.branches.length; i++) if (evaluate(node.branches[i]!.condition, scope)) return i;
    return node.otherwise !== null ? OTHERWISE : NONE;
  };
  instance.bind(() => {
    const next = choose();
    if (next === index) return;
    index = next;
    if (shown !== null) takeOut(shown);
    const body = next >= 0 ? node.branches[next]!.body : next === OTHERWISE ? node.otherwise! : [];
    shown = renderBody(region, body, instance, locals, where);
    insertBefore(anchor, nodesOf(shown.pieces));
  });
  return { nodes: () => [...(shown === null ? [] : nodesOf(shown.pieces)), anchor] };
}

/** How the reference evaluator tells keys apart: by their JSON text (`undefined` for undefined) — so 1 and "1" are two keys. */
const keyText = (key: unknown): string => (key === undefined ? 'undefined' : String(JSON.stringify(key)));

/**
 * The positions, in `sequence`, of a longest strictly increasing subsequence of its non-negative values (a negative value is a new body, never kept): the bodies that stay where
 * they are while the others move around them — as few moves as the new order allows.
 */
function longestIncreasing(sequence: readonly number[]): Set<number> {
  const tails: number[] = [];
  const previous = new Array<number>(sequence.length).fill(-1);
  for (let i = 0; i < sequence.length; i++) {
    const value = sequence[i]!;
    if (value < 0) continue;
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sequence[tails[mid]!]! < value) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) previous[i] = tails[lo - 1]!;
    tails[lo] = i;
  }
  const kept = new Set<number>();
  for (let i = tails.length > 0 ? tails[tails.length - 1]! : -1; i >= 0; i = previous[i]!) kept.add(i);
  return kept;
}

/** The body of one element of an iteration: its key, its item and index (refs, so its bindings follow them), and what it shows. */
interface Row {
  readonly key: string;
  readonly item: Ref<unknown>;
  readonly index: Ref<number>;
  readonly shown: Shown;
}

/**
 * An iteration: the body once for each element of an ARRAY (anything else is refused), in order, with the item — and the index, when there is one — in scope. The KEY says which
 * element is which (with no key, the position): when the array changes, the body of a key still there is kept — its item and index updated, so its bindings follow — the bodies
 * of keys that are gone are taken out, new keys get new bodies, and the kept bodies are moved as little as the new order allows; a field that had the focus keeps it. Two
 * elements with one key are refused.
 */
function renderIteration(node: ObixIrIteration, instance: Instance, locals: Locals, where: Namespace): Piece {
  const anchor = instance.document.createComment('');
  const scope = instance.scopeWith(locals, undefined);
  const region = effectScope();
  const names = node.index === null ? [node.item] : [node.item, node.index];
  let rows: Row[] = [];

  const make = (key: string, element: unknown, position: number): Row => {
    const item = ref(element);
    const index = ref(position);
    const inner = Object.create(locals) as Record<string, () => unknown>;
    inner[node.item] = () => item.value;
    if (node.index !== null) inner[node.index] = () => index.value;
    return { key, item, index, shown: renderBody(region, node.body, instance, inner, where) };
  };

  const reconcile = (source: readonly unknown[], keys: readonly string[]): void => {
    const previous = rows;
    const byKey = new Map(previous.map((row) => [row.key, row]));
    const next: Row[] = [];
    source.forEach((element, position) => {
      const key = keys[position]!;
      const kept = byKey.get(key);
      if (kept === undefined) {
        next.push(make(key, element, position));
      } else {
        byKey.delete(key);
        kept.item.value = element;
        kept.index.value = position;
        next.push(kept);
      }
    });
    for (const gone of byKey.values()) takeOut(gone.shown);
    rows = next;
    if (anchor.parentNode === null) return;
    // the moves: every body not in a longest run of kept bodies already in order is put before the one that follows it
    const document = anchor.ownerDocument;
    const focused = document.activeElement;
    const was = new Map(previous.map((row, i) => [row, i]));
    const stay = longestIncreasing(next.map((row) => was.get(row) ?? -1));
    let before: Node = anchor;
    for (let i = next.length - 1; i >= 0; i--) {
      const nodes = nodesOf(next[i]!.shown.pieces);
      if (!stay.has(i)) insertBefore(before, nodes);
      if (nodes.length > 0) before = nodes[0]!;
    }
    if (focused !== null && focused !== document.activeElement && focused.isConnected) (focused as HTMLElement).focus();
  };

  instance.bind(() => {
    const source = evaluate(node.source, scope);
    if (!Array.isArray(source)) {
      throw new ObixRuntimeError('OBIX_RUNTIME_VALUE', `${instance.ir.name}: iteration over ${source === undefined ? 'undefined' : JSON.stringify(source)}: the source of an iteration is an array`);
    }
    const keys = source.map((element, position) =>
      keyText(node.key === null ? position : evaluate(node.key, instance.scopeWith(withLocals(locals, names, [element, position]), undefined))),
    );
    const seen = new Set<string>();
    for (const key of keys) {
      if (seen.has(key)) throw new ObixRuntimeError('OBIX_RUNTIME_VALUE', `${instance.ir.name}: two elements of an iteration have the key ${key}: a key says which element is which`);
      seen.add(key);
    }
    untracked(() => reconcile(source, keys));
  });
  return { nodes: () => [...rows.flatMap((row) => nodesOf(row.shown.pieces)), anchor] };
}

/**
 * An invocation: the component it names, made the first time the invocation is rendered — with the inputs given, and what the invoker put inside as its slots, written in the
 * invoker's scope — and then given new inputs whenever the fixed and bound inputs change (a binding of the INVOKER: in a flush it runs before the invoked component's own
 * updates). The invoked component belongs to the scope the invocation is made in: it keeps its state while the invocation stays in the view, and is stopped with it.
 */
function renderInvocation(node: ObixIrInvocation, instance: Instance, locals: Locals, where: Namespace): Piece {
  const ir = instance.linker.resolve(instance.ir, node.component);
  const scope = instance.scopeWith(locals, undefined);
  const slots = new Map<string, Provided>(node.children.map((content) => [content.slot, { content, instance, locals }]));
  // what the invoked component tells on a channel runs the interaction for it here, in the invoker, where the invocation is written
  const listeners = new Map<string, Listener>(node.interactions.map((interaction) => [interaction.channel, (value: unknown) => runSteps(interaction.steps, instance, locals, value)]));
  let child: Instance | null = null;
  let pieces: Piece[] = [];
  instance.bind(() => {
    // a record with no prototype: an input named `__proto__` is an input (Phase 6.1, H2)
    const inputs: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const attribute of node.attributes) inputs[attribute.name] = attribute.value;
    for (const binding of node.properties) inputs[binding.name] = evaluate(binding.value, scope);
    if (child !== null) {
      child.setInputs(inputs);
      return;
    }
    untracked(() => {
      const made = new Instance(ir, instance.document, inputs, instance.linker, slots, listeners);
      child = made;
      pieces = made.root.run(() => {
        made.startEffects((steps, effectLocals) => runSteps(steps, made, effectLocals, undefined));
        return renderNodes(ir.view, made, NO_LOCALS, where);
      })!;
    });
  });
  return { nodes: () => nodesOf(pieces) };
}

/** Whether `nodes` are THERE: an element, a text or a component always is; a conditional, an iteration or a projection when what it shows is. */
function there(nodes: readonly ObixIrNode[], instance: Instance, locals: Locals): boolean {
  const scope = instance.scopeWith(locals, undefined);
  for (const node of nodes) {
    switch (node.kind) {
      case 'element':
      case 'text':
      case 'invocation':
        return true;
      case 'conditional': {
        const branch = node.branches.find((b) => evaluate(b.condition, scope));
        const body = branch !== undefined ? branch.body : node.otherwise;
        if (body !== null && there(body, instance, locals)) return true;
        break;
      }
      case 'iteration': {
        const source = evaluate(node.source, scope);
        if (!Array.isArray(source)) break;
        const names = node.index === null ? [node.item] : [node.item, node.index];
        if (source.some((element, position) => there(node.body, instance, withLocals(locals, names, [element, position])))) return true;
        break;
      }
      case 'projection': {
        const provided = instance.slots.get(node.slot);
        if (provided !== undefined && there(provided.content.body, provided.instance, contentLocals(provided, projectionArguments(node, instance, locals)))) return true;
        if (there(node.fallback, instance, locals)) return true;
        break;
      }
    }
  }
  return false;
}

/** The arguments a projection hands its content, each worked out in the projecting component's scope. */
function projectionArguments(node: ObixIrProjection, instance: Instance, locals: Locals): ReadonlyMap<string, () => unknown> {
  const scope = instance.scopeWith(locals, undefined);
  return new Map(node.arguments.map((argument) => [argument.name, () => evaluate(argument.value, scope)]));
}

/** The locals of projected content: where it was written, and its parameters bound to the projection's arguments — one by name, or all of them as an object. */
function contentLocals(provided: Provided, args: ReadonlyMap<string, () => unknown>): Locals {
  const inner = Object.create(provided.locals) as Record<string, () => unknown>;
  for (const parameter of provided.content.parameters) {
    const name = parameter.argument;
    inner[parameter.local] = name === null ? () => Object.fromEntries([...args].map(([key, read]) => [key, read()])) : () => args.get(name)?.();
  }
  return inner;
}

/**
 * A projection: what the invoker put into the slot, rendered in the INVOKER's scope with its parameters bound to the projection's arguments — or, when the invoker put nothing
 * there or only what is not there, the fallback, in this component's scope. Which of the two is shown is a binding; each is rendered in a scope of its own.
 */
function renderProjection(node: ObixIrProjection, instance: Instance, locals: Locals, where: Namespace): Piece {
  const anchor = instance.document.createComment('');
  const region = effectScope();
  const provided = instance.slots.get(node.slot);
  const scope = instance.scopeWith(locals, undefined);
  const args = new Map<string, () => unknown>();
  for (const argument of node.arguments) {
    const value: ComputedRef<unknown> = computed(() => evaluate(argument.value, scope));
    args.set(argument.name, () => value.value);
  }
  const inner = provided === undefined ? null : contentLocals(provided, args);
  let showing: boolean | null = null;
  let shown: Shown | null = null;
  instance.bind(() => {
    const content = provided !== undefined && inner !== null && there(provided.content.body, provided.instance, inner);
    if (content === showing) return;
    showing = content;
    if (shown !== null) takeOut(shown);
    shown = content ? renderBody(region, provided!.content.body, provided!.instance, inner!, where) : renderBody(region, node.fallback, instance, locals, where);
    insertBefore(anchor, nodesOf(shown.pieces));
  });
  return { nodes: () => [...(shown === null ? [] : nodesOf(shown.pieces)), anchor] };
}

/** Render `nodes` where `locals` are in scope, in the namespace `where`: the pieces, in order. */
export function renderNodes(nodes: readonly ObixIrNode[], instance: Instance, locals: Locals, where: Namespace): Piece[] {
  const pieces: Piece[] = [];
  for (const node of nodes) {
    switch (node.kind) {
      case 'element':
        pieces.push(renderElement(node, instance, locals, where));
        break;
      case 'text':
        pieces.push(renderText(node, instance, locals));
        break;
      case 'conditional':
        pieces.push(renderConditional(node, instance, locals, where));
        break;
      case 'iteration':
        pieces.push(renderIteration(node, instance, locals, where));
        break;
      case 'invocation':
        pieces.push(renderInvocation(node, instance, locals, where));
        break;
      case 'projection':
        pieces.push(renderProjection(node, instance, locals, where));
        break;
    }
  }
  return pieces;
}
