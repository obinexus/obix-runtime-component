/**
 * N11 (found by AnyTune's PitchMeter) — namespaces: an `svg` element and everything inside it are SVG elements, a `math` element and everything inside it MathML elements, and
 * the content of a `foreignObject` is HTML again — as an HTML parser makes them, and as a browser needs them to draw them. The namespace follows the view wherever it goes: into
 * a conditional, an iteration, a component invoked inside an `svg`, and content projected there.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { mountComponent } from 'obix-runtime-component';
import { attr, bind, branch, component, conditional, content, el, invocation, iteration, lit, local, projection, prop, text } from './ir.mjs';

const SVG = 'http://www.w3.org/2000/svg';
const HTML = 'http://www.w3.org/1999/xhtml';
const MATHML = 'http://www.w3.org/1998/Math/MathML';

function host() {
  const document = new JSDOM('<!doctype html><html><body></body></html>').window.document;
  const target = document.createElement('div');
  document.body.append(target);
  return target;
}

test('an svg element and what is inside it are SVG elements, with their attributes as written; what is beside it stays HTML', () => {
  const target = host();
  const ir = component('Meter', [
    el('div', { a11y: { attributes: [attr('role', 'meter')] } },
      el('svg', { attributes: [attr('viewBox', '0 0 100 10'), attr('preserveAspectRatio', 'none')] },
        el('line', { attributes: [attr('x1', '50')], properties: [bind('x2', prop('x'))] })),
      el('span', {}, text('beside'))),
  ], { props: [{ name: 'x' }] });
  mountComponent(ir, { target, props: { x: 42 } });
  const svg = target.querySelector('svg');
  const line = target.querySelector('line');
  assert.equal(svg.namespaceURI, SVG);
  assert.equal(line.namespaceURI, SVG);
  assert.equal(svg.getAttribute('viewBox'), '0 0 100 10', 'the case of an SVG attribute is kept');
  assert.equal(line.getAttribute('x2'), '42');
  assert.equal(target.querySelector('div').namespaceURI, HTML);
  assert.equal(target.querySelector('span').namespaceURI, HTML);
});

test('the content of a foreignObject is HTML again; a math element and what is inside it are MathML', () => {
  const target = host();
  const ir = component('Mixed', [
    el('svg', {}, el('foreignObject', {}, el('p', {}, text('html inside')))),
    el('math', {}, el('mi', {}, text('x'))),
  ]);
  mountComponent(ir, { target });
  assert.equal(target.querySelector('foreignObject').namespaceURI, SVG);
  assert.equal(target.querySelector('p').namespaceURI, HTML);
  assert.equal(target.querySelector('math').namespaceURI, MATHML);
  assert.equal(target.querySelector('mi').namespaceURI, MATHML);
});

test('the namespace follows the view into conditionals, iterations, invoked components and projected content', () => {
  const target = host();
  const Mark = component('Mark', [el('circle', { attributes: [attr('r', '1')] }), projection('default')]);
  const ir = component('Chart', [
    el('svg', {},
      conditional([branch(lit(true), el('rect', {}))]),
      iteration(prop('points'), 'p', [el('g', { properties: [bind('data-p', local('p'))] })], { key: local('p') }),
      invocation('Mark', { children: [content('default', [el('text', {}, text('label'))])] })),
  ], { props: [{ name: 'points' }], dependencies: { Mark: './Mark' } });
  mountComponent(ir, { target, props: { points: [1, 2] }, registry: { './Mark': Mark } });
  for (const tag of ['rect', 'g', 'circle', 'text']) {
    const found = [...target.querySelectorAll(tag)];
    assert.ok(found.length > 0, tag);
    for (const element of found) assert.equal(element.namespaceURI, SVG, tag);
  }
});

test('a component invoked outside an svg makes HTML elements, even if one of the same name is drawn inside one elsewhere', () => {
  const target = host();
  const Label = component('Label', [el('text', {}, text('plain'))]);
  const ir = component('Two', [invocation('Label'), el('svg', {}, invocation('Label'))], { dependencies: { Label: './Label' } });
  mountComponent(ir, { target, registry: { './Label': Label } });
  const [outside, inside] = target.querySelectorAll('text');
  assert.equal(outside.namespaceURI, HTML);
  assert.equal(inside.namespaceURI, SVG);
});

test('a component mounted in an svg draws SVG; one mounted in a foreignObject draws HTML', () => {
  const document = new JSDOM('<!doctype html><html><body><svg><foreignObject></foreignObject></svg></body></html>').window.document;
  const svg = document.querySelector('svg');
  mountComponent(component('Dot', [el('circle', {})]), { target: svg });
  assert.equal(svg.querySelector('circle').namespaceURI, SVG);
  const foreign = document.querySelector('foreignObject');
  mountComponent(component('Para', [el('p', {})]), { target: foreign });
  assert.equal(foreign.querySelector('p').namespaceURI, HTML);
});
