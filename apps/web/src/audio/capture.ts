export type AudioSource = "mic" | "tab" | "mic+tab" | "demo";

export interface CaptureOptions {
  source: AudioSource;
  deviceId?: string;
  demoUrl?: string;
  onChunk: (pcm: ArrayBuffer) => void;
  onLevel: (rms: number) => void;
  /** The source went away (tab sharing stopped, demo finished, mic unplugged). */
  onEnded: (reason: "tab_ended" | "demo_ended" | "mic_ended") => void;
  /** The chosen mic is no longer available; the default mic is used instead. */
  onDeviceFallback?: () => void;
}

export interface CaptureHandle {
  stop(): void;
  /** Present for the demo source; used to drive the offline demo clock. */
  audio?: HTMLAudioElement;
}

/** Friendly messages for getUserMedia/getDisplayMedia failures. */
export class CaptureError extends Error {}

function describe(err: unknown, what: "mic" | "tab" | "demo"): CaptureError {
  const name = (err as DOMException)?.name;
  if (what === "tab" && name === "NotAllowedError") return new CaptureError("Tab sharing was cancelled or blocked.");
  if (name === "NotAllowedError") return new CaptureError("Microphone permission was denied. Allow it in the browser's address bar and try again.");
  if (name === "NotFoundError" || name === "OverconstrainedError") return new CaptureError("No microphone found. Plug one in or pick another device in Settings.");
  if (name === "NotReadableError") return new CaptureError("The microphone is being used by another app.");
  if (err instanceof CaptureError) return err;
  return new CaptureError(`Couldn't start ${what} audio: ${(err as Error)?.message ?? err}`);
}

/**
 * Starts the chosen audio source and streams 24 kHz PCM16 chunks (100 ms) via an AudioWorklet.
 * Call from a user gesture (Start button): tab capture and audio playback require it.
 */
export async function startCapture(opts: CaptureOptions): Promise<CaptureHandle> {
  const streams: MediaStream[] = [];
  let audio: HTMLAudioElement | undefined;
  const ctx = new AudioContext({ latencyHint: "interactive" });
  const cleanup = () => {
    streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    audio?.pause();
    void ctx.close().catch(() => {});
  };

  try {
    // Ask for permissions first, while the click's user activation is still fresh.
    if (opts.source === "tab" || opts.source === "mic+tab") {
      if (!navigator.mediaDevices?.getDisplayMedia) throw new CaptureError("Tab audio capture isn't supported in this browser. Use Chrome or Edge.");
      const tab = await navigator.mediaDevices
        .getDisplayMedia({
          video: true, // Chrome requires video to offer the "share tab audio" option
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
          systemAudio: "include",
        } as DisplayMediaStreamOptions)
        .catch((e) => {
          throw describe(e, "tab");
        });
      tab.getVideoTracks().forEach((t) => t.stop());
      const track = tab.getAudioTracks()[0];
      if (!track) {
        tab.getTracks().forEach((t) => t.stop());
        throw new CaptureError('No audio was shared. Pick a browser tab and tick "Share tab audio".');
      }
      track.addEventListener("ended", () => opts.onEnded("tab_ended"));
      streams.push(tab);
    }
    if (opts.source === "mic" || opts.source === "mic+tab") {
      if (!navigator.mediaDevices?.getUserMedia) throw new CaptureError("Microphone access needs HTTPS (or localhost).");
      const getMic = (deviceId?: string) =>
        navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: deviceId ? { exact: deviceId } : undefined,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            channelCount: 1,
          },
        });
      const mic = await getMic(opts.deviceId)
        .catch((e: unknown) => {
          // The saved mic is gone (e.g. unplugged headset): fall back to the default one.
          const gone = e instanceof DOMException && (e.name === "OverconstrainedError" || e.name === "NotFoundError");
          if (!opts.deviceId || !gone) throw e;
          opts.onDeviceFallback?.();
          return getMic();
        })
        .catch((e) => {
          throw describe(e, "mic");
        });
      mic.getAudioTracks()[0]?.addEventListener("ended", () => opts.onEnded("mic_ended"));
      streams.push(mic);
    }

    await ctx.audioWorklet.addModule("/worklets/pcm-processor.js");
    const node = new AudioWorkletNode(ctx, "pcm-processor", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 1,
      channelCountMode: "explicit",
      channelInterpretation: "speakers", // downmix stereo tab audio to mono
    });
    node.port.onmessage = (e: MessageEvent<{ type: "audio"; pcm: ArrayBuffer } | { type: "level"; rms: number }>) => {
      if (e.data.type === "audio") opts.onChunk(e.data.pcm);
      else opts.onLevel(e.data.rms);
    };
    // Keep the graph pulled without making the mic audible.
    const silent = ctx.createGain();
    silent.gain.value = 0;
    node.connect(silent).connect(ctx.destination);

    for (const s of streams) ctx.createMediaStreamSource(s).connect(node);

    if (opts.source === "demo") {
      audio = new Audio(opts.demoUrl);
      audio.preload = "auto";
      const el = ctx.createMediaElementSource(audio);
      el.connect(node);
      el.connect(ctx.destination); // audible for the audience
      audio.addEventListener("ended", () => opts.onEnded("demo_ended"));
      await audio.play().catch((e) => {
        throw describe(e, "demo");
      });
    }
    await ctx.resume();
  } catch (err) {
    cleanup();
    throw err instanceof CaptureError ? err : describe(err, opts.source === "demo" ? "demo" : "mic");
  }

  return { stop: cleanup, audio };
}

/** Lists microphones; labels are only available after permission was granted once. */
export async function listMicrophones(): Promise<MediaDeviceInfo[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === "audioinput");
}
