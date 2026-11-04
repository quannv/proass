import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { resolveTriggerConfig } from "@proass/shared";
import { TriggerEngine } from "./TriggerEngine";

const cfg = resolveTriggerConfig("medium", { minWords: 20, minWordsOnPause: 5, pauseMs: 2000, debounceMs: 500, minIntervalMs: 9000 });
const flush = () => new Promise((r) => setImmediate(r));

function setup() {
  mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const calls: number[] = [];
  const signals: AbortSignal[] = [];
  const finish: (() => void)[] = [];
  const engine = new TriggerEngine(() => cfg, async (signal) => {
    calls.push(Date.now());
    signals.push(signal);
    await new Promise<void>((r) => finish.push(r)); // resolved by the test
  });
  return { engine, calls, signals, finish };
}

test("fires after enough words, debounced", async (t) => {
  t.after(() => mock.timers.reset());
  const { engine, calls } = setup();
  engine.onFinal(12);
  engine.onFinal(10);
  mock.timers.tick(499);
  assert.equal(calls.length, 0);
  mock.timers.tick(1);
  await flush();
  assert.deepEqual(calls, [500]);
  engine.dispose();
});

test("fires on a natural pause, postponed while partials arrive", async (t) => {
  t.after(() => mock.timers.reset());
  const { engine, calls } = setup();
  engine.onFinal(6);
  mock.timers.tick(1500);
  engine.onPartial(); // still talking
  mock.timers.tick(1500);
  assert.equal(calls.length, 0);
  mock.timers.tick(500);
  await flush();
  assert.equal(calls.length, 1);
  engine.dispose();
});

test("respects min interval between calls", async (t) => {
  t.after(() => mock.timers.reset());
  const { engine, calls, finish } = setup();
  engine.onFinal(25);
  mock.timers.tick(500);
  await flush();
  finish[0]!();
  await flush();
  engine.onFinal(25);
  mock.timers.tick(5000);
  await flush();
  assert.equal(calls.length, 1, "blocked by min interval");
  mock.timers.tick(4000);
  await flush();
  assert.equal(calls.length, 2);
  assert.equal(calls[1]! - calls[0]!, 9000);
  engine.dispose();
});

test("a slow call is never aborted by newer speech; the next call waits for it", async (t) => {
  t.after(() => mock.timers.reset());
  const { engine, calls, signals, finish } = setup();
  engine.onFinal(25);
  mock.timers.tick(500);
  await flush();
  assert.equal(calls.length, 1);
  // Continuous speech while the call (e.g. one with a web search) takes 14 s.
  for (let i = 0; i < 14; i++) {
    engine.onFinal(10);
    mock.timers.tick(1000);
    await flush();
  }
  assert.equal(calls.length, 1, "no overlapping call");
  assert.equal(signals[0]!.aborted, false, "in-flight call kept");
  finish[0]!();
  await flush();
  await flush();
  mock.timers.tick(0);
  await flush();
  assert.equal(calls.length, 2, "queued words fire right after the slow call");
  engine.dispose();
  assert.equal(signals[1]!.aborted, true, "dispose aborts the in-flight call");
});

test("ignores too few words", async (t) => {
  t.after(() => mock.timers.reset());
  const { engine, calls } = setup();
  engine.onFinal(3);
  mock.timers.tick(20_000);
  await flush();
  assert.equal(calls.length, 0);
  engine.dispose();
});
