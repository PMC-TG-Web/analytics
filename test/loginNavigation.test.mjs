import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

// Exercise the actual handler without starting Auth0 or a browser.
function renderLogin(framed) {
  const calls = { navigation: [], windows: [], polling: 0 };
  const source = ts.createSourceFile('page.tsx', readFileSync(new URL('../src/app/login/page.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let handler;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'startLogin') handler = node.initializer;
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(handler, 'login handler exists');
  const onClick = vm.runInNewContext(`(${handler.getText(source)})`, {
    framed, returnTo: '/kpi?year=2026', setError() {}, setStatus() {},
    startAuthPolling: () => { calls.polling++; },
    window: {
      location: { assign: (url) => calls.navigation.push(url) },
      open: (...args) => calls.windows.push(args),
    },
    encodeURIComponent,
  });
  // Confirm both rendered controls use the handler under test.
  const buttons = [];
  function findButtons(node) {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(source) === 'button') {
      const click = node.openingElement.attributes.properties.find(prop => prop.name?.getText(source) === 'onClick');
      if (click?.initializer?.expression?.getText(source) === 'startLogin') {
        buttons.push({ props: { children: node.children.map(child => child.getText(source)).join('').trim(), onClick } });
      }
    }
    ts.forEachChild(node, findButtons);
  }
  findButtons(source);
  return { calls, buttons };
}

for (const label of ['Login with Email', 'Login with Procore']) {
  test(`${label} stays in the current tab outside Procore`, () => {
    const { calls, buttons } = renderLogin(false);
    buttons.find(button => button.props.children === label).props.onClick();
    assert.deepEqual(calls.navigation, ['/api/auth/login?returnTo=%2Fkpi%3Fyear%3D2026']);
    assert.deepEqual(calls.windows, []);
    assert.equal(calls.polling, 0);
  });
}

test('embedded sign-in keeps its completion tab and session polling', () => {
  const { calls, buttons } = renderLogin(true);
  buttons[0].props.onClick();
  assert.deepEqual(calls.navigation, []);
  assert.equal(calls.windows.length, 1);
  const [url, target] = calls.windows[0];
  assert.equal(target, 'analytics_auth_tab');
  assert.equal(new URL(url, 'https://app.example').searchParams.get('returnTo'),
    '/auth/complete?returnTo=%2Fkpi%3Fyear%3D2026&fallback=procore-app');
  assert.equal(calls.polling, 1);
});
