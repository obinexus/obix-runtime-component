/**
 * Running steps — what an event handler, an action, an interaction and an effect do. Steps run in order, and each sees what the ones before it wrote:
 *
 *   assign   write the value of the expression into the state named
 *   invoke   run the steps of the action named, its parameters bound, in order, to the values of the arguments (a missing argument is `undefined`, an extra one is ignored);
 *            inside an action there is no event payload
 *   output   tell the invoker, on the channel, the value (`undefined` when the output tells nothing): its interaction for the channel runs now, in the invoker, before
 *            the next step; with no listener, nothing
 *
 * Steps read without depending (they are not a binding) and run in one batch: what they change is shown in one update.
 */
import { batch, untracked } from 'obix-runtime-reactivity';
import { evaluate } from './evaluate.js';
import { NO_LOCALS, withLocals } from './instance.js';
import type { Instance, Locals } from './instance.js';
import type { ObixIrStep } from './ir.js';

function run(steps: readonly ObixIrStep[], instance: Instance, locals: Locals, event: unknown): void {
  const scope = instance.scopeWith(locals, event);
  for (const step of steps) {
    switch (step.kind) {
      case 'assign':
        instance.assign(step.target, evaluate(step.value, scope));
        break;
      case 'invoke': {
        const action = instance.action(step.action);
        const args = step.arguments.map((argument) => evaluate(argument, scope));
        run(action.steps, instance, withLocals(NO_LOCALS, action.parameters, args), undefined);
        break;
      }
      case 'output': {
        const value = step.value === null ? undefined : evaluate(step.value, scope);
        instance.listeners.get(step.channel)?.(value);
        break;
      }
    }
  }
}

/** Run `steps` of `instance`, where `locals` are in scope, with `event` as the event payload. */
export function runSteps(steps: readonly ObixIrStep[], instance: Instance, locals: Locals, event: unknown): void {
  untracked(() => batch(() => run(steps, instance, locals, event)));
}
