// Generates the Demo mode meeting audio from packages/shared/src/demo/meeting.json using macOS `say`.
// Outputs:
//   apps/web/public/demo/meeting.m4a            (played by the browser)
//   packages/shared/src/demo/timeline.json      (per-line timings, used by mock STT + offline demo)
//   scripts/.demo-tmp/meeting.wav               (24 kHz PCM16, handy for testing real STT)
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const meeting = JSON.parse(readFileSync(join(root, "packages/shared/src/demo/meeting.json"), "utf8"));
const tmp = join(root, "scripts/.demo-tmp");
mkdirSync(tmp, { recursive: true });
mkdirSync(join(root, "apps/web/public/demo"), { recursive: true });

const RATE = 24_000;
const BYTES_PER_MS = (RATE * 2) / 1000;
const LEAD_IN_MS = 800;
const GAP_SAME_SPEAKER_MS = 450;
const GAP_NEW_SPEAKER_MS = 750;

/** Returns the PCM payload of a WAV file (skips RIFF chunks until "data"). */
function wavData(buf) {
  let off = 12;
  while (off + 8 <= buf.length) {
    const id = buf.toString("ascii", off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === "data") return buf.subarray(off + 8, off + 8 + size);
    off += 8 + size + (size % 2);
  }
  throw new Error("no data chunk");
}

function wavHeader(dataBytes) {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + dataBytes, 4);
  h.write("WAVE", 8);
  h.write("fmt ", 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(RATE, 24);
  h.writeUInt32LE(RATE * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(dataBytes, 40);
  return h;
}

const silence = (ms) => Buffer.alloc(Math.round(ms * BYTES_PER_MS / 2) * 2);

const parts = [silence(LEAD_IN_MS)];
let cursorMs = LEAD_IN_MS;
let prevSpeaker = null;
const lines = meeting.lines.map((line, i) => {
  const voice = meeting.speakers[line.speaker].voice;
  const file = join(tmp, `line-${i}.wav`);
  execFileSync("say", ["-v", voice, "-r", "178", "--file-format=WAVE", "--data-format=LEI16@24000", "-o", file, line.text]);
  const pcm = wavData(readFileSync(file));
  if (i > 0) {
    const gap = line.speaker === prevSpeaker ? GAP_SAME_SPEAKER_MS : GAP_NEW_SPEAKER_MS;
    parts.push(silence(gap));
    cursorMs += gap;
  }
  const startMs = cursorMs;
  const durMs = Math.round(pcm.length / BYTES_PER_MS);
  parts.push(pcm);
  cursorMs += durMs;
  prevSpeaker = line.speaker;
  return { speaker: line.speaker, text: line.text, startMs, endMs: cursorMs };
});
parts.push(silence(1500));
cursorMs += 1500;

const pcm = Buffer.concat(parts);
const wavPath = join(tmp, "meeting.wav");
writeFileSync(wavPath, Buffer.concat([wavHeader(pcm.length), pcm]));
execFileSync("afconvert", ["-f", "m4af", "-d", "aac", "-b", "64000", wavPath, join(root, "apps/web/public/demo/meeting.m4a")]);
writeFileSync(
  join(root, "packages/shared/src/demo/timeline.json"),
  JSON.stringify({ durationMs: cursorMs, lines }, null, 2) + "\n",
);
console.log(`Demo audio: ${(cursorMs / 1000).toFixed(1)} s, ${lines.length} lines`);
