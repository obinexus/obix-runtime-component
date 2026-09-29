/**
 * N1 — text and interpolation: the expressions of the IR evaluated by the runtime's own evaluator, with ECMAScript's meaning on plain data; a text that shows values; bound
 * attributes and accessibility attributes; the props of a component — given, defaulted, or a boolean prop's HTML meaning. (What changes after the first render is N2 onwards.)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { mountComponent } from 'obix-runtime-component';
import { array, attr, binary, bind, call, choice, component, el, index, lit, logical, member, object, prop, text, unary } from './ir.mjs';

function render(ir, props) {
  const document = new JSDOM('<!doctype html><html><body></body></html>').window.document;
  const target = document.createElement('div');
  document.body.append(target);
  mountComponent(ir, { target, props });
  return target;
}
/** The text a single expression shows, as the only content of a paragraph. */
const shown = (expression, props = {}, declared = Object.keys(props).map((name) => ({ name }))) =>
  render(component('Show', [el('p', {}, text(expression))], { props: declared }), props).querySelector('p').textContent;

test('a text runs its static parts and the values it shows together, each value as the IR says a text shows it', () => {
  const ir = component('Card', [el('p', {}, text('Hello, ', prop('name'), '! You have ', prop('count'), ' new ', prop('what'), '.'))], { props: [{ name: 'name' }, { name: 'count' }, { name: 'what' }] });
  assert.equal(render(ir, { name: 'Ada', count: 3, what: 'messages' }).innerHTML, '<p>Hello, Ada! You have 3 new messages.</p>');
  assert.equal(shown(prop('v'), { v: null }), '');
  assert.equal(shown(prop('v'), { v: undefined }), '');
  assert.equal(shown(prop('v'), { v: true }), 'true');
  assert.equal(shown(prop('v'), { v: [1, 'a'] }), '[\n  1,\n  "a"\n]');
  assert.equal(shown(prop('v'), { v: { a: { b: 2 } } }), '{\n  "a": {\n    "b": 2\n  }\n}');
});

test('literals, arrays and objects', () => {
  assert.equal(shown(lit('s')), 's');
  assert.equal(shown(lit(null)), '');
  assert.equal(shown(lit(false)), 'false');
  assert.equal(shown(array(lit(1), lit('two'), array())), '[\n  1,\n  "two",\n  []\n]');
  assert.equal(shown(object({ a: lit(1), b: array(lit(true)) })), '{\n  "a": 1,\n  "b": [\n    true\n  ]\n}');
  assert.equal(shown(unary('-', lit(0))), '0', 'minus zero shows as 0');
});

test('member and index access, as ECMAScript reads them', () => {
  const user = { name: 'Ada', tags: ['x', 'y'], 'odd key': 7 };
  assert.equal(shown(member(prop('u'), 'name'), { u: user }), 'Ada');
  assert.equal(shown(index(member(prop('u'), 'tags'), lit(1)), { u: user }), 'y');
  assert.equal(shown(index(prop('u'), lit('odd key')), { u: user }), '7');
  assert.equal(shown(member(member(prop('u'), 'tags'), 'length'), { u: user }), '2');
  assert.equal(shown(member(prop('s'), 'length'), { s: 'four' }), '4');
  assert.equal(shown(member(prop('u'), 'missing'), { u: user }), '', 'undefined shows as nothing');
});

test('unary, binary and choice operators have ECMAScript\'s meaning', () => {
  const cases = [
    [unary('!', lit(0)), 'true'], [unary('-', lit('3')), '-3'], [unary('+', lit('4')), '4'],
    [binary('+', lit(1), lit(2)), '3'], [binary('+', lit('1'), lit(2)), '12'], [binary('-', lit(5), lit(7)), '-2'], [binary('*', lit(3), lit(4)), '12'],
    [binary('/', lit(1), lit(0)), 'Infinity'], [binary('/', lit(0), lit(0)), 'NaN'], [binary('%', lit(-7), lit(3)), '-1'],
    [binary('===', lit(1), lit('1')), 'false'], [binary('!==', lit(1), lit('1')), 'true'], [binary('<', lit('a'), lit('b')), 'true'], [binary('<=', lit(2), lit(2)), 'true'],
    [binary('>', lit(1), lit(2)), 'false'], [binary('>=', lit(null), lit(0)), 'true'],
    [choice(lit(''), lit('yes'), lit('no')), 'no'], [choice(lit('x'), lit('yes'), lit('no')), 'yes'],
  ];
  for (const [expression, expected] of cases) assert.equal(shown(expression), expected, JSON.stringify(expression));
});

test('logical operators short-circuit: the right side is not evaluated when the left decides', () => {
  // reading a member of undefined would throw: the right side must not be read
  const boom = member(member(prop('nothing'), 'deep'), 'deeper');
  assert.equal(shown(logical('&&', lit(0), boom), { nothing: undefined }), '0');
  assert.equal(shown(logical('||', lit('left'), boom), { nothing: undefined }), 'left');
  assert.equal(shown(logical('??', lit(false), boom), { nothing: undefined }), 'false');
  assert.equal(shown(logical('??', lit(null), lit('right'))), 'right');
  assert.equal(shown(logical('&&', lit(1), lit('right'))), 'right');
  assert.throws(() => shown(logical('||', lit(0), boom), { nothing: undefined }), TypeError, 'when the left does not decide, the right is evaluated — and a member of undefined throws, as in ECMAScript');
});

test('the call of an intrinsic function: round is Math.round', () => {
  for (const [value, expected] of [[2.5, '3'], [-2.5, '-2'], [-7.5, '-7'], [0.49, '0'], ['3.6', '4'], [NaN, 'NaN'], [Infinity, 'Infinity']]) {
    assert.equal(shown(call('round', prop('n')), { n: value }), expected, String(value));
  }
});

test('bound attributes and bound accessibility attributes are written by the attribute rules', () => {
  const ir = component('Button', [
    el('button', {
      attributes: [attr('type', 'button')],
      properties: [bind('title', prop('label')), bind('disabled', prop('off')), bind('data-count', prop('count')), bind('data-gone', lit(null))],
      a11y: { attributes: [attr('role', 'switch')], properties: [bind('aria-checked', prop('on')), bind('aria-label', prop('label'))] },
    }, text(prop('label'))),
  ], { props: [{ name: 'label' }, { name: 'off' }, { name: 'count' }, { name: 'on' }] });
  const button = render(ir, { label: 'Power', off: false, count: 2, on: true }).querySelector('button');
  assert.deepEqual(Object.fromEntries([...button.attributes].map((a) => [a.name, a.value])), { type: 'button', title: 'Power', 'data-count': '2', role: 'switch', 'aria-checked': 'true', 'aria-label': 'Power' });
  assert.equal(button.disabled, false);
});

test('when several writers name one attribute, the last in the IR\'s order — attributes, bound attributes, accessibility attributes, bound accessibility attributes — decides it', () => {
  const ir = component('Order', [
    el('p', { attributes: [attr('title', 'fixed'), attr('lang', 'en')], properties: [bind('title', prop('t')), bind('lang', lit(null))], a11y: { attributes: [attr('role', 'note')], properties: [bind('role', prop('r'))] } }),
  ], { props: [{ name: 't' }, { name: 'r' }] });
  const p = render(ir, { t: 'bound', r: undefined }).querySelector('p');
  assert.equal(p.getAttribute('title'), 'bound');
  assert.equal(p.hasAttribute('lang'), false, 'a later null takes away an earlier fixed value');
  assert.equal(p.hasAttribute('role'), false);
});

test('props: a given input, its default when it is not given (undefined is not given), undefined when there is neither', () => {
  const ir = component('Props', [el('p', {}, text(prop('a'), '|', prop('b'), '|', prop('c')))], {
    props: [{ name: 'a', default: lit('A') }, { name: 'b', default: array(lit(1)) }, { name: 'c' }],
  });
  assert.equal(render(ir, {}).querySelector('p').textContent, 'A|[\n  1\n]|');
  assert.equal(render(ir, { a: 'given', b: undefined, c: 0 }).querySelector('p').textContent, 'given|[\n  1\n]|0');
});

test('a boolean prop means what an HTML boolean attribute means: absent is false (unless it has a default), the empty string or its own hyphenated name is true', () => {
  const ir = component('Flags', [el('p', {}, text(prop('isOn'), ',', prop('withDefault')))], {
    props: [{ name: 'isOn', type: 'boolean' }, { name: 'withDefault', type: 'boolean', default: lit(true) }],
  });
  const of = (props) => render(ir, props).querySelector('p').textContent;
  assert.equal(of({}), 'false,true');
  assert.equal(of({ isOn: '', withDefault: false }), 'true,false');
  assert.equal(of({ isOn: 'is-on' }), 'true,true');
  assert.equal(of({ isOn: 'yes' }), 'yes,true', 'any other string is given as it is');
});

test('an input the component does not declare is refused, and nothing is rendered', () => {
  const document = new JSDOM('').window.document;
  const target = document.createElement('div');
  const ir = component('Strict', [el('p', {}, text(prop('a')))], { props: [{ name: 'a' }] });
  assert.throws(() => mountComponent(ir, { target, props: { a: 1, b: 2 } }), (error) => error.code === 'OBIX_RUNTIME_INPUT' && /Strict/.test(error.message) && /\bb\b/.test(error.message));
  assert.equal(target.childNodes.length, 0);
});

