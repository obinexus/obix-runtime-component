/**
 * N8 — component interaction: an `output` step tells the invoker, on a channel, a value; the invoker's interaction for that channel runs THEN — synchronously, before the next
 * step — in the invoker, where the invocation was written (its locals, an iteration's item included), the value told as its event payload (`undefined` when the output tells
 * nothing). With no listener on the channel, nothing. The inputs the invoker gives in return reach the invoked component in the next update, as with any other change: the steps
 * after the output still read the inputs as they were. The root's outputs are told to the page: the `interactions` the host gives, by channel.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { mountComponent } from 'obix-runtime-component';
import { nextTick } from 'obix-runtime-reactivity';
import { assign, attr, binary, bind, component, el, interaction, invocation, iteration, lit, local, member, on, output, payload, prop, state, text } from './ir.mjs';

function host() {
  const { window } = new JSDOM('<!doctype html><html><body></body></html>');
  const target = window.document.createElement('div');
  window.document.body.append(target);
  return { window, target };
}
const html = (target) => target.innerHTML.replace(/<!--[^]*?-->/g, '');

/** A picker: its button tells `select` the id it was given, then `done` with nothing, and records what its `seen` input was after telling. */
const Picker = component('Picker', [
  el('button', { events: [on('click', output('select', prop('id')), assign('after', prop('seen')), output('done'))] }, text(prop('id'), ' saw ', state('after'))),
], { props: [{ name: 'id' }, { name: 'seen' }], state: { after: lit('-') }, outputs: [{ channel: 'select', payload: 'string' }, { channel: 'done', payload: null }] });

test('an output runs the invoker\'s interaction then and there, in the invoker, the value told as its event payload', async () => {
  const { target } = host();
  const Main = component('Main', [
    invocation('Picker', { attributes: [attr('id', 'a')], properties: [bind('seen', state('picked'))], interactions: [
      interaction('select', assign('picked', payload()), assign('log', binary('+', state('log'), binary('+', lit('select:'), payload())))),
      interaction('done', assign('log', binary('+', state('log'), binary('+', lit(' done:'), payload())))),
    ] }),
    el('p', {}, text(state('picked'), ' | ', state('log'))),
  ], { state: { picked: lit('none'), log: lit('') }, dependencies: { Picker: './Picker.vue' } });
  mountComponent(Main, { target, registry: { './Picker.vue': Picker } });
  target.querySelector('button').click();
  await nextTick();
  assert.equal(target.querySelector('p').textContent, 'a | select:a done:undefined', 'an output that tells nothing gives undefined');
  assert.equal(target.querySelector('button').textContent, 'a saw none', 'the step after the output read the input as it was: the new one arrives with the next update');
});

test('an interaction written in an iteration runs with that element\'s item in scope', async () => {
  const { target } = host();
  const Main = component('Main', [
    iteration(state('names'), 'n', [invocation('Picker', { properties: [bind('id', local('n'))], interactions: [interaction('select', assign('picked', binary('+', local('n'), binary('+', lit('='), payload()))))] })], { key: local('n') }),
    el('p', {}, text(state('picked'))),
  ], { state: { names: { kind: 'array', elements: [lit('x'), lit('y')] }, picked: lit('') }, dependencies: { Picker: './Picker.vue' } });
  mountComponent(Main, { target, registry: { './Picker.vue': Picker } });
  target.querySelectorAll('button')[1].click();
  await nextTick();
  assert.equal(target.querySelector('p').textContent, 'y=y');
});

test('with no listener on the channel, an output does nothing, and the steps after it run', async () => {
  const { target } = host();
  const Main = component('Main', [invocation('Picker', { attributes: [attr('id', 'q'), attr('seen', 's')] })], { dependencies: { Picker: './Picker.vue' } });
  mountComponent(Main, { target, registry: { './Picker.vue': Picker } });
  target.querySelector('button').click();
  await nextTick();
  assert.equal(html(target), '<button>q saw s</button>');
});

test('an output told from an action, and outputs told through two levels of components', async () => {
  const { target } = host();
  const Inner = component('Inner', [el('button', { events: [on('click', { kind: 'invoke', id: 'i', action: 'tell', arguments: [lit(7)] })] }, text('go'))], {
    outputs: [{ channel: 'value', payload: 'number' }], actions: { tell: { parameters: ['v'], steps: [output('value', binary('*', local('v'), lit(2)))] } },
  });
  const Middle = component('Middle', [invocation('Inner', { interactions: [interaction('value', output('relay', binary('+', payload(), lit(1))))] })], {
    outputs: [{ channel: 'relay', payload: 'number' }], dependencies: { Inner: './Inner.vue' },
  });
  const Main = component('Main', [invocation('Middle', { interactions: [interaction('relay', assign('got', payload()))] }), el('p', {}, text(state('got')))], {
    state: { got: lit(0) }, dependencies: { Middle: './Middle.vue' },
  });
  mountComponent(Main, { target, registry: { './Inner.vue': Inner, './Middle.vue': Middle } });
  target.querySelector('button').click();
  await nextTick();
  assert.equal(target.querySelector('p').textContent, '15');
});

test('the root\'s outputs are told to the page: the interactions the host gives, by channel, with the value told', () => {
  const { target } = host();
  const told = [];
  const mounted = mountComponent(Picker, { target, props: { id: 'root', seen: 'x' }, interactions: { select: (value) => told.push(['select', value]), done: (value) => told.push(['done', value]) } });
  target.querySelector('button').click();
  assert.deepEqual(told, [['select', 'root'], ['done', undefined]], 'synchronously');
  mounted.unmount();
  assert.throws(() => mountComponent(Picker, { target, props: { id: 'r' }, interactions: { chosen: () => {} } }), (error) => error.code === 'OBIX_RUNTIME_LINK' && /chosen/.test(error.message));
  assert.throws(() => mountComponent(Picker, { target, props: { id: 'r' }, interactions: { select: 'not a function' } }), (error) => error.code === 'OBIX_RUNTIME_LINK' && /select/.test(error.message));
});

test('the host\'s handler runs outside any update: what it changes in the page is its own business, and an error it throws reaches the event', () => {
  const { window, target } = host();
  const errors = [];
  window.addEventListener('error', (event) => { errors.push(event.error?.message); event.preventDefault(); });
  mountComponent(Picker, { target, props: { id: 'e' }, interactions: { select: () => { throw new Error('host failed'); } } });
  target.querySelector('button').click();
  assert.deepEqual(errors, ['host failed']);
});
