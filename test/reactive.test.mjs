/**
 * N2 — a component's state and props are refs, and what the view shows of them is BOUND: when they change, the text and the attributes that read them are written again, in
 * place — the same DOM nodes, nothing rebuilt — after the current task (or at `flush`), once each however many changes came before.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { mountComponent } from 'obix-runtime-component';
import { nextTick } from 'obix-runtime-reactivity';
import { attr, bind, binary, component, el, lit, prop, state, text } from './ir.mjs';

function host() {
  const document = new JSDOM('<!doctype html><html><body></body></html>').window.document;
  const target = document.createElement('div');
  document.body.append(target);
  return target;
}

const card = component('Card', [
  el('p', { attributes: [attr('class', 'card')], properties: [bind('title', prop('label'))], a11y: { properties: [bind('aria-label', binary('+', lit('Card '), prop('label')))] } },
    text('Hello, ', prop('label'), ' #', prop('n'))),
], { props: [{ name: 'label' }, { name: 'n' }] });

test('state is shown from its initial value', () => {
  const target = host();
  mountComponent(component('S', [el('p', {}, text(state('count'), ' / ', state('name')))], { state: { count: lit(0), name: lit('none') } }), { target });
  assert.equal(target.innerHTML, '<p>0 / none</p>');
});

test('new props are shown after the current task, in place: the same element and the same text node', async () => {
  const target = host();
  const mounted = mountComponent(card, { target, props: { label: 'a', n: 1 } });
  const p = target.querySelector('p');
  const textNode = p.firstChild;
  assert.equal(p.outerHTML, '<p class="card" title="a" aria-label="Card a">Hello, a #1</p>');
  mounted.setProps({ label: 'b', n: 2 });
  assert.equal(p.textContent, 'Hello, a #1', 'nothing is written synchronously');
  await nextTick();
  assert.equal(p.outerHTML, '<p class="card" title="b" aria-label="Card b">Hello, b #2</p>');
  assert.equal(target.querySelector('p'), p, 'the same element');
  assert.equal(p.firstChild, textNode, 'the same text node');
});

test('flush writes the pending updates now', () => {
  const target = host();
  const mounted = mountComponent(card, { target, props: { label: 'a', n: 1 } });
  mounted.setProps({ label: 'z', n: 9 });
  mounted.flush();
  assert.equal(target.querySelector('p').textContent, 'Hello, z #9');
});

test('many changes before the update are written once: each binding writes at most once per update', async () => {
  const target = host();
  const mounted = mountComponent(card, { target, props: { label: 'a', n: 1 } });
  const p = target.querySelector('p');
  const writes = { text: 0, attributes: 0 };
  const observer = new target.ownerDocument.defaultView.MutationObserver((records) => {
    for (const r of records) writes[r.type === 'characterData' ? 'text' : 'attributes']++;
  });
  observer.observe(p, { subtree: true, characterData: true, attributes: true });
  for (let i = 2; i < 12; i++) mounted.setProps({ label: `l${i}`, n: i });
  await nextTick();
  await Promise.resolve();
  observer.disconnect();
  assert.equal(p.textContent, 'Hello, l11 #11');
  assert.deepEqual(writes, { text: 1, attributes: 2 }, 'one text write, one write of each bound attribute');
});

test('a binding whose value did not change writes nothing', async () => {
  const target = host();
  const mounted = mountComponent(card, { target, props: { label: 'same', n: 1 } });
  const p = target.querySelector('p');
  const records = [];
  const observer = new target.ownerDocument.defaultView.MutationObserver((r) => records.push(...r));
  observer.observe(p, { subtree: true, characterData: true, attributes: true });
  mounted.setProps({ label: 'same', n: 2 });
  await nextTick();
  await Promise.resolve();
  observer.disconnect();
  assert.deepEqual(records.map((r) => r.type), ['characterData'], 'only the text, which shows n, is written');
});

test('props that are no longer given go back to their default, and an undeclared input is refused with nothing changed', async () => {
  const target = host();
  const ir = component('D', [el('p', {}, text(prop('a'), ',', prop('b')))], { props: [{ name: 'a', default: lit('A') }, { name: 'b' }] });
  const mounted = mountComponent(ir, { target, props: { a: 'x', b: 'y' } });
  mounted.setProps({ b: 'z' });
  await nextTick();
  assert.equal(target.textContent, 'A,z');
  assert.throws(() => mounted.setProps({ c: 1 }), (error) => error.code === 'OBIX_RUNTIME_INPUT');
  await nextTick();
  assert.equal(target.textContent, 'A,z');
});

test('after unmount, a change updates nothing and nothing is left pending', async () => {
  const target = host();
  const mounted = mountComponent(card, { target, props: { label: 'a', n: 1 } });
  const p = target.querySelector('p');
  mounted.setProps({ label: 'b', n: 2 });
  mounted.unmount();
  await nextTick();
  assert.equal(p.textContent, 'Hello, a #1', 'the pending update was dropped with the component');
  assert.equal(target.innerHTML, '');
});
