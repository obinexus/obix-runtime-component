/**
 * N6 — keyed iteration: an iteration shows its body once for each element of an ARRAY, in order, with the item (and the index, when there is one) in scope. The KEY says which
 * element is which: when the array changes, the body of an element whose key is still there is kept — the same DOM nodes, its bindings following the new item and index — moved
 * with as few DOM moves as the new order allows, and a moved field keeps its focus; the body of a key that is gone is taken out; a new key gets a new body. With no key, the
 * position is the key. Two elements with one key are refused, and so is a source that is not an array.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { mountComponent } from 'obix-runtime-component';
import { nextTick } from 'obix-runtime-reactivity';
import { assign, attr, binary, bind, branch, component, conditional, el, iteration, lit, local, member, on, prop, state, text } from './ir.mjs';

function host() {
  const { window } = new JSDOM('<!doctype html><html><body></body></html>');
  const target = window.document.createElement('div');
  window.document.body.append(target);
  return { window, target };
}
const html = (target) => target.innerHTML.replace(/<!--[^]*?-->/g, '');
const item = local('item');
const id = member(item, 'id');

/** A list of rows keyed by id: each row shows its index and its label, and has a field. */
const rows = (key = id) => component('Rows', [
  el('ul', {}, iteration(prop('items'), 'item', [el('li', { properties: [bind('data-id', id)] }, text(local('i'), ':', member(item, 'label')), el('input', {}))], { index: 'i', key })),
], { props: [{ name: 'items' }] });
const list = (...ids) => ids.map((n) => ({ id: n, label: `L${n}` }));

test('the body is shown once for each element, in order, with the item and the index in scope; an empty array shows nothing', () => {
  const { target } = host();
  const mounted = mountComponent(rows(), { target, props: { items: list(1, 2, 3) } });
  assert.equal(html(target), '<ul><li data-id="1">0:L1<input></li><li data-id="2">1:L2<input></li><li data-id="3">2:L3<input></li></ul>');
  mounted.setProps({ items: [] });
  mounted.flush();
  assert.equal(html(target), '<ul></ul>');
});

test('a key still there keeps its nodes: reordered, the same elements are moved, and their index follows', () => {
  const { target } = host();
  const mounted = mountComponent(rows(), { target, props: { items: list(1, 2, 3) } });
  const [li1, li2, li3] = target.querySelectorAll('li');
  mounted.setProps({ items: list(3, 1, 2) });
  mounted.flush();
  assert.deepEqual([...target.querySelectorAll('li')], [li3, li1, li2]);
  assert.equal(html(target), '<ul><li data-id="3">0:L3<input></li><li data-id="1">1:L1<input></li><li data-id="2">2:L2<input></li></ul>');
});

test('a new item for a key that is there updates its body in place', () => {
  const { target } = host();
  const mounted = mountComponent(rows(), { target, props: { items: list(1, 2) } });
  const li2 = target.querySelectorAll('li')[1];
  mounted.setProps({ items: [{ id: 1, label: 'L1' }, { id: 2, label: 'renamed' }] });
  mounted.flush();
  assert.equal(target.querySelectorAll('li')[1], li2);
  assert.equal(li2.textContent, '1:renamed');
});

test('keys that are gone are taken out, new keys get new bodies, at the start, in the middle and at the end', () => {
  const { target } = host();
  const mounted = mountComponent(rows(), { target, props: { items: list(1, 2, 3) } });
  const [li1, , li3] = target.querySelectorAll('li');
  mounted.setProps({ items: list(0, 1, 5, 3, 9) });
  mounted.flush();
  const now = [...target.querySelectorAll('li')];
  assert.deepEqual(now.map((li) => li.dataset.id), ['0', '1', '5', '3', '9']);
  assert.equal(now[1], li1);
  assert.equal(now[3], li3);
});

test('as few DOM moves as the new order allows: one element taken from the end to the start is one move', () => {
  const { window, target } = host();
  const mounted = mountComponent(rows(), { target, props: { items: list(1, 2, 3, 4, 5) } });
  const records = [];
  const observer = new window.MutationObserver((r) => records.push(...r));
  observer.observe(target.querySelector('ul'), { childList: true });
  mounted.setProps({ items: list(5, 1, 2, 3, 4) });
  mounted.flush();
  const moved = observer.takeRecords().concat(records).filter((r) => r.addedNodes.length > 0);
  observer.disconnect();
  assert.equal(moved.length, 1, 'only the fifth element moved');
  assert.equal(moved[0].addedNodes[0].dataset.id, '5');
});

test('a field in a moved body keeps its focus', () => {
  const { window, target } = host();
  const mounted = mountComponent(rows(), { target, props: { items: list(1, 2, 3) } });
  const input = target.querySelectorAll('input')[2];
  input.focus();
  assert.equal(window.document.activeElement, input);
  mounted.setProps({ items: list(3, 1, 2) });
  mounted.flush();
  assert.equal(target.querySelectorAll('input')[0], input);
  assert.equal(window.document.activeElement, input);
});

test('with no key, the position is the key: bodies stay in place and show the new items', () => {
  const { target } = host();
  const mounted = mountComponent(rows(null), { target, props: { items: list(1, 2, 3) } });
  const [li1, li2] = target.querySelectorAll('li');
  mounted.setProps({ items: list(2, 3) });
  mounted.flush();
  assert.deepEqual([...target.querySelectorAll('li')], [li1, li2]);
  assert.equal(html(target), '<ul><li data-id="2">0:L2<input></li><li data-id="3">1:L3<input></li></ul>');
});

test('keys are told apart as the reference evaluator tells them apart: 1 and "1" are two keys', () => {
  const { target } = host();
  const ir = component('Mixed', [iteration(prop('items'), 'item', [el('b', {}, text(item))], { key: item })], { props: [{ name: 'items' }] });
  mountComponent(ir, { target, props: { items: [1, '1'] } });
  assert.equal(html(target), '<b>1</b><b>1</b>');
});

test('two elements with one key, and a source that is not an array, are refused', () => {
  const { target } = host();
  assert.throws(() => mountComponent(rows(), { target, props: { items: [{ id: 1 }, { id: 1 }] } }), (error) => error.code === 'OBIX_RUNTIME_VALUE' && /key/.test(error.message) && /1/.test(error.message));
  for (const source of [undefined, 'abc', { length: 1 }]) {
    assert.throws(() => mountComponent(rows(), { target: host().target, props: { items: source } }), (error) => error.code === 'OBIX_RUNTIME_VALUE' && /array/.test(error.message), JSON.stringify(source));
  }
});

test('an event inside a body reads its item; a conditional inside a body; iterations inside iterations', async () => {
  const { target } = host();
  const ir = component('Todo', [
    el('ul', {}, iteration(state('todos'), 'todo', [
      el('li', {},
        conditional([branch(member(local('todo'), 'done'), el('s', {}, text(member(local('todo'), 'title'))))], [text(member(local('todo'), 'title'))]),
        el('button', { attributes: [attr('type', 'button')], events: [on('click', assign('picked', member(local('todo'), 'title')))] }, text('pick')),
        iteration(member(local('todo'), 'tags'), 'tag', [el('i', {}, text(local('i'), '.', local('j'), '=', local('tag')))], { index: 'j' })),
    ], { index: 'i', key: member(local('todo'), 'title') })),
    el('p', {}, text(state('picked'))),
  ], { state: { todos: { kind: 'array', elements: [
    { kind: 'object', entries: [{ key: 'title', value: lit('a') }, { key: 'done', value: lit(true) }, { key: 'tags', value: { kind: 'array', elements: [lit('x'), lit('y')] } }] },
    { kind: 'object', entries: [{ key: 'title', value: lit('b') }, { key: 'done', value: lit(false) }, { key: 'tags', value: { kind: 'array', elements: [] } }] },
  ] }, picked: lit('none') } });
  mountComponent(ir, { target });
  assert.equal(html(target), '<ul><li><s>a</s><button type="button">pick</button><i>0.0=x</i><i>0.1=y</i></li><li>b<button type="button">pick</button></li></ul><p>none</p>');
  target.querySelectorAll('button')[1].click();
  await nextTick();
  assert.equal(target.querySelector('p').textContent, 'b');
});

test('bodies that are taken out take their bindings and listeners with them', () => {
  const { window, target } = host();
  let listeners = 0;
  const add = window.EventTarget.prototype.addEventListener;
  const remove = window.EventTarget.prototype.removeEventListener;
  window.EventTarget.prototype.addEventListener = function (...args) { if (this.nodeType === 1) listeners++; return add.apply(this, args); };
  window.EventTarget.prototype.removeEventListener = function (...args) { if (this.nodeType === 1) listeners--; return remove.apply(this, args); };
  const ir = component('Buttons', [iteration(prop('items'), 'item', [el('button', { events: [on('click', assign('x', item))] }, text(item))], { key: item })], { props: [{ name: 'items' }], state: { x: lit(0) } });
  const mounted = mountComponent(ir, { target, props: { items: [1, 2, 3] } });
  assert.equal(listeners, 3);
  mounted.setProps({ items: [2] });
  mounted.flush();
  assert.equal(listeners, 1);
  mounted.unmount();
  assert.equal(listeners, 0);
});
