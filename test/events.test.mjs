/**
 * N4 — events: an element's event binding is a real DOM listener; when the event happens its steps run, in order, each seeing what the ones before it wrote — an `assign` writes a
 * state, an `invoke` runs an action with its parameters bound to the arguments (a missing one is undefined, an extra one ignored) — and the event is the DOM's own event, read
 * by the IR's event payload (`e.detail`, `e.target.value`). What the steps change is shown after the current task, once. A bound `value` or `checked` of a form control is also
 * its live property, so what a user sees follows the state.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { mountComponent } from 'obix-runtime-component';
import { nextTick } from 'obix-runtime-reactivity';
import { assign, attr, binary, bind, component, el, invoke, lit, local, member, on, payload, state, text } from './ir.mjs';

function host() {
  const { window } = new JSDOM('<!doctype html><html><body></body></html>');
  const target = window.document.createElement('div');
  window.document.body.append(target);
  return { window, target };
}
const click = (window, element, detail = 0) => element.dispatchEvent(new window.MouseEvent('click', { bubbles: true, detail }));

const counter = component('Counter', [
  el('section', {},
    el('p', {}, text(state('count'), ' / ', state('last'))),
    el('button', { attributes: [attr('type', 'button')], events: [on('click', invoke('increment'))] }, text('+1')),
    el('button', { events: [on('click', invoke('add', lit(5)))] }, text('+5')),
    el('button', { events: [on('click', assign('count', binary('-', state('count'), lit(1))), assign('last', binary('+', lit('dec'), state('count'))))] }, text('-1')),
    el('button', { events: [on('click', invoke('add', member(payload(), 'detail')))] }, text('detail')),
    el('button', { events: [on('click', invoke('twice', lit(2), lit('extra')))] }, text('twice')),
    el('button', { events: [on('click', invoke('add'))] }, text('nothing'))),
], {
  state: { count: lit(0), last: lit('none') },
  actions: {
    increment: { steps: [assign('count', binary('+', state('count'), lit(1)))] },
    add: { parameters: ['n'], steps: [assign('count', binary('+', state('count'), local('n'))), assign('last', binary('+', lit('add '), local('n')))] },
    twice: { parameters: ['n'], steps: [invoke('add', local('n')), invoke('add', local('n'))] },
  },
});

test('a click runs the steps of its handler; what they change is shown after the current task, in the same nodes', async () => {
  const { window, target } = host();
  mountComponent(counter, { target });
  const p = target.querySelector('p');
  const [inc, plus5, dec] = target.querySelectorAll('button');
  click(window, inc);
  assert.equal(p.textContent, '0 / none', 'nothing is shown synchronously');
  await nextTick();
  assert.equal(p.textContent, '1 / none');
  click(window, plus5);
  await nextTick();
  assert.equal(p.textContent, '6 / add 5');
  click(window, dec);
  await nextTick();
  assert.equal(p.textContent, '5 / dec5', 'the second step saw what the first wrote');
  assert.equal(target.querySelector('p'), p);
});

test('an action is run with its parameters bound to the arguments: a missing one is undefined, an extra one ignored; an action may invoke another', async () => {
  const { window, target } = host();
  mountComponent(counter, { target });
  const buttons = target.querySelectorAll('button');
  click(window, buttons[4]);
  await nextTick();
  assert.equal(target.querySelector('p').textContent, '4 / add 2');
  click(window, buttons[5]);
  await nextTick();
  assert.equal(target.querySelector('p').textContent, 'NaN / add undefined');
});

test('the event payload is the DOM\'s own event', async () => {
  const { window, target } = host();
  mountComponent(counter, { target });
  click(window, target.querySelectorAll('button')[3], 10);
  await nextTick();
  assert.equal(target.querySelector('p').textContent, '10 / add 10');
});

test('the steps of one event are shown in one update: each binding writes once', async () => {
  const { window, target } = host();
  mountComponent(counter, { target });
  const p = target.querySelector('p');
  const records = [];
  const observer = new window.MutationObserver((r) => records.push(...r));
  observer.observe(p, { subtree: true, characterData: true, childList: true });
  click(window, target.querySelectorAll('button')[4]);
  await nextTick();
  await Promise.resolve();
  observer.disconnect();
  assert.equal(records.length, 1, 'four assigns, one write');
});

test('input: the value a user typed is read from the event, and a bound value follows the state — as the attribute and as what the field shows', async () => {
  const { window, target } = host();
  const ir = component('Field', [
    el('input', { attributes: [attr('type', 'text')], properties: [bind('value', state('text'))], events: [on('input', assign('text', member(member(payload(), 'target'), 'value')))] }),
    el('button', { events: [on('click', assign('text', lit('')))] }, text('clear')),
    el('p', {}, text(state('text'))),
  ], { state: { text: lit('start') } });
  mountComponent(ir, { target });
  const input = target.querySelector('input');
  assert.equal(input.value, 'start');
  input.value = 'typed';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  await nextTick();
  assert.equal(target.querySelector('p').textContent, 'typed');
  assert.equal(input.getAttribute('value'), 'typed');
  click(window, target.querySelector('button'));
  await nextTick();
  assert.equal(input.getAttribute('value'), '');
  assert.equal(input.value, '', 'what the field shows follows the state, though the user typed in it');
});

test('a bound checked follows the state as the attribute and as the live property', async () => {
  const { window, target } = host();
  const ir = component('Check', [
    el('input', { attributes: [attr('type', 'checkbox')], properties: [bind('checked', state('on'))], events: [on('change', assign('on', member(member(payload(), 'target'), 'checked')))] }),
    el('button', { events: [on('click', assign('on', lit(true)))] }, text('on')),
  ], { state: { on: lit(false) } });
  mountComponent(ir, { target });
  const box = target.querySelector('input');
  assert.equal(box.checked, false);
  box.click();
  await nextTick();
  assert.equal(box.checked, true);
  assert.equal(box.hasAttribute('checked'), true);
  box.click();
  await nextTick();
  assert.equal(box.checked, false);
  assert.equal(box.hasAttribute('checked'), false);
  click(window, target.querySelector('button'));
  await nextTick();
  assert.equal(box.checked, true);
});

test('unmount takes every listener away', () => {
  const { window, target } = host();
  const counts = new Map();
  const add = window.EventTarget.prototype.addEventListener;
  const remove = window.EventTarget.prototype.removeEventListener;
  window.EventTarget.prototype.addEventListener = function (type, ...rest) { counts.set(type, (counts.get(type) ?? 0) + 1); return add.call(this, type, ...rest); };
  window.EventTarget.prototype.removeEventListener = function (type, ...rest) { counts.set(type, (counts.get(type) ?? 0) - 1); return remove.call(this, type, ...rest); };
  const mounted = mountComponent(counter, { target });
  assert.equal(counts.get('click'), 6);
  mounted.unmount();
  assert.equal(counts.get('click'), 0);
});

test('the DOM delivers the events: a click inside an element that also listens to click runs both handlers, the inner first, as the page bubbles it', async () => {
  // what the canonical IR's evaluator does not model (react-frontend.md §12.2, native-runtime.md §7): it runs the handler of the element an event is dispatched to, alone.
  // The native runtime attaches listeners and lets the DOM deliver — as Vue's DOM runtime and React do in a browser.
  const { window, target } = host();
  const ir = component('Nested', [
    el('div', { events: [on('click', assign('log', binary('+', state('log'), lit('outer '))))] },
      el('button', { events: [on('click', assign('log', binary('+', state('log'), lit('inner '))))] }, text('go'))),
    el('p', {}, text(state('log'))),
  ], { state: { log: lit('') } });
  mountComponent(ir, { target });
  click(window, target.querySelector('button'));
  await nextTick();
  assert.equal(target.querySelector('p').textContent, 'inner outer ');
});
