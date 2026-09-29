/**
 * N9 — the IR's effects and batched updates. An effect watches an expression; after a change, when the value is no longer the one seen last (`Object.is`; first seen when the
 * component is mounted) its steps run with its parameters bound to the new value and the previous one — BEFORE the component's view is updated, so the view shows what they
 * changed in the same update. The effects of a component run in the order they are declared, and again while one changes what another watches; ones that never settle are
 * refused. Updates are batched: however many changes a task makes, in however many components, each binding is written once, a component before the ones it invokes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { mountComponent } from 'obix-runtime-component';
import { nextTick } from 'obix-runtime-reactivity';
import { assign, attr, binary, bind, component, derived, el, invocation, lit, local, on, prop, state, text } from './ir.mjs';

function host() {
  const { window } = new JSDOM('<!doctype html><html><body></body></html>');
  const target = window.document.createElement('div');
  window.document.body.append(target);
  return { window, target };
}
const plus = (name, by = 1) => assign(name, binary('+', state(name), lit(by)));
/** Every write to the text and the attributes under `root`, until the next update is done. */
function writes(window, root) {
  const records = [];
  const observer = new window.MutationObserver((r) => records.push(...r));
  observer.observe(root, { subtree: true, characterData: true, attributes: true, childList: true });
  return async () => {
    await nextTick();
    records.push(...observer.takeRecords());
    observer.disconnect();
    return records;
  };
}

test('an effect runs after a change of what it watches, with the new and the previous value, not at the start', async () => {
  const { target } = host();
  const ir = component('Log', [
    el('button', { events: [on('click', plus('count'))] }, text('+')),
    el('p', {}, text(state('log'))),
  ], {
    state: { count: lit(0), log: lit('') },
    effects: [{ watch: state('count'), parameters: ['now', 'was'], steps: [assign('log', binary('+', state('log'), binary('+', binary('+', local('was'), lit('>')), binary('+', local('now'), lit(' ')))))] }],
  });
  mountComponent(ir, { target });
  assert.equal(target.querySelector('p').textContent, '');
  target.querySelector('button').click();
  await nextTick();
  target.querySelector('button').click();
  await nextTick();
  assert.equal(target.querySelector('p').textContent, '0>1 1>2 ');
});

test('what an effect changes is shown in the same update as the change that ran it: the view is written once, with the final values', async () => {
  const { window, target } = host();
  const ir = component('Pre', [
    el('button', { events: [on('click', plus('count'))] }, text('+')),
    el('p', {}, text(state('count'), '/', state('echo'))),
  ], { state: { count: lit(0), echo: lit(0) }, effects: [{ watch: state('count'), parameters: ['v'], steps: [assign('echo', binary('*', local('v'), lit(10)))] }] });
  mountComponent(ir, { target });
  const done = writes(window, target.querySelector('p'));
  target.querySelector('button').click();
  const records = await done();
  assert.equal(target.querySelector('p').textContent, '1/10');
  assert.equal(records.length, 1, 'one write: 1/10, never 1/0');
});

test('effects run in the order they are declared, and again while one changes what another watches', async () => {
  const { target } = host();
  const ir = component('Chain', [el('button', { events: [on('click', assign('a', lit(1)))] }, text('go')), el('p', {}, text(state('log')))], {
    state: { a: lit(0), b: lit(0), c: lit(0), log: lit('') },
    effects: [
      { watch: state('c'), parameters: ['v'], steps: [assign('log', binary('+', state('log'), binary('+', lit('c'), local('v'))))] },
      { watch: state('a'), parameters: ['v'], steps: [assign('log', binary('+', state('log'), binary('+', lit('a'), local('v')))), assign('b', local('v'))] },
      { watch: state('b'), parameters: ['v'], steps: [assign('log', binary('+', state('log'), binary('+', lit('b'), local('v')))), assign('c', local('v'))] },
    ],
  });
  mountComponent(ir, { target });
  target.querySelector('button').click();
  await nextTick();
  assert.equal(target.querySelector('p').textContent, 'a1b1c1');
});

test('an effect can watch a derived value and a prop; the value it watches going back before the update is no change', async () => {
  const { target } = host();
  const ir = component('Watch', [el('p', {}, text(state('runs')))], {
    props: [{ name: 'n' }],
    state: { runs: lit(0) },
    derived: { parity: binary('%', prop('n'), lit(2)) },
    effects: [{ watch: derived('parity'), parameters: [], steps: [plus('runs')] }],
  });
  const mounted = mountComponent(ir, { target, props: { n: 1 } });
  mounted.setProps({ n: 3 });
  mounted.flush();
  assert.equal(target.textContent, '0', 'the parity did not change');
  mounted.setProps({ n: 4 });
  mounted.setProps({ n: 5 });
  mounted.flush();
  assert.equal(target.textContent, '0', 'it changed and changed back before the update');
  mounted.setProps({ n: 6 });
  mounted.flush();
  assert.equal(target.textContent, '1');
});

test('effects that never settle are refused', async () => {
  const { target } = host();
  const ir = component('Loop', [el('button', { events: [on('click', plus('n'))] }, text('go'))], {
    state: { n: lit(0) }, effects: [{ watch: state('n'), parameters: [], steps: [plus('n')] }],
  });
  mountComponent(ir, { target });
  target.querySelector('button').click();
  await assert.rejects(nextTick(), (error) => error.code === 'OBIX_RUNTIME_UPDATES');
});

test('an invoked component\'s effects see the inputs its invoker just gave, and run before it is shown', async () => {
  const { window, target } = host();
  const Child = component('Child', [el('i', {}, text(prop('v'), ':', state('seen')))], {
    props: [{ name: 'v' }], state: { seen: lit('none') }, effects: [{ watch: prop('v'), parameters: ['x'], steps: [assign('seen', local('x'))] }],
  });
  const Main = component('Main', [el('button', { events: [on('click', plus('n'))] }, text('+')), invocation('Child', { properties: [bind('v', state('n'))] })], {
    state: { n: lit(0) }, dependencies: { Child: './Child.vue' },
  });
  mountComponent(Main, { target, registry: { './Child.vue': Child } });
  const done = writes(window, target.querySelector('i'));
  target.querySelector('button').click();
  const records = await done();
  assert.equal(target.querySelector('i').textContent, '1:1');
  assert.equal(records.length, 1);
});

test('batched: many changes in one task, in several components, write each binding once — the invoker before the invoked', async () => {
  const { window, target } = host();
  const order = [];
  const Child = component('Child', [el('b', { properties: [bind('data-v', prop('v'))] }, text(prop('v')))], { props: [{ name: 'v' }] });
  const Main = component('Main', [
    el('button', { attributes: [attr('type', 'button')], events: [on('click', plus('n'), plus('n'), plus('n'))] }, text('+3')),
    el('p', {}, text(state('n'))),
    invocation('Child', { properties: [bind('v', state('n'))] }),
  ], { state: { n: lit(0) }, dependencies: { Child: './Child.vue' } });
  mountComponent(Main, { target, registry: { './Child.vue': Child } });
  const observer = new window.MutationObserver((records) => {
    for (const r of records) order.push(r.target.nodeType === 3 ? r.target.parentNode.localName : r.target.localName);
  });
  observer.observe(target, { subtree: true, characterData: true, attributes: true });
  const button = target.querySelector('button');
  button.click();
  button.click();
  await nextTick();
  await Promise.resolve();
  observer.disconnect();
  assert.equal(target.querySelector('p').textContent, '6');
  assert.equal(target.querySelector('b').textContent, '6');
  assert.deepEqual(order, ['p', 'b', 'b'], 'the invoker\'s text, then the invoked component\'s attribute and text — once each for six changes');
});
