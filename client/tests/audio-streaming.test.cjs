const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const hookCode = ts.transpileModule(fs.readFileSync('src/hooks/useAudioStreaming.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function harness(pending = {}) {
  const states = [], contexts = [], worklets = [], sockets = [], timers = new Map();
  let cleanup;
  const track = { stopped: false, stop() { this.stopped = true; } };
  const stream = { getTracks: () => [track] };
  class Context {
    state = pending.resume ? 'suspended' : 'running';
    closed = false;
    audioWorklet = { addModule: () => pending.module?.promise ?? Promise.resolve() };
    constructor() { contexts.push(this); }
    resume() { return pending.resume?.promise ?? Promise.resolve(); }
    async close() { this.closed = true; }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
  }
  class Worklet {
    port = { onmessage: null, postMessage: value => { this.request = value; } };
    constructor() { worklets.push(this); }
    disconnect() {}
    emit(data) { this.port.onmessage?.({ data }); }
  }
  class Socket {
    static OPEN = 1;
    readyState = 1;
    sent = [];
    constructor() { sockets.push(this); }
    send(value) { this.sent.push(value); }
    close() { this.readyState = 3; this.onclose?.(); }
    emit(data) { this.onmessage?.({ data: JSON.stringify(data) }); }
  }
  const react = {
    useState(value) { const i = states.length; states.push(value); return [value, next => { states[i] = typeof next === 'function' ? next(states[i]) : next; }]; },
    useRef: current => ({ current }), useCallback: fn => fn,
    useEffect(fn) { cleanup = fn(); },
  };
  const exports = {};
  vm.runInNewContext(hookCode, {
    exports, require: name => name === 'react' ? react : { getStreamingToken: () => pending.token?.promise ?? Promise.resolve('synthetic') },
    navigator: { mediaDevices: { getUserMedia: () => pending.microphone?.promise ?? Promise.resolve(stream) } },
    window: { AudioContext: Context, setInterval: () => 1 }, AudioWorkletNode: Worklet, WebSocket: Socket,
    ArrayBuffer, console: { error() {}, warn() {} }, clearInterval() {},
    setTimeout(fn, ms) { timers.set(ms, fn); return ms; }, clearTimeout(id) { timers.delete(id); },
  });
  return { hook: exports.useAudioStreaming(), states, stream, track, contexts, worklets, sockets, timers, unmount: () => cleanup() };
}
for (const stage of ['microphone', 'resume', 'module', 'token']) {
  test(`unmount cancels startup pending ${stage}`, async () => {
    const pending = deferred();
    const h = harness({ [stage]: pending });
    const start = h.hook.startStreaming();
    await tick();
    const before = [h.contexts.length, h.worklets.length, h.sockets.length];
    h.unmount();
    pending.resolve(stage === 'microphone' ? h.stream : 'synthetic');
    await start;
    assert.deepEqual([h.contexts.length, h.worklets.length, h.sockets.length], before);
    assert.equal(h.track.stopped, true);
    assert.ok(h.contexts.every(context => context.closed));
  });
}
async function recording() {
  const h = harness();
  await h.hook.startStreaming();
  await h.sockets[0].onopen();
  return h;
}
test('tail precedes Terminate and final transcript waits for Termination', async () => {
  const h = await recording(), ws = h.sockets[0], worklet = h.worklets[0];
  const stop = h.hook.stopStreaming();
  let done = false; stop.then(() => { done = true; });
  assert.equal(worklet.request, 'flush');
  assert.equal(ws.sent.length, 0);
  const tail = new ArrayBuffer(4);
  worklet.emit(tail);
  worklet.emit({ type: 'FLUSH_COMPLETE' });
  await tick();
  assert.equal(ws.sent[0], tail);
  assert.deepEqual(JSON.parse(ws.sent[1]), { type: 'Terminate' });
  assert.equal(done, false);
  ws.emit({ type: 'Turn', transcript: 'last words', end_of_turn: true });
  ws.emit({ type: 'Termination' });
  ws.close();
  assert.equal(await stop, 'last words');
  assert.equal(h.contexts[0].closed, true);
});
for (const stage of ['flush', 'termination']) {
  test(`${stage} timeout refuses partial transcript and releases resources`, async () => {
    const h = await recording();
    h.sockets[0].emit({ type: 'Turn', transcript: 'partial', end_of_turn: false });
    const stop = h.hook.stopStreaming();
    if (stage === 'termination') {
      h.worklets[0].emit({ type: 'FLUSH_COMPLETE' });
      await tick();
    }
    h.timers.get(stage === 'flush' ? 2000 : 5000)();
    assert.equal(await stop, null);
    assert.match(h.states[5], /finalization incomplete/);
    assert.equal(h.contexts[0].closed, true);
    assert.equal(h.sockets[0].readyState, 3);
    assert.equal(h.timers.size, 0);
  });
}
test('worklet acknowledges empty and nonempty tails after forwarding PCM', () => {
  let Processor;
  vm.runInNewContext(fs.readFileSync('public/pcm-processor.js', 'utf8'), {
    AudioWorkletProcessor: class { port = { postMessage: data => this.messages.push(data) }; messages = []; },
    sampleRate: 16000, registerProcessor: (_, klass) => { Processor = klass; },
  });
  for (const samples of [[], [0.5, -0.5]]) {
    const processor = new Processor();
    processor.process([[new Float32Array(samples)]]);
    processor.port.onmessage({ data: 'flush' });
    assert.equal(processor.messages.at(-1).type, 'FLUSH_COMPLETE');
    if (samples.length) assert.deepEqual([...new Int16Array(processor.messages[0])], [16384, -16384]);
    assert.equal(processor.messages.length, samples.length ? 2 : 1);
    assert.equal(processor.process([[new Float32Array([1])]]), false);
  }
});
test('stop during token startup cancels socket creation', async () => {
  const token = deferred(), h = harness({ token });
  const start = h.hook.startStreaming();
  await tick();
  assert.equal(await h.hook.stopStreaming(), null);
  token.resolve('synthetic');
  await start;
  assert.equal(h.sockets.length, 0);
  assert.equal(h.track.stopped, true);
  assert.equal(h.contexts[0].closed, true);
});
test('unmount releases a pending flush without finalizing a transcript', async () => {
  const h = await recording();
  const stop = h.hook.stopStreaming();
  h.unmount();
  assert.equal(await stop, null);
  assert.equal(h.timers.size, 0);
});
test('socket closing before Termination refuses partial transcript', async () => {
  const h = await recording();
  const stop = h.hook.stopStreaming();
  h.worklets[0].emit({ type: 'FLUSH_COMPLETE' });
  await tick();
  h.sockets[0].close();
  assert.equal(await stop, null);
  assert.match(h.states[5], /finalization incomplete/);
});
