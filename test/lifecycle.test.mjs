/**
 * N10 — lifecycle and unmount: a component taken out of the page leaves nothing behind — its nodes, its listeners, its bindings, its effects, the components it invokes and the
 * content projected into them, all gone, and nothing it queued runs. A component that fails while it is first rendered leaves the page as it was and nothing running. An
 * update that throws does not keep the others from being written, and is not silent. The page may take a component down from inside one of its own events.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { mountComponent } from 'obix-runtime-component';
import { hasPendingJobs, liveEffects, nextTick } from 'obix-runtime-reactivity';
import { assign, attr, binary, bind, branch, component, conditional, content, el, interaction, invocation, iteration, lit, local, member, on, output, projection, prop, state, text } from './ir.mjs';

function host() {
  const { window } = new JSDOM('<!doctype html><html><body></body></html>');
  const target = window.document.createElement('div');
  window.document.body.append(target);
  let listeners = 0;
  const add = window.EventTarget.prototype.addEventListener;
  const remove = window.EventTarget.prototype.removeEventListener;
  window.EventTarget.prototype.addEventListener = function (...args) { if (this.nodeType === 1) listeners++; return add.apply(this, args); };
  window.EventTarget.prototype.removeEventListener = function (...args) { if (this.nodeType === 1) listeners--; return remove.apply(this, args); };
  return { window, target, listeners: () => listeners };
}
const plus = (name) => assign(name, binary('+', state(name), lit(1)));

const Row = component('Row', [
  el('li', { events: [on('click', plus('clicks'), output('picked', prop('label')))] }, text(prop('label'), ' ', state('clicks')), projection('default', [text('!')])),
], { props: [{ name: 'label' }], state: { clicks: lit(0) }, outputs: [{ channel: 'picked', payload: 'string' }], effects: [{ watch: state('clicks'), parameters: [], steps: [] }] });

/** Everything at once: a conditional, an iteration of invoked components with projected content and interactions, effects, events and bindings. */
const App = component('App', [
  el('button', { attributes: [attr('type', 'button')], events: [on('click', assign('open', { kind: 'unary', operator: '!', operand: state('open') }))] }, text('toggle')),
  conditional([branch(state('open'), el('ul', {}, iteration(state('names'), 'n', [
    invocation('Row', { properties: [bind('label', local('n'))], children: [content('default', [el('em', {}, text(state('last')))])], interactions: [interaction('picked', assign('last', { kind: 'event-payload' }))] }),
  ], { key: local('n') })))]),
  el('p', { properties: [bind('title', state('last'))] }, text(state('last'))),
], {
  state: { open: lit(true), names: { kind: 'array', elements: [lit('a'), lit('b'), lit('c')] }, last: lit('none') },
  effects: [{ watch: state('last'), parameters: [], steps: [] }],
  dependencies: { Row: './Row.vue' },
});
const registry = { './Row.vue': Row };

test('unmount leaves nothing behind: nodes, listeners, bindings, effects, invoked components and projected content — and nothing it queued runs', async () => {
  const { target, listeners } = host();
  const before = liveEffects();
  target.innerHTML = '<noscript>kept</noscript>';
  const mounted = mountComponent(App, { target, registry });
  assert.ok(liveEffects() > before);
  assert.equal(listeners(), 4);
  target.querySelectorAll('li')[1].click();
  mounted.unmount();
  assert.equal(target.innerHTML, '<noscript>kept</noscript>');
  assert.equal(listeners(), 0);
  assert.equal(liveEffects(), before, 'every effect and watch stopped');
  await nextTick();
  assert.equal(hasPendingJobs(), false);
  assert.deepEqual(mounted.nodes(), []);
});

test('a part of the view that goes away takes its components with it; showing it again makes them again', async () => {
  const { target, listeners } = host();
  const before = liveEffects();
  mountComponent(App, { target, registry });
  const open = liveEffects();
  target.querySelector('button').click();
  await nextTick();
  assert.equal(listeners(), 1);
  const closed = liveEffects();
  assert.ok(closed < open && closed > before, 'the rows, their effects and their projected content stopped; the rest runs');
  target.querySelector('button').click();
  await nextTick();
  assert.equal(liveEffects(), open);
  assert.equal(listeners(), 4);
});

test('a component that fails while it is first rendered leaves the page as it was and nothing running', () => {
  const { target, listeners } = host();
  const before = liveEffects();
  const Broken = component('Broken', [
    el('button', { events: [on('click', plus('n'))] }, text('ok')),
    iteration(state('names'), 'n', [el('i', {}, text(local('n')))], { key: local('n') }),
    el('p', {}, text(member(member(prop('nothing'), 'deep'), 'deeper'))),
  ], { props: [{ name: 'nothing' }], state: { n: lit(0), names: { kind: 'array', elements: [lit('x')] } } });
  target.innerHTML = '<noscript>kept</noscript>';
  assert.throws(() => mountComponent(Broken, { target }), TypeError);
  assert.equal(target.innerHTML, '<noscript>kept</noscript>');
  assert.equal(liveEffects(), before);
  assert.equal(listeners(), 0);
});

test('an update that throws does not keep the others from being written, and is not silent', async () => {
  const { target } = host();
  const ir = component('Partial', [
    el('button', { events: [on('click', assign('box', lit(null)), assign('n', lit(1)))] }, text('break')),
    el('p', {}, text(member(state('box'), 'value'))),
    el('b', {}, text(state('n'))),
  ], { state: { box: { kind: 'object', entries: [{ key: 'value', value: lit('v') }] }, n: lit(0) } });
  mountComponent(ir, { target });
  target.querySelector('button').click();
  await assert.rejects(nextTick(), TypeError);
  assert.equal(target.querySelector('b').textContent, '1', 'the binding after the failing one was written');
  assert.equal(target.querySelector('p').textContent, 'v', 'the failing binding kept what it showed');
});

test('the page may take the application down from inside one of its events', async () => {
  const { target, listeners } = host();
  const before = liveEffects();
  let mounted;
  const Quit = component('Quit', [el('button', { events: [on('click', output('quit'), plus('after'))] }, text(state('after')))], { state: { after: lit(0) }, outputs: [{ channel: 'quit', payload: null }] });
  mounted = mountComponent(Quit, { target, interactions: { quit: () => mounted.unmount() } });
  target.querySelector('button').click();
  await nextTick();
  assert.equal(target.innerHTML, '');
  assert.equal(listeners(), 0);
  assert.equal(liveEffects(), before);
});
