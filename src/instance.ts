/**
 * A running component: its props and its state as refs, its derived values as computed values (OBIX's own, obix-runtime-reactivity), and every binding of its view
 * as an effect whose updates go through the ordered queue — by component (a component made earlier, a parent, first), then by phase, then by the order the bindings were made.
 * Everything the component makes belongs to its effect scope (or to a scope inside it); stopping the instance stops that scope — every binding, every listener — and an update that
 * was queued for it does nothing.
 */
import { EffectHandle, batch, computed, effect, effectScope, queueJob, ref, watch } from 'obix-runtime-reactivity';
import type { ComputedRef, EffectScope, Ref } from 'obix-runtime-reactivity';
import { evaluate } from './evaluate.js';
import type { Scope } from './evaluate.js';
import { CONSTANT_SCOPE, checkInputs, propValue } from './props.js';
import type { Linker } from './link.js';
import type { ObixIrAction, ObixIrComponent, ObixIrEffect, ObixIrProjectionContent } from './ir.js';

/** The phases of a component's updates within one flush: its effects, then its view. */
export const PHASE_EFFECTS = 0;
export const PHASE_RENDER = 1;

/** The locals in scope where an expression is written — an action's parameters, later an iteration's item and index — each read through a function, so it can be bound. */
export type Locals = Readonly<Record<string, () => unknown>>;
export const NO_LOCALS: Locals = Object.freeze(Object.create(null) as Record<string, () => unknown>);

/** `locals` and, on top of them, `names` with the values given. */
export function withLocals(locals: Locals, names: readonly string[], values: readonly unknown[]): Locals {
  const out = Object.create(locals) as Record<string, () => unknown>;
  names.forEach((name, i) => {
    const value = values[i];
    out[name] = () => value;
  });
  return out;
}

/** What the invoker does when the component tells it something on a channel (an `output` step): run its interaction — or, for a root, the host's handler. */
export type Listener = (value: unknown) => void;

/** What an invoker put into a slot: the content, and where it was written — the invoker and the locals in scope there. */
export interface Provided {
  readonly content: ObixIrProjectionContent;
  readonly instance: Instance;
  readonly locals: Locals;
}

let nextUid = 0;

export class Instance {
  readonly uid = nextUid++;
  readonly ir: ObixIrComponent;
  readonly document: Document;
  /** how the components this one invokes are found */
  readonly linker: Linker;
  /** what the invoker put into each slot */
  readonly slots: ReadonlyMap<string, Provided>;
  /** who listens to each of its outputs */
  readonly listeners: ReadonlyMap<string, Listener>;
  readonly #props = new Map<string, Ref<unknown>>();
  readonly #state = new Map<string, Ref<unknown>>();
  readonly #derived = new Map<string, ComputedRef<unknown>>();
  readonly #actions: Map<string, ObixIrAction>;
  /** what the component makes belongs here: inside the scope running when the component is made (an invoker's), or alone for a root */
  readonly root: EffectScope = effectScope();
  #sequence = 0;
  /** the scope the component's own expressions read: its props, state and derived values */
  readonly scope: Scope;

  constructor(
    ir: ObixIrComponent,
    document: Document,
    inputs: Readonly<Record<string, unknown>>,
    linker: Linker,
    slots: ReadonlyMap<string, Provided> = new Map(),
    listeners: ReadonlyMap<string, Listener> = new Map(),
  ) {
    this.ir = ir;
    this.document = document;
    this.linker = linker;
    this.slots = slots;
    this.listeners = listeners;
    checkInputs(ir, inputs);
    for (const prop of ir.props) this.#props.set(prop.name, ref(propValue(prop, inputs)));
    for (const state of ir.state) this.#state.set(state.name, ref(evaluate(state.initial, CONSTANT_SCOPE)));
    this.#actions = new Map(ir.actions.map((action) => [action.name, action]));
    this.scope = this.scopeWith(NO_LOCALS, undefined);
    // a derived value reads props, state and other derived values — never a local or the event payload — so it is worked out in the component's own scope
    for (const derived of ir.derived) this.#derived.set(derived.name, computed(() => evaluate(derived.expression, this.scope)));
  }

  /** The scope of an expression written where `locals` are in scope, with `event` as the event payload. */
  scopeWith(locals: Locals, event: unknown): Scope {
    const props = this.#props;
    const state = this.#state;
    const derived = this.#derived;
    return {
      prop: (name) => props.get(name)!.value,
      state: (name) => state.get(name)!.value,
      derived: (name) => derived.get(name)!.value,
      local: (name) => locals[name]!(),
      event,
    };
  }

  get active(): boolean {
    return this.root.active;
  }

  /** Write a state. */
  assign(name: string, value: unknown): void {
    this.#state.get(name)!.value = value;
  }

  /** An action of the component (readComponent has made sure it is declared). */
  action(name: string): ObixIrAction {
    return this.#actions.get(name)!;
  }

  /** Give the component new inputs: an input it does not declare is refused before anything changes. */
  setInputs(inputs: Readonly<Record<string, unknown>>): void {
    checkInputs(this.ir, inputs);
    batch(() => {
      for (const prop of this.ir.props) this.#props.get(prop.name)!.value = propValue(prop, inputs);
    });
  }

  /**
   * A binding of the view: `write` runs now — the first render — and again, through the queue, whenever what it read changes. Each binding is one job: however many changes
   * come before a flush, it writes once. It belongs to the scope running when it is made.
   */
  bind(write: () => void): EffectHandle {
    const order = [this.uid, PHASE_RENDER, this.#sequence++];
    let handle: EffectHandle;
    const job = { order, run: () => handle.run() };
    handle = effect(write, { scheduler: () => queueJob(job) });
    return handle;
  }

  /**
   * Start the component's effects — each a watch of its expression, first seen now, checked in the queue BEFORE the component's view (and after its invoker's, which gives it its
   * inputs), in the order the effects are declared; its steps run with the parameters bound to the new value and the previous one. Called in the component's scope.
   */
  startEffects(run: (steps: ObixIrEffect['steps'], locals: Locals) => void): void {
    this.ir.effects.forEach((irEffect, position) => {
      watch(
        () => evaluate(irEffect.watch, this.scope),
        (value, previous) => run(irEffect.steps, withLocals(NO_LOCALS, irEffect.parameters, [value, previous])),
        { order: [this.uid, PHASE_EFFECTS, position] },
      );
    });
  }

  /** Stop the component: every binding, listener and part of its view. */
  stop(): void {
    this.root.stop();
  }
}
