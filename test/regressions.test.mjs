/**
 * Regression tests written for the survivors of the Phase 6 mutation campaign (tests/mutation/runtime-component.json; docs/recovery/native-runtime.md §15): each states a
 * behaviour the component runtime promises and no earlier test held it to.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { mountComponent } from 'obix-runtime-component';
import { nextTick } from 'obix-runtime-reactivity';
import { assign, attr, binary, bind, branch, component, conditional, content, el, interaction, invocation, iteration, lit, local, on, output, payload, projection, prop, state, text } from './ir.mjs';

function host() {
  const { window } = new JSDOM('<!doctype html><html><body></body></html>');
  const target = window.document.createElement('div');
  window.document.body.append(target);
  return { window, target };
}
const html = (target) => target.innerHTML.replace(/<!--[^]*?-->/g, '');
const refusal = (fn) => { try { fn(); return null; } catch (error) { return `${error.code}: ${error.message}`; } };

test('C032: a prop named like a member of every object is not given by that member — not given, it is undefined', () => {
  const { target } = host();
  mountComponent(component('Odd', [el('p', {}, text(prop('constructor'), '|', prop('toString')))], { props: [{ name: 'constructor' }, { name: 'toString' }] }), { target, props: {} });
  assert.equal(target.textContent, '|');
});

test('C054: effects set off by one change run in the order they are declared', async () => {
  const { target } = host();
  const ir = component('Two', [el('button', { events: [on('click', assign('n', lit(1)))] }, text('go')), el('p', {}, text(state('log')))], {
    state: { n: lit(0), log: lit('') },
    effects: [
      { watch: state('n'), parameters: [], steps: [assign('log', binary('+', state('log'), lit('first ')))] },
      { watch: state('n'), parameters: [], steps: [assign('log', binary('+', state('log'), lit('second')))] },
    ],
  });
  mountComponent(ir, { target });
  target.querySelector('button').click();
  await nextTick();
  assert.equal(target.querySelector('p').textContent, 'first second');
});

test('C057: in an update, an invoker is written before the components it invokes', async () => {
  const { window, target } = host();
  const Child = component('Child', [el('b', {}, text(prop('v')))], { props: [{ name: 'v' }] });
  const Main = component('Main', [
    invocation('Child', { properties: [bind('v', state('n'))] }),
    el('i', {}, text(state('n'))), el('i', {}, text(state('n'))), el('i', {}, text(state('n'))),
    el('button', { events: [on('click', assign('n', lit(1)))] }, text('go')),
  ], { state: { n: lit(0) }, dependencies: { Child: './Child' } });
  mountComponent(Main, { target, registry: { './Child': Child } });
  const order = [];
  const observer = new window.MutationObserver((records) => { for (const r of records) order.push(r.target.parentNode.localName); });
  observer.observe(target, { subtree: true, characterData: true });
  target.querySelector('button').click();
  await nextTick();
  await Promise.resolve();
  observer.disconnect();
  assert.deepEqual(order, ['i', 'i', 'i', 'b']);
});

test('C090, C092: nothing registered for a specifier and a named export asked of a component are refused, each in its own words', () => {
  const { target } = host();
  const Leaf = component('Leaf', [el('p', {})]);
  const Main = component('Main', [invocation('Leaf')], { dependencies: { Leaf: './Leaf' } });
  assert.match(refusal(() => mountComponent(Main, { target, registry: {} })), /^OBIX_RUNTIME_LINK: Main invokes Leaf from \.\/Leaf, and no component is registered for \.\/Leaf$/);
  const Named = component('Main', [invocation('Leaf')]);
  Named.dependencies.push({ id: 'd', local: 'Leaf', specifier: './parts', export: 'Leaf' });
  assert.match(refusal(() => mountComponent(Named, { target, registry: { './parts': Leaf } })), /^OBIX_RUNTIME_LINK: Main invokes the export Leaf of \.\/parts, which the registry does not have$/);
});

test('C094: an interaction on an output the invoked component does not declare is refused before anything is rendered', () => {
  const { target } = host();
  const Leaf = component('Leaf', [el('p', {})], { outputs: [{ channel: 'done' }] });
  const Main = component('Main', [invocation('Leaf', { interactions: [interaction('chosen', assign('x', payload()))] })], { state: { x: lit(0) }, dependencies: { Leaf: './Leaf' } });
  assert.match(refusal(() => mountComponent(Main, { target, registry: { './Leaf': Leaf } })), /^OBIX_RUNTIME_LINK: Main listens to Leaf on chosen, which Leaf does not declare as an output$/);
  assert.equal(target.childNodes.length, 0);
});

test('C098, C100: invocations inside projected content and inside a fallback are linked before anything is rendered', () => {
  const { target } = host();
  const Frame = component('Frame', [projection('default', [invocation('Missing')])], { dependencies: { Missing: './Missing' } });
  assert.match(refusal(() => mountComponent(Frame, { target, registry: {} })), /^OBIX_RUNTIME_LINK: .*\.\/Missing/);
  const Card = component('Card', [projection('default')]);
  const Main = component('Main', [invocation('Card', { children: [content('default', [invocation('Missing')])] })], { dependencies: { Card: './Card', Missing: './Missing' } });
  assert.match(refusal(() => mountComponent(Main, { target, registry: { './Card': Card } })), /^OBIX_RUNTIME_LINK: .*\.\/Missing/);
  assert.equal(target.childNodes.length, 0);
});

test('Q03–Q17: what the reader refuses, each before a node is made', () => {
  const { target } = host();
  const refuse = (ir, pattern) => {
    assert.match(refusal(() => mountComponent(ir, { target })), pattern);
    assert.equal(target.childNodes.length, 0);
  };
  const shows = (expression, parts = {}) => component('R', [el('p', {}, text(expression))], parts);
  refuse(shows({ kind: 'reference', scope: 'global', name: 'x' }), /^OBIX_RUNTIME_INVALID_IR: .*a reference of scope global/);
  refuse(shows(prop('missing')), /^OBIX_RUNTIME_INVALID_IR: .*prop missing is not declared by the component/);
  refuse(shows(state('missing')), /state missing is not declared by the component/);
  refuse(shows(local('outside')), /local outside is not declared where it is read/);
  refuse(shows(payload()), /the event payload is read outside an event handler/);
  refuse(shows({ kind: 'unary', operator: '~', operand: lit(1) }), /the unary operator ~/);
  refuse(shows({ kind: 'binary', operator: '**', left: lit(1), right: lit(2) }), /the binary operator \*\*/);
  refuse(shows({ kind: 'logical', operator: '^^', left: lit(1), right: lit(2) }), /the logical operator \^\^/);
  refuse(shows({ kind: 'call', function: 'floor', arguments: [lit(1)] }), /a call of floor, which is not a function of the IR/);
  refuse(shows({ kind: 'call', function: 'round', arguments: [] }), /round takes 1 argument\(s\), it is given 0/);
  const clicks = (...steps) => component('R', [el('button', { events: [on('click', ...steps)] })], { state: { s: lit(0) } });
  refuse(clicks({ kind: 'throw', id: 't' }), /a step of kind throw/);
  refuse(clicks(assign('other', lit(1))), /an assign to other, which is not a state of the component/);
  refuse(clicks(output('told')), /an output on told, which is not an output of the component/);
  refuse(component('R', [invocation('Nobody')]), /an invocation of Nobody, which is not a dependency of the component/);
  // and what is in scope is read: the payload in a handler, a local in its iteration
  assert.doesNotThrow(() => mountComponent(clicks(assign('s', payload())), { target: host().target }));
  assert.doesNotThrow(() => mountComponent(component('R', [iteration(lit([]), 'it', [text(local('it'))])]), { target: host().target }));
});

test('R14: a text whose value comes out the same is not written again', async () => {
  const { window, target } = host();
  const ir = component('Parity', [el('p', {}, text(binary('%', prop('n'), lit(2))))], { props: [{ name: 'n' }] });
  const mounted = mountComponent(ir, { target, props: { n: 1 } });
  const records = [];
  const observer = new window.MutationObserver((r) => records.push(...r));
  observer.observe(target, { subtree: true, characterData: true });
  mounted.setProps({ n: 3 });
  mounted.flush();
  records.push(...observer.takeRecords());
  observer.disconnect();
  assert.deepEqual(records, []);
});

const Card = component('Card', [el('section', {}, projection('default', [el('i', {}, text('fallback'))]))]);
const mainWith = (body, parts = {}) => component('Main', [invocation('Card', { children: [content('default', body)] }), el('button', { events: [on('click', assign('n', binary('+', state('n'), lit(1))))] }, text('+'))], { state: { n: lit(1), ...(parts.state ?? {}) }, dependencies: { Card: './Card' } });

test('R56: content whose conditional shows its otherwise is there — the otherwise is shown, not the fallback', () => {
  const { target } = host();
  mountComponent(mainWith([conditional([branch(lit(false), el('b', {}, text('branch')))], [el('u', {}, text('otherwise'))])]), { target, registry: { './Card': Card } });
  assert.match(html(target), /<section><u>otherwise<\/u><\/section>/);
});

test('R57: content that is an iteration whose bodies show nothing is not there — the fallback is shown', () => {
  const { target } = host();
  mountComponent(mainWith([iteration({ kind: 'array', elements: [lit(1), lit(2)] }, 'x', [conditional([branch(lit(false), el('b', {}))])])]), { target, registry: { './Card': Card } });
  assert.match(html(target), /<section><i>fallback<\/i><\/section>/);
});

test('R65: while projected content stays there, what the projection shows is not made again', async () => {
  const { target } = host();
  mountComponent(mainWith([conditional([branch(binary('>', state('n'), lit(0)), el('b', {}, text(state('n'))))])]), { target, registry: { './Card': Card } });
  const b = target.querySelector('b');
  target.querySelector('button').click();
  await nextTick();
  assert.equal(target.querySelector('b'), b, 'the same element');
  assert.equal(b.textContent, '2');
});

// ── Phase 6.1, H2: own-property props, on the native runtime as on the evaluator ─────────────────────────────────────────────────────────

const INHERITED = ['constructor', 'toString', 'valueOf', '__proto__', 'hasOwnProperty'];
const Shows = component('Shows', [el('p', {}, ...INHERITED.map((name) => text(`${name}=`, prop(name), ';')))], { props: INHERITED.map((name) => ({ name })) });

test('H2: a prop named like a member every object has, not given, is undefined — at the root and in an invoked component', () => {
  const { target } = host();
  mountComponent(Shows, { target, props: {} });
  assert.equal(target.textContent, 'constructor=;toString=;valueOf=;__proto__=;hasOwnProperty=;');
  const invoked = host();
  mountComponent(component('Main', [invocation('Shows')], { dependencies: { Shows: './Shows' } }), { target: invoked.target, registry: { './Shows': Shows } });
  assert.equal(invoked.target.textContent, 'constructor=;toString=;valueOf=;__proto__=;hasOwnProperty=;');
});

test('H2: given — fixed or bound, __proto__ included — each is what was given, never a prototype', () => {
  const invoked = host();
  const Main = component('Main', [invocation('Shows', {
    attributes: [attr('constructor', 'c'), attr('__proto__', 'p')],
    properties: [bind('toString', lit('t')), bind('valueOf', lit('v')), bind('hasOwnProperty', lit('h'))],
  })], { dependencies: { Shows: './Shows' } });
  mountComponent(Main, { target: invoked.target, registry: { './Shows': Shows } });
  assert.equal(invoked.target.textContent, 'constructor=c;toString=t;valueOf=v;__proto__=p;hasOwnProperty=h;');
  const root = host();
  const inputs = Object.create(null);
  inputs.__proto__ = 'root';
  mountComponent(Shows, { target: root.target, props: inputs });
  assert.match(root.target.textContent, /__proto__=root;/);
});

// ── Phase 6.1, H3: duplicate keys, a deliberate refusal ─────────────────────────────────────────────────────────────────────────────────

const Keyed = component('Keys', [iteration(prop('items'), 'x', [el('b', {}, text(local('x')))], { key: local('x') })], { props: [{ name: 'items' }] });

test('H3: two elements with one key are refused — the same code and words every time, whatever their positions', () => {
  const seen = new Set();
  for (const items of [['q', 'r', 'q'], ['q', 'q', 'r'], ['r', 'q', 'q']]) {
    for (let i = 0; i < 3; i++) seen.add(refusal(() => mountComponent(Keyed, { target: host().target, props: { items } })));
  }
  assert.deepEqual([...seen], ['OBIX_RUNTIME_VALUE: Keys: two elements of an iteration have the key "q": a key says which element is which']);
});

test('H3: a list that becomes one with a duplicate is refused when it is written, the page keeps what it showed, and a list with unique keys is shown after it', async () => {
  const { target } = host();
  const mounted = mountComponent(Keyed, { target, props: { items: ['a', 'b'] } });
  const before = [...target.querySelectorAll('b')];
  mounted.setProps({ items: ['a', 'a'] });
  assert.throws(() => mounted.flush(), (error) => error.code === 'OBIX_RUNTIME_VALUE' && /the key "a"/.test(error.message));
  assert.deepEqual([...target.querySelectorAll('b')], before, 'the same elements, unchanged');
  assert.equal(html(target), '<b>a</b><b>b</b>');
  mounted.setProps({ items: ['b', 'c'] });
  mounted.flush();
  assert.equal(html(target), '<b>b</b><b>c</b>');
});
