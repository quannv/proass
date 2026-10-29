// AudioWorklet: downmixed mono float input at the context rate → 24 kHz PCM16 LE chunks of 100 ms.
// Also reports an RMS level (~20 times per second) for the mic meter.
const TARGET_RATE = 24000;
const CHUNK_SAMPLES = TARGET_RATE / 10;
const LEVEL_EVERY_FRAMES = Math.round(sampleRate / 20);

class PcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / TARGET_RATE;
    this.input = new Float32Array(16384);
    this.len = 0;
    this.pos = 0; // fractional read position in `input`
    this.out = new Int16Array(CHUNK_SAMPLES);
    this.outLen = 0;
    this.levelSum = 0;
    this.levelFrames = 0;
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;

    this.input.set(ch, this.len);
    this.len += ch.length;
    for (let i = 0; i < ch.length; i++) this.levelSum += ch[i] * ch[i];
    this.levelFrames += ch.length;
    if (this.levelFrames >= LEVEL_EVERY_FRAMES) {
      this.port.postMessage({ type: "level", rms: Math.sqrt(this.levelSum / this.levelFrames) });
      this.levelSum = 0;
      this.levelFrames = 0;
    }

    const r = this.ratio;
    while (this.pos + r <= this.len) {
      let v;
      if (r >= 1) {
        // Downsampling: average the source span (box filter) to limit aliasing.
        const s = Math.floor(this.pos);
        const e = Math.max(s + 1, Math.floor(this.pos + r));
        let acc = 0;
        for (let i = s; i < e; i++) acc += this.input[i];
        v = acc / (e - s);
      } else {
        // Upsampling (rare: context below 24 kHz): linear interpolation.
        const i = Math.floor(this.pos);
        const f = this.pos - i;
        v = this.input[i] * (1 - f) + this.input[Math.min(i + 1, this.len - 1)] * f;
      }
      v = v > 1 ? 1 : v < -1 ? -1 : v;
      this.out[this.outLen++] = v < 0 ? v * 0x8000 : v * 0x7fff;
      if (this.outLen === CHUNK_SAMPLES) {
        this.port.postMessage({ type: "audio", pcm: this.out.buffer }, [this.out.buffer]);
        this.out = new Int16Array(CHUNK_SAMPLES);
        this.outLen = 0;
      }
      this.pos += r;
    }

    const consumed = Math.floor(this.pos);
    this.input.copyWithin(0, consumed, this.len);
    this.len -= consumed;
    this.pos -= consumed;
    return true;
  }
}

registerProcessor("pcm-processor", PcmProcessor);
