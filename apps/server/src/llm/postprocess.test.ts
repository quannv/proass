import assert from "node:assert/strict";
import { test } from "node:test";
import { SUGGESTION_TYPES } from "@proass/shared";
import { postProcess } from "./postprocess";

const recent = [
  { id: "s1", text: "They will not sign until we have SOC 2 Type 2.", startMs: 0, endMs: 1000 },
  { id: "s2", text: "I told them the maximum fine is one million euros.", startMs: 1000, endMs: 2000 },
];
const base = { recent, shown: [], enabledTypes: [...SUGGESTION_TYPES], minConfidence: 0.6, maxItems: 3 };
const item = (o: Record<string, unknown> = {}) => ({
  type: "fact_check",
  title: "GDPR fines are far higher",
  body: "Up to 20 million euros or 4% of turnover.",
  trigger_quote: "the maximum fine is one million euros",
  confidence: 0.9,
  ...o,
});

test("keeps valid items and anchors them to the quoted segment", () => {
  const [s] = postProcess([item()], base);
  assert.equal(s?.segmentId, "s2");
});

test("drops malformed, disabled, low-confidence and duplicate items", () => {
  const out = postProcess(
    [
      { type: "nonsense", title: "x" },
      item({ confidence: 0.3 }),
      item({ type: "definition", title: "SOC 2 explained", trigger_quote: "SOC 2 Type 2" }),
      item(),
      item({ title: "GDPR fines are far higher!" }),
    ],
    { ...base, enabledTypes: ["fact_check"] },
  );
  assert.deepEqual(out.map((s) => s.title), ["GDPR fines are far higher"]);
});

test("skips items already shown", () => {
  const out = postProcess([item()], { ...base, shown: [{ type: "fact_check", title: "GDPR fines are far higher" }] });
  assert.equal(out.length, 0);
});

test("penalizes quotes not found in the transcript", () => {
  const out = postProcess([item({ trigger_quote: "something nobody said", confidence: 0.7 })], base);
  assert.equal(out.length, 0);
});

test("keeps at most one item per type, highest confidence first", () => {
  const out = postProcess(
    [item({ confidence: 0.7, title: "Check the fine amount" }), item({ title: "GDPR fines are far higher", confidence: 0.95 })],
    base,
  );
  assert.deepEqual(out.map((s) => s.title), ["GDPR fines are far higher"]);
});
