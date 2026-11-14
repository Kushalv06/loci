const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, mocks, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: name => mocks[name], console: { error() {} }, ...globals });
  return exports;
}
function harness() {
  const states = [], refs = [], cleanups = [], pending = [], spoken = [];
  let si = 0, ri = 0, mounted = false;
  const audio = { isStreaming: false, isProcessing: false, errorMessage: null, clearError() { audio.errorMessage = null; }, startStreaming() {}, stopStreaming: async () => 'voice question' };
  const react = {
    useState(v) { const i = si++; if (!(i in states)) states[i] = v; return [states[i], v => { states[i] = v; }]; },
    useRef(v) { const i = ri++; return refs[i] ??= { current: v }; },
    useEffect(fn) { if (!mounted) cleanups.push(fn()); },
  };
  const jsx = (type, props) => ({ type, props });
  const { RecallView } = load('src/components/RecallView.tsx', {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx },
    '../hooks/useAudioStreaming': { useAudioStreaming: () => audio },
    '../hooks/useSpeechSynthesis': { useSpeechSynthesis: () => ({ speak: s => spoken.push(s), stop() {} }) },
    '../services/api': { askMemory: q => new Promise((resolve, reject) => pending.push({ q, resolve, reject })) },
  });
  function render() { si = ri = 0; const tree = RecallView(); mounted = true; return tree; }
  function nodes(tree) { return !tree || typeof tree !== 'object' ? [] : [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)]; }
  const find = type => nodes(render()).find(n => n.type === type);
  async function submit(q) { find('input').props.onChange({ target: { value: q } }); find('form').props.onSubmit({ preventDefault() {} }); }
  return { audio, states, pending, spoken, render, find, submit, unmount() { cleanups.forEach(fn => fn?.()); } };
}
const tick = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
test('successful question stays paired with its answer through pending and failed queries', async () => {
  const h = harness(); await h.submit('first'); h.pending[0].resolve({ answer: 'first answer', sources: [{ _id: '1', score: 1 }] }); await tick();
  await h.submit('second'); assert.equal(h.states[0], 'first'); assert.equal(h.states[1], 'first answer');
  h.pending[1].reject(new Error('failed')); await tick(); assert.equal(h.states[0], 'first'); assert.equal(h.states[1], 'first answer'); assert.equal(h.states[5], 'failed');
  await h.submit('third'); h.pending[2].resolve({ answer: 'third answer', sources: [] }); await tick(); assert.equal(h.states[0], 'third'); assert.equal(h.states[1], 'third answer');
});
for (const failure of [false, true]) test(`unmount ignores pending ${failure ? 'failure' : 'answer and speech'}`, async () => {
  const h = harness(); await h.submit('question'); h.unmount(); const before = JSON.stringify(h.states);
  if (failure) h.pending[0].reject(new Error('late')); else h.pending[0].resolve({ answer: 'late', sources: [] });
  await tick(); assert.equal(JSON.stringify(h.states), before); assert.equal(h.spoken.length, 0);
});
test('processing and streaming guard submissions; voice errors dismiss with query errors', async () => {
  const h = harness(); h.audio.isProcessing = true;
  assert.equal(h.find('input').props.disabled, true); assert.equal(h.find('button').props.disabled, true);
  assert.match(JSON.stringify(h.render()), /Initializing voice/);
  await h.submit('blocked'); assert.equal(h.pending.length, 0);
  h.audio.isProcessing = false; h.audio.isStreaming = true; await h.submit('blocked'); assert.equal(h.pending.length, 0);
  h.audio.isStreaming = false; h.audio.errorMessage = 'microphone denied'; h.states[5] = 'query failed';
  const tree = h.render(); assert.match(JSON.stringify(tree), /microphone denied/);
  tree.props.children.find(n => n?.props?.className === 'error-banner').props.children[1].props.onClick();
  assert.equal(h.audio.errorMessage, null); assert.equal(h.states[5], null);
});
test('speech retains meaningful symbols and bracketed values while removing Markdown wrappers', () => {
  let utterance;
  const { useSpeechSynthesis } = load('src/hooks/useSpeechSynthesis.ts', { react: { useState: v => [v, () => {}], useRef: v => ({ current: v }), useCallback: fn => fn, useEffect() {} } }, {
    window: { speechSynthesis: { cancel() {}, getVoices: () => [], speak: u => { utterance = u; } } }, SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } },
  });
  useSpeechSynthesis().speak('# Heading\nC# uses [1, 2] and issue #42 with snake_case. **Bold** and *italic* `code` [link](https://example.com).');
  assert.equal(utterance.text, 'Heading\nC# uses [1, 2] and issue #42 with snake_case. Bold and italic code link.');
});
