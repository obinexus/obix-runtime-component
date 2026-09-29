/**
 * N5 — conditionals: a conditional shows the body of the FIRST branch whose condition is truthy, else `otherwise`, else nothing. When the choice changes, the body shown is taken
 * out — its nodes, bindings and listeners — and the new one put in its place; when it does not, nothing is rebuilt: the same nodes, so what a user is typing keeps its focus.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { mountComponent } from 'obix-runtime-component';
import { nextTick } from 'obix-runtime-reactivity';
import { assign, binary, branch, component, conditional, el, lit, on, prop, state, text } from './ir.mjs';

function host() {
  const { window } = new JSDOM('<!doctype html><html><body></body></html>');
  const target = window.document.createElement('div');
  window.document.body.append(target);
  return { window, target };
}
/** What the page shows, comments (the runtime's anchors) left out. */
const html = (target) => target.innerHTML.replace(/<!--[^]*?-->/g, '');

const grade = component('Grade', [
  el('p', {}, text('before')),
  conditional([
    branch(binary('>=', prop('n'), lit(90)), el('b', {}, text('A')), text(' top')),
    branch(binary('>=', prop('n'), lit(50)), el('i', {}, text('pass'))),
  ], [el('u', {}, text('fail'))]),
  el('p', {}, text('after')),
], { props: [{ name: 'n' }] });

test('the first branch whose condition is truthy is shown, in its place among the other nodes', () => {
  const { target } = host();
  for (const [n, shown] of [[95, '<b>A</b> top'], [70, '<i>pass</i>'], [10, '<u>fail</u>']]) {
    const t = host().target;
    mountComponent(grade, { target: t, props: { n } });
    assert.equal(html(t), `<p>before</p>${shown}<p>after</p>`, `n = ${n}`);
  }
  mountComponent(component('None', [conditional([branch(prop('on'), text('on'))])], { props: [{ name: 'on' }] }), { target, props: { on: false } });
  assert.equal(html(target), '', 'no branch and no otherwise: nothing');
});

test('when the choice changes the shown body is replaced in place; when it does not, the same nodes stay', () => {
  const { target } = host();
  const mounted = mountComponent(grade, { target, props: { n: 95 } });
  const b = target.querySelector('b');
  mounted.setProps({ n: 99 });
  mounted.flush();
  assert.equal(target.querySelector('b'), b, 'the same branch: the same node');
  mounted.setProps({ n: 60 });
  mounted.flush();
  assert.equal(html(target), '<p>before</p><i>pass</i><p>after</p>');
  mounted.setProps({ n: 0 });
  mounted.flush();
  assert.equal(html(target), '<p>before</p><u>fail</u><p>after</p>');
  mounted.setProps({ n: 95 });
  mounted.flush();
  assert.equal(html(target), '<p>before</p><b>A</b> top<p>after</p>');
  assert.notEqual(target.querySelector('b'), b, 'a branch shown again is made again');
});

test('a body taken out takes its bindings and listeners with it', async () => {
  const { window, target } = host();
  let listeners = 0;
  const add = window.EventTarget.prototype.addEventListener;
  const remove = window.EventTarget.prototype.removeEventListener;
  // the page's elements only: jsdom adds listeners of its own to the window when an element is clicked
  window.EventTarget.prototype.addEventListener = function (...args) { if (this.nodeType === 1) listeners++; return add.apply(this, args); };
  window.EventTarget.prototype.removeEventListener = function (...args) { if (this.nodeType === 1) listeners--; return remove.apply(this, args); };
  const ir = component('Toggle', [
    conditional([branch(state('open'), el('button', { events: [on('click', assign('open', lit(false)))] }, text('close ', state('count'))))],
      [el('button', { events: [on('click', assign('open', lit(true)))] }, text('open'))]),
    el('button', { events: [on('click', assign('count', binary('+', state('count'), lit(1))))] }, text('+')),
  ], { state: { open: lit(false), count: lit(0) } });
  mountComponent(ir, { target });
  assert.equal(listeners, 2);
  const [open, plus] = target.querySelectorAll('button');
  open.click();
  await nextTick();
  assert.equal(html(target), '<button>close 0</button><button>+</button>');
  assert.equal(listeners, 2, 'the open button\'s listener went with it');
  const close = target.querySelector('button');
  close.click();
  await nextTick();
  plus.click();
  await nextTick();
  assert.equal(html(target), '<button>open</button><button>+</button>');
  assert.equal(close.textContent, 'close 0', 'the binding of a body taken out writes no more');
});

test('the conditions are read in order and no further than the first truthy one', () => {
  const { target } = host();
  let reads = 0;
  const counted = { get v() { reads++; return true; } };
  const ir = component('Lazy', [conditional([branch(prop('first'), text('first')), branch({ kind: 'member', object: prop('box'), property: 'v' }, text('second'))])], { props: [{ name: 'first' }, { name: 'box' }] });
  mountComponent(ir, { target, props: { first: true, box: counted } });
  assert.equal(reads, 0);
});

test('a text field inside a body that stays keeps its focus while what is around it changes', async () => {
  const { window, target } = host();
  const ir = component('Form', [
    conditional([branch(state('editing'), el('input', { events: [on('input', assign('draft', { kind: 'member', object: { kind: 'member', object: { kind: 'event-payload' }, property: 'target' }, property: 'value' }))] }))]),
    el('p', {}, text(state('draft'))),
  ], { state: { editing: lit(true), draft: lit('') } });
  mountComponent(ir, { target });
  const input = target.querySelector('input');
  input.focus();
  input.value = 'abc';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  await nextTick();
  assert.equal(target.querySelector('p').textContent, 'abc');
  assert.equal(window.document.activeElement, input);
  assert.equal(target.querySelector('input'), input);
});
