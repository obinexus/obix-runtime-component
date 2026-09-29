/**
 * N3 — a component's derived values are computed values: shown and bound like props and state, worked out again only when what they read changes, and once however many
 * bindings read them. A derived value may read other derived values; a circle of them is refused before anything is rendered.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { mountComponent } from 'obix-runtime-component';
import { binary, bind, choice, component, derived, el, lit, member, prop, state, text } from './ir.mjs';

function host() {
  const document = new JSDOM('<!doctype html><html><body></body></html>').window.document;
  const target = document.createElement('div');
  document.body.append(target);
  return target;
}

test('a derived value is shown, bound, and follows what it reads', () => {
  const target = host();
  const ir = component('Counter', [el('p', { properties: [bind('data-doubled', derived('doubled'))] }, text(prop('count'), ' / ', derived('doubled')))], {
    props: [{ name: 'count' }],
    derived: { doubled: binary('*', prop('count'), lit(2)) },
  });
  const mounted = mountComponent(ir, { target, props: { count: 1 } });
  assert.equal(target.innerHTML, '<p data-doubled="2">1 / 2</p>');
  mounted.setProps({ count: 2 });
  mounted.flush();
  assert.equal(target.innerHTML, '<p data-doubled="4">2 / 4</p>');
});

test('derived values of derived values, and of state', () => {
  const target = host();
  const ir = component('Chain', [el('p', {}, text(derived('label')))], {
    props: [{ name: 'n' }],
    state: { unit: lit('cm') },
    derived: {
      twice: binary('*', prop('n'), lit(2)),
      label: binary('+', binary('+', derived('twice'), lit(' ')), state('unit')),
    },
  });
  const mounted = mountComponent(ir, { target, props: { n: 3 } });
  assert.equal(target.textContent, '6 cm');
  mounted.setProps({ n: 5 });
  mounted.flush();
  assert.equal(target.textContent, '10 cm');
});

test('a derived value read by several bindings is worked out once per change', () => {
  const target = host();
  let reads = 0;
  // a prop whose member counts its reads: the derived value reads it once each time it is worked out
  const counted = (value) => ({ get v() { reads++; return value; } });
  const ir = component('Many', [
    el('p', { properties: [bind('title', derived('d')), bind('data-a', derived('d'))] }, text(derived('d'), derived('d'))),
    el('p', {}, text(derived('d'))),
  ], { props: [{ name: 'box' }], derived: { d: member(prop('box'), 'v') } });
  const mounted = mountComponent(ir, { target, props: { box: counted('x') } });
  assert.equal(reads, 1, 'once for four bindings');
  mounted.setProps({ box: counted('y') });
  mounted.flush();
  assert.equal(reads, 2);
  assert.equal(target.textContent, 'yyy');
});

test('a derived value no binding reads is never worked out', () => {
  const target = host();
  let reads = 0;
  const ir = component('Unused', [el('p', {}, text('static'))], { props: [{ name: 'box' }], derived: { d: member(prop('box'), 'v') } });
  mountComponent(ir, { target, props: { box: { get v() { reads++; return 1; } } } });
  assert.equal(reads, 0);
});

test('only the branch a derived value takes is what it depends on', () => {
  const target = host();
  let reads = 0;
  const ir = component('Branch', [el('p', {}, text(derived('d')))], {
    props: [{ name: 'on' }, { name: 'box' }],
    derived: { d: choice(prop('on'), member(prop('box'), 'v'), lit('off')) },
  });
  const mounted = mountComponent(ir, { target, props: { on: false, box: { get v() { reads++; return 'on'; } } } });
  assert.equal(target.textContent, 'off');
  mounted.setProps({ on: true, box: { get v() { reads++; return 'on'; } } });
  mounted.flush();
  assert.equal(target.textContent, 'on');
  assert.equal(reads, 1);
});

test('a circle of derived values is refused before anything is rendered', () => {
  const target = host();
  const ir = component('Circle', [el('p', {}, text(derived('a')))], { derived: { a: derived('b'), b: binary('+', derived('a'), lit(1)) } });
  assert.throws(() => mountComponent(ir, { target }), (error) => error.code === 'OBIX_RUNTIME_INVALID_IR' && /a → b → a|b → a → b/.test(error.message));
  assert.equal(target.childNodes.length, 0);
  const self = component('Self', [el('p', {}, text(derived('a')))], { derived: { a: derived('a') } });
  assert.throws(() => mountComponent(self, { target }), (error) => error.code === 'OBIX_RUNTIME_INVALID_IR' && /a → a/.test(error.message));
});
