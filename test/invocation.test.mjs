/**
 * N7 — component invocation: an invocation shows the component it names (a dependency, resolved in the registry by the module specifier the source wrote), given its fixed and
 * bound inputs; the invoked component keeps its own state while it stays in the view, and loses it when it goes. What the invoker puts inside is PROJECTED: shown where the
 * invoked component has a projection of that slot, in the INVOKER's scope, given the projection's arguments; when it puts nothing there, or only what is not there (a conditional
 * that shows nothing, an iteration over nothing), the projection's fallback is shown. The components are linked when they are mounted: a dependency with no registered component,
 * or an input the invoked component does not declare, is refused before anything is rendered.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { mountComponent } from 'obix-runtime-component';
import { nextTick } from 'obix-runtime-reactivity';
import { assign, attr, binary, bind, branch, component, conditional, content, el, invocation, iteration, lit, local, member, on, projection, prop, state, text } from './ir.mjs';

function host() {
  const { window } = new JSDOM('<!doctype html><html><body></body></html>');
  const target = window.document.createElement('div');
  window.document.body.append(target);
  return { window, target };
}
const html = (target) => target.innerHTML.replace(/<!--[^]*?-->/g, '');
const plus = (name) => assign(name, binary('+', state(name), lit(1)));

/** A counter with a label from its invoker and a count of its own. */
const Tally = component('Tally', [
  el('button', { events: [on('click', plus('count'))] }, text(prop('label'), '=', state('count'))),
], { props: [{ name: 'label', type: 'string' }, { name: 'loud', type: 'boolean' }], state: { count: lit(0) } });

test('an invocation shows the invoked component in its place, given fixed and bound inputs, which follow the invoker', async () => {
  const { target } = host();
  const Main = component('Main', [
    el('p', {}, text('before')),
    invocation('Tally', { properties: [bind('label', state('name'))], attributes: [attr('loud', '')] }),
    el('button', { events: [on('click', assign('name', lit('b')))] }, text('rename')),
  ], { state: { name: lit('a') }, dependencies: { Tally: './Tally.vue' } });
  mountComponent(Main, { target, registry: { './Tally.vue': Tally } });
  assert.equal(html(target), '<p>before</p><button>a=0</button><button>rename</button>');
  const [tally, rename] = target.querySelectorAll('button');
  tally.click();
  await nextTick();
  rename.click();
  await nextTick();
  assert.equal(html(target), '<p>before</p><button>b=1</button><button>rename</button>', 'the invoked component kept its state when its input changed');
  assert.equal(target.querySelector('button'), tally);
});

test('an invoked component loses its state when it leaves the view, and starts again when it comes back', async () => {
  const { target } = host();
  const Main = component('Main', [
    conditional([branch(state('show'), invocation('Tally', { attributes: [attr('label', 'x')] }))]),
    el('button', { events: [on('click', assign('show', { kind: 'unary', operator: '!', operand: state('show') }))] }, text('toggle')),
  ], { state: { show: lit(true) }, dependencies: { Tally: './Tally.vue' } });
  mountComponent(Main, { target, registry: { './Tally.vue': Tally } });
  target.querySelector('button').click();
  await nextTick();
  assert.equal(html(target), '<button>x=1</button><button>toggle</button>');
  const toggle = target.querySelectorAll('button')[1];
  toggle.click();
  await nextTick();
  toggle.click();
  await nextTick();
  assert.equal(html(target), '<button>x=0</button><button>toggle</button>');
});

test('invoked components in a keyed iteration keep their state with their key when the list is reordered', async () => {
  const { target } = host();
  const Main = component('Main', [
    iteration(state('names'), 'n', [invocation('Tally', { properties: [bind('label', local('n'))] })], { key: local('n') }),
    el('button', { events: [on('click', assign('names', { kind: 'array', elements: [lit('c'), lit('a'), lit('b')] }))] }, text('reorder')),
  ], { state: { names: { kind: 'array', elements: [lit('a'), lit('b'), lit('c')] } }, dependencies: { Tally: './Tally.vue' } });
  mountComponent(Main, { target, registry: { './Tally.vue': Tally } });
  const [a, b] = target.querySelectorAll('button');
  a.click();
  b.click();
  b.click();
  await nextTick();
  target.querySelectorAll('button')[3].click();
  await nextTick();
  assert.equal(html(target), '<button>c=0</button><button>a=1</button><button>b=2</button><button>reorder</button>');
});

const Card = component('Card', [
  el('section', {},
    el('h2', {}, projection('title', [text('Untitled')])),
    projection('default', [el('i', {}, text('empty'))]),
    el('footer', {}, projection('footer'))),
], {});

test('what an invoker puts inside is shown where the slot is, in the invoker\'s scope; a slot given nothing shows its fallback', async () => {
  const { target } = host();
  const Main = component('Main', [
    invocation('Card', { children: [
      content('default', [el('p', {}, text('body ', state('n')))]),
      content('footer', [el('button', { events: [on('click', plus('n'))] }, text('more'))]),
    ] }),
  ], { state: { n: lit(1) }, dependencies: { Card: './Card.vue' } });
  mountComponent(Main, { target, registry: { './Card.vue': Card } });
  assert.equal(html(target), '<section><h2>Untitled</h2><p>body 1</p><footer><button>more</button></footer></section>');
  target.querySelector('button').click();
  await nextTick();
  assert.equal(target.querySelector('p').textContent, 'body 2', 'the projected content follows the invoker\'s state');
});

test('content that is not there — a conditional that shows nothing — shows the fallback, and the content when it is there again', async () => {
  const { target } = host();
  const Main = component('Main', [
    invocation('Card', { children: [content('default', [conditional([branch(state('has'), el('p', {}, text('content')))])])] }),
    el('button', { events: [on('click', assign('has', { kind: 'unary', operator: '!', operand: state('has') }))] }, text('toggle')),
  ], { state: { has: lit(false) }, dependencies: { Card: './Card.vue' } });
  mountComponent(Main, { target, registry: { './Card.vue': Card } });
  assert.match(html(target), /<i>empty<\/i>/);
  const toggle = target.querySelectorAll('button')[0];
  toggle.click();
  await nextTick();
  assert.match(html(target), /<p>content<\/p>/);
  assert.doesNotMatch(html(target), /empty/);
  toggle.click();
  await nextTick();
  assert.match(html(target), /<i>empty<\/i>/);
});

test('an empty text is there: a text of nothing is content, and the fallback is not shown for it', () => {
  const { target } = host();
  const Main = component('Main', [invocation('Card', { children: [content('default', [text(lit(''))])] })], { dependencies: { Card: './Card.vue' } });
  mountComponent(Main, { target, registry: { './Card.vue': Card } });
  assert.doesNotMatch(html(target), /empty/);
});

test('a scoped slot: the content receives the projection\'s arguments — one by name, or all of them as an object — and follows them', async () => {
  const { target } = host();
  const List = component('List', [
    el('ul', {}, iteration(prop('items'), 'it', [el('li', {}, projection('row', [text(local('it'))], [['value', local('it')], ['position', local('i')]]))], { index: 'i', key: local('it') })),
  ], { props: [{ name: 'items' }] });
  const Main = component('Main', [
    invocation('List', { properties: [bind('items', state('items'))], children: [
      content('row', [text(local('v'), '@', member(local('all'), 'position'))], [{ local: 'v', argument: 'value' }, { local: 'all', argument: null }]),
    ] }),
    el('button', { events: [on('click', assign('items', { kind: 'array', elements: [lit('z'), lit('x')] }))] }, text('change')),
  ], { state: { items: { kind: 'array', elements: [lit('x'), lit('y')] } }, dependencies: { List: './List.vue' } });
  mountComponent(Main, { target, registry: { './List.vue': List } });
  assert.equal(html(target), '<ul><li>x@0</li><li>y@1</li></ul><button>change</button>');
  target.querySelector('button').click();
  await nextTick();
  assert.equal(html(target), '<ul><li>z@0</li><li>x@1</li></ul><button>change</button>');
});

test('content re-projected: a projection inside what an invoker puts in another component shows what ITS invoker put there', () => {
  const { target } = host();
  const Wrapper = component('Wrapper', [invocation('Card', { children: [content('default', [el('div', {}, projection('default', [text('none given')]))])] })], { dependencies: { Card: './Card.vue' } });
  const Main = component('Main', [invocation('Wrapper', { children: [content('default', [text('from main')])] })], { dependencies: { Wrapper: './Wrapper.vue' } });
  mountComponent(Main, { target, registry: { './Card.vue': Card, './Wrapper.vue': Wrapper } });
  assert.match(html(target), /<div>from main<\/div>/);
});

test('linking: a dependency no component is registered for, and an input the invoked component does not declare, are refused before anything is rendered', () => {
  const { target } = host();
  const Main = component('Main', [invocation('Tally', { attributes: [attr('label', 'x')] })], { dependencies: { Tally: './Tally.vue' } });
  assert.throws(() => mountComponent(Main, { target, registry: {} }), (error) => error.code === 'OBIX_RUNTIME_LINK' && /\.\/Tally\.vue/.test(error.message));
  const Wrong = component('Main', [invocation('Tally', { attributes: [attr('colour', 'red')] })], { dependencies: { Tally: './Tally.vue' } });
  assert.throws(() => mountComponent(Wrong, { target, registry: { './Tally.vue': Tally } }), (error) => error.code === 'OBIX_RUNTIME_LINK' && /colour/.test(error.message) && /Tally/.test(error.message));
  const Bad = component('Main', [invocation('Tally', {})], { dependencies: { Tally: './Tally.vue' } });
  assert.throws(() => mountComponent(Bad, { target, registry: { './Tally.vue': { ...Tally, schema: 'obix-dop-ir/2' } } }), (error) => error.code === 'OBIX_RUNTIME_SCHEMA');
  assert.equal(target.childNodes.length, 0);
});

test('a named export is found in the module the registry gives for the specifier', () => {
  const { target } = host();
  const Main = component('Main', [invocation('Tally', { attributes: [attr('label', 'n')] })], { dependencies: {} });
  Main.dependencies.push({ id: 'dep.named', local: 'Tally', specifier: './parts', export: 'Tally' });
  mountComponent(Main, { target, registry: { './parts': { Tally } } });
  assert.equal(html(target), '<button>n=0</button>');
  assert.throws(() => mountComponent(Main, { target: host().target, registry: { './parts': { Other: Tally } } }), (error) => error.code === 'OBIX_RUNTIME_LINK' && /Tally/.test(error.message));
});

test('unmounting the invoker takes out the invoked components, their listeners included', () => {
  const { window, target } = host();
  let listeners = 0;
  const add = window.EventTarget.prototype.addEventListener;
  const remove = window.EventTarget.prototype.removeEventListener;
  window.EventTarget.prototype.addEventListener = function (...args) { if (this.nodeType === 1) listeners++; return add.apply(this, args); };
  window.EventTarget.prototype.removeEventListener = function (...args) { if (this.nodeType === 1) listeners--; return remove.apply(this, args); };
  const Main = component('Main', [invocation('Tally', { attributes: [attr('label', 'a')] }), invocation('Tally', { attributes: [attr('label', 'b')] })], { dependencies: { Tally: './Tally.vue' } });
  const mounted = mountComponent(Main, { target, registry: { './Tally.vue': Tally } });
  assert.equal(listeners, 2);
  mounted.unmount();
  assert.equal(listeners, 0);
  assert.equal(html(target), '');
});
