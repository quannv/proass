import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { WebSocketServer } from "ws";
import { MuseSTTProvider } from "./MuseSTTProvider";

/** Waits on real socket I/O (setImmediate is not mocked) until `cond` holds. */
async function until(cond: () => boolean, label: string): Promise<void> {
  for (let i = 0; i < 5000 && !cond(); i++) await new Promise((r) => setImmediate(r));
  assert.ok(cond(), label);
}

test("a mid-session outage that exhausts reconnects is reported as fatal", async (t) => {
  // First connection handshakes then drops; every reconnect is refused.
  let connections = 0;
  const wss = new WebSocketServer({ port: 0 });
  wss.on("connection", (ws) => {
    connections++;
    if (connections === 1) ws.once("message", () => ws.send(JSON.stringify({ sessionId: "s1" })));
    else ws.close(1011, "down");
  });
  await new Promise((r) => wss.once("listening", r));
  const { port } = wss.address() as { port: number };
  t.after(() => wss.close());

  mock.timers.enable({ apis: ["setTimeout"] });
  t.after(() => mock.timers.reset());

  const errors: { fatal: boolean; message: string }[] = [];
  const stt = new MuseSTTProvider({ apiKey: "k", url: `ws://127.0.0.1:${port}`, model: "m", mode: "ENDPOINTING", keywords: [], languageBias: [] });
  await stt.start({ onPartial() {}, onFinal() {}, onError: (e, fatal) => errors.push({ fatal, message: e.message }) });

  for (const c of wss.clients) c.close(1011, "boom");
  // 6 reconnect attempts with backoff (max 8 s each).
  for (let i = 0; i < 8 && !errors.some((e) => e.fatal); i++) {
    await until(() => errors.length > i, `reconnect notice ${i}`);
    mock.timers.tick(8000);
  }
  await until(() => errors.some((e) => e.fatal), "fatal error reported");
  assert.equal(connections, 7);
  assert.match(errors.at(-1)!.message, /unavailable/);
  await stt.stop();
});
