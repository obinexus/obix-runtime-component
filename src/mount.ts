/**
 * Mounting a component of canonical IR on the DOM: the IR is read first (read.ts) — nothing is made of a component the runtime cannot run — and then built, node by node, by
 * the document of the target: the runtime reads no global. What it builds goes before `anchor` in `target` (at the end when there is none), among what the target already
 * holds, and `unmount` takes out exactly that.
 *
 * What the view shows of a value is BOUND (instance.ts): a text that shows values is one text node whose data is written again when they change; an attribute that is bound is
 * written again, by the attribute rules, when its value changes. Nothing is rebuilt: the elements and the text nodes are the ones the first render made.
 */
import { ObixRuntimeError, flushJobs } from 'obix-runtime-reactivity';
import { namespaceInside } from 'obix-runtime-dom';
import { Instance, NO_LOCALS } from './instance.js';
import type { Listener } from './instance.js';
import { Linker } from './link.js';
import type { Registry } from './link.js';
import { nodesOf, renderNodes } from './render.js';
import { runSteps } from './steps.js';
import type { Piece } from './render.js';
import type { ObixIrComponent } from './ir.js';

export interface MountOptions {
  /** the element the component is put in */
  readonly target: Element;
  /** the node of `target` it is put before; at the end when null or absent */
  readonly anchor?: Node | null;
  /** the inputs of the component (its props) */
  readonly props?: Readonly<Record<string, unknown>>;
  /** the components it invokes, by the module specifier its source wrote: a component (its default export), or a record of components by export name */
  readonly registry?: Registry;
  /** the page's handlers of the component's outputs, by channel: what the component tells there is told to them, synchronously */
  readonly interactions?: Readonly<Record<string, unknown>>;
}

export interface MountedComponent {
  /** the DOM nodes the component shows now, in order, at the top level */
  nodes(): Node[];
  /** give the component new inputs; the page shows them after the current task, or at `flush` */
  setProps(props: Readonly<Record<string, unknown>>): void;
  /** write every pending update now */
  flush(): void;
  /** take the component out of the page; a second time is nothing */
  unmount(): void;
}

/** The page's handlers of a root's outputs, by channel — refused (`OBIX_RUNTIME_LINK`) on a channel the root does not declare, or when one is not a function. */
export function pageListeners(ir: ObixIrComponent, interactions: Readonly<Record<string, unknown>>): Map<string, Listener> {
  const listeners = new Map<string, Listener>();
  const outputs = new Set(ir.outputs.map((o) => o.channel));
  for (const [channel, handler] of Object.entries(interactions)) {
    if (!outputs.has(channel)) throw new ObixRuntimeError('OBIX_RUNTIME_LINK', `the page listens to ${ir.name} on ${channel}, which ${ir.name} does not declare as an output`);
    if (typeof handler !== 'function') throw new ObixRuntimeError('OBIX_RUNTIME_LINK', `the page's handler of ${ir.name} on ${channel} is not a function`);
    listeners.set(channel, handler as Listener);
  }
  return listeners;
}

/** Mount `ir` in `target`, before `anchor`. */
export function mountComponent(value: unknown, options: MountOptions): MountedComponent {
  const linker = new Linker(options.registry ?? {});
  const ir = linker.link(value);
  const { target } = options;
  const anchor = options.anchor ?? null;
  const document = target.ownerDocument;
  const instance = new Instance(ir, document, options.props ?? {}, linker, new Map(), pageListeners(ir, options.interactions ?? {}));
  let pieces: Piece[];
  try {
    pieces = instance.root.run(() => {
      instance.startEffects((steps, locals) => runSteps(steps, instance, locals, undefined));
      // in the namespace of what the target holds: a component mounted in an svg draws SVG
      return renderNodes(ir.view, instance, NO_LOCALS, namespaceInside(target));
    })!;
  } catch (error) {
    instance.stop();
    throw error;
  }
  const fragment = document.createDocumentFragment();
  fragment.append(...nodesOf(pieces));
  target.insertBefore(fragment, anchor);
  return {
    nodes: () => (instance.active ? nodesOf(pieces) : []),
    setProps: (props) => instance.setInputs(props),
    flush: () => flushJobs(),
    unmount() {
      if (!instance.active) return;
      const nodes = nodesOf(pieces);
      instance.stop();
      for (const node of nodes) node.parentNode?.removeChild(node);
    },
  };
}
