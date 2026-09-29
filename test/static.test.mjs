/**
 * N0 — static DOM: a component whose view is elements, fixed attributes, accessibility attributes and static text is built into the document as real DOM nodes, in order,
 * where it is asked to go, and taken out again; an IR the runtime cannot read is refused with a code, never half rendered.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { ObixRuntimeError, mountComponent } from 'obix-runtime-component';
import { attr, component, el, text } from './ir.mjs';

const documentOf = () => new JSDOM('<!doctype html><html><body></body></html>').window.document;

function host() {
  const document = documentOf();
  const target = document.createElement('div');
  document.body.append(target);
  return { document, target };
}

test('elements, fixed attributes, accessibility attributes and static text become DOM nodes, in order', () => {
  const { target } = host();
  const ir = component('Card', [
    el('section', { attributes: [attr('class', 'card'), attr('id', 'main')] },
      el('h1', {}, text('Hello')),
      el('p', {}, text('Static '), el('b', {}, text('bold')), text(' text & friends.')),
      el('input', { attributes: [attr('type', 'text'), attr('disabled', '')], a11y: { attributes: [attr('aria-label', 'Name')] } })),
  ]);
  mountComponent(ir, { target });
  assert.equal(target.innerHTML, '<section class="card" id="main"><h1>Hello</h1><p>Static <b>bold</b> text &amp; friends.</p><input type="text" disabled="" aria-label="Name"></section>');
  const input = target.querySelector('input');
  assert.equal(input.disabled, true, 'a valueless attribute is there, and means what HTML says it means');
  assert.equal(input.getAttribute('aria-label'), 'Name');
});

test('a text of several static parts is their run together, and a view may have several roots', () => {
  const { target } = host();
  mountComponent(component('Two', [el('h1', {}, text('a', 'b', 'c')), text('between'), el('p', {})]), { target });
  assert.equal(target.innerHTML, '<h1>abc</h1>between<p></p>');
});

test('attribute names are written as the IR has them — a name no frontend understood stays as written', () => {
  const { target } = host();
  mountComponent(component('AsWritten', [el('b', { attributes: [attr(':a', '1'), attr('@click', 'go')] }, text('{{ not lowered }}'))]), { target });
  assert.equal(target.innerHTML, '<b :a="1" @click="go">{{ not lowered }}</b>');
});

test('the nodes go where they are asked to — before an anchor, among what the target already holds — and unmount takes out exactly them', () => {
  const { document, target } = host();
  const before = document.createElement('i');
  const after = document.createElement('u');
  target.append(before, after);
  const mounted = mountComponent(component('Mid', [el('p', {}, text('one')), el('p', {}, text('two'))]), { target, anchor: after });
  assert.equal(target.innerHTML, '<i></i><p>one</p><p>two</p><u></u>');
  assert.deepEqual(mounted.nodes().map((n) => n.textContent), ['one', 'two']);
  mounted.unmount();
  assert.equal(target.innerHTML, '<i></i><u></u>');
  assert.doesNotThrow(() => mounted.unmount(), 'unmount twice is nothing');
});

test('the nodes are made by the document of the target: the runtime reads no global document', () => {
  const { target } = host();
  assert.equal(typeof globalThis.document, 'undefined', 'this test runs with no global document');
  mountComponent(component('Owned', [el('p', {}, text('mine'))]), { target });
  assert.equal(target.firstChild.ownerDocument, target.ownerDocument);
});

test('an IR of another schema, or that is not a component, is refused with OBIX_RUNTIME_SCHEMA, and nothing is rendered', () => {
  const { target } = host();
  for (const bad of [{ ...component('Old', []), schema: 'obix-dop-ir/2' }, { ...component('No', []), kind: 'element' }, null, 'component']) {
    assert.throws(() => mountComponent(bad, { target }), (error) => error instanceof ObixRuntimeError && error.code === 'OBIX_RUNTIME_SCHEMA', JSON.stringify(bad));
  }
  assert.equal(target.childNodes.length, 0);
});

test('a node, a text part or an expression of a kind the IR does not have is refused with OBIX_RUNTIME_INVALID_IR before anything is rendered', () => {
  const { target } = host();
  const unknownNode = component('Bad', [el('p', {}, text('fine')), { kind: 'portal', id: 'x' }]);
  assert.throws(() => mountComponent(unknownNode, { target }), (error) => error.code === 'OBIX_RUNTIME_INVALID_IR' && /portal/.test(error.message));
  const unknownPart = component('Bad', [{ kind: 'text', id: 't', parts: [{ kind: 'html', value: '<b>' }] }]);
  assert.throws(() => mountComponent(unknownPart, { target }), (error) => error.code === 'OBIX_RUNTIME_INVALID_IR' && /html/.test(error.message));
  const unknownExpression = component('Bad', [text({ kind: 'eval', source: '1' })]);
  assert.throws(() => mountComponent(unknownExpression, { target }), (error) => error.code === 'OBIX_RUNTIME_INVALID_IR' && /eval/.test(error.message));
  assert.equal(target.childNodes.length, 0, 'nothing was rendered: the IR is read before the DOM is touched');
});

test('the error names the component and says what it is', () => {
  const error = new ObixRuntimeError('OBIX_RUNTIME_SCHEMA', 'Main: not an IR');
  assert.equal(error.name, 'ObixRuntimeError');
  assert.equal(error.code, 'OBIX_RUNTIME_SCHEMA');
  assert.ok(error instanceof Error);
});
