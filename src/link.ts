/**
 * Linking the components of an application before any of them is rendered. A component invokes another by a DEPENDENCY — the module specifier and export its source wrote
 * (`./Tally.vue`, `default`) — and the application's REGISTRY says what each specifier is: a component (its default export) or a module record whose members are components
 * (`{ Tally }` for a named export). Every component reachable from the root is read (read.ts), every dependency an invocation names is resolved, and every invocation is held
 * to the component it invokes: an input it does not declare, or an interaction on an output it does not declare, is refused (`OBIX_RUNTIME_LINK`) — so nothing is found wrong
 * half way through a page.
 */
import { ObixRuntimeError } from 'obix-runtime-reactivity';
import { readComponent } from './read.js';
import type { ObixIrComponent, ObixIrInvocation, ObixIrNode } from './ir.js';

/** Specifier → a component, or a module record of components by export name. */
export type Registry = Readonly<Record<string, unknown>>;

const linkError = (message: string): ObixRuntimeError => new ObixRuntimeError('OBIX_RUNTIME_LINK', message);

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Every invocation of a view, wherever it is — in bodies, branches, fallbacks and projected content. */
function invocations(nodes: readonly ObixIrNode[], out: ObixIrInvocation[] = []): ObixIrInvocation[] {
  for (const node of nodes) {
    switch (node.kind) {
      case 'element':
        invocations(node.children, out);
        break;
      case 'conditional':
        for (const branch of node.branches) invocations(branch.body, out);
        if (node.otherwise !== null) invocations(node.otherwise, out);
        break;
      case 'iteration':
        invocations(node.body, out);
        break;
      case 'invocation':
        out.push(node);
        for (const content of node.children) invocations(content.body, out);
        break;
      case 'projection':
        invocations(node.fallback, out);
        break;
      case 'text':
        break;
    }
  }
  return out;
}

export class Linker {
  readonly #registry: Registry;
  /** what each read component's invocations resolve to, by the local name of the dependency */
  readonly #resolved = new Map<ObixIrComponent, Map<string, ObixIrComponent>>();
  /** what each registry entry reads as, so a component registered once is one component */
  readonly #read = new Map<unknown, ObixIrComponent>();

  constructor(registry: Registry) {
    this.#registry = registry;
  }

  #readEntry(entry: unknown): ObixIrComponent {
    let ir = this.#read.get(entry);
    if (ir === undefined) {
      ir = readComponent(entry);
      this.#read.set(entry, ir);
    }
    return ir;
  }

  /** Link `root` and everything it reaches; the root, read. */
  link(value: unknown): ObixIrComponent {
    const root = this.#readEntry(value);
    const pending = [root];
    while (pending.length > 0) {
      const ir = pending.pop()!;
      if (this.#resolved.has(ir)) continue;
      const resolved = new Map<string, ObixIrComponent>();
      this.#resolved.set(ir, resolved);
      for (const invocation of invocations(ir.view)) {
        let child = resolved.get(invocation.component);
        if (child === undefined) {
          const dependency = ir.dependencies.find((d) => d.local === invocation.component)!;
          const entry = this.#registry[dependency.specifier];
          if (entry === undefined) throw linkError(`${ir.name} invokes ${invocation.component} from ${dependency.specifier}, and no component is registered for ${dependency.specifier}`);
          const exported = isRecord(entry) && entry['kind'] === 'component' && dependency.export === 'default' ? entry : isRecord(entry) && entry['kind'] !== 'component' ? entry[dependency.export] : undefined;
          if (exported === undefined) throw linkError(`${ir.name} invokes the export ${dependency.export} of ${dependency.specifier}, which the registry does not have`);
          child = this.#readEntry(exported);
          resolved.set(invocation.component, child);
          pending.push(child);
        }
        const declared = new Set(child.props.map((p) => p.name));
        for (const input of [...invocation.attributes, ...invocation.properties]) {
          if (!declared.has(input.name)) throw linkError(`${ir.name} gives ${child.name} the input ${input.name}, which ${child.name} does not declare`);
        }
        const outputs = new Set(child.outputs.map((o) => o.channel));
        for (const interaction of invocation.interactions) {
          if (!outputs.has(interaction.channel)) throw linkError(`${ir.name} listens to ${child.name} on ${interaction.channel}, which ${child.name} does not declare as an output`);
        }
      }
    }
    return root;
  }

  /** The component `ir` invokes by the local name `component` (linked). */
  resolve(ir: ObixIrComponent, component: string): ObixIrComponent {
    return this.#resolved.get(ir)!.get(component)!;
  }
}
