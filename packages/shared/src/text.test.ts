import assert from "node:assert/strict";
import { test } from "node:test";
import { clampWords, countWords, formatClock, quoteCoverage, similarity } from "./text";
import { DEMO_LINES, createScriptPlayer } from "./demo";

test("text helpers", () => {
  assert.equal(countWords("Hello, world! Xin chào"), 4);
  assert.equal(similarity("SOC 2 Type 2", "soc 2 type 2"), 1);
  assert.ok(similarity("GDPR fines", "Pricing for small teams") < 0.2);
  assert.equal(quoteCoverage("maximum fine is", "I told them the maximum fine is one million"), 1);
  assert.equal(clampWords("a b c d", 2), "a b…");
  assert.equal(formatClock(65_000), "01:05");
  assert.equal(formatClock(3_725_000), "1:02:05");
});

test("script player emits partials then one final per line", () => {
  const player = createScriptPlayer(DEMO_LINES.slice(0, 2), "t");
  const finals: string[] = [];
  let partials = 0;
  for (let t = 0; t <= DEMO_LINES[1]!.endMs + 1000; t += 100) {
    for (const e of player.advance(t)) e.type === "final" ? finals.push(e.segment.id) : partials++;
  }
  assert.deepEqual(finals, ["t-0", "t-1"]);
  assert.ok(partials > 10);
  assert.ok(player.done);
});
