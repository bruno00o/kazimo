import { CAPTURE_SAMPLE_RATE } from "@kazimo/shared";

const FRAME_SAMPLES = 1280;

const workletSource = `
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frame = new Int16Array(${FRAME_SAMPLES});
    this.offset = 0;
  }
  process(inputs) {
    const channel = inputs[0][0];
    if (!channel) return true;
    for (let i = 0; i < channel.length; i++) {
      const sample = Math.max(-1, Math.min(1, channel[i]));
      this.frame[this.offset++] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      if (this.offset === this.frame.length) {
        this.port.postMessage(this.frame.slice().buffer);
        this.offset = 0;
      }
    }
    return true;
  }
}
registerProcessor("capture", CaptureProcessor);
`;

export interface MicCapture {
  stop: () => void;
}

async function micStream(label: string | null): Promise<MediaStream> {
  const fallback = await navigator.mediaDevices.getUserMedia({ audio: true });
  if (!label) return fallback;
  const devices = await navigator.mediaDevices.enumerateDevices();
  const match = devices.find(
    (device) => device.kind === "audioinput" && device.label.toLowerCase().includes(label.toLowerCase()),
  );
  if (!match) return fallback;
  for (const track of fallback.getTracks()) track.stop();
  return navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: match.deviceId } } });
}

export async function startMicCapture(
  label: string | null,
  onFrame: (frame: ArrayBuffer) => void,
): Promise<MicCapture> {
  const stream = await micStream(label);
  const context = new AudioContext({ sampleRate: CAPTURE_SAMPLE_RATE });
  const workletUrl = URL.createObjectURL(new Blob([workletSource], { type: "text/javascript" }));
  try {
    await context.audioWorklet.addModule(workletUrl);
  } finally {
    URL.revokeObjectURL(workletUrl);
  }
  const source = context.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(context, "capture");
  node.port.onmessage = (event) => onFrame(event.data as ArrayBuffer);
  source.connect(node);

  return {
    stop() {
      node.port.onmessage = null;
      source.disconnect();
      node.disconnect();
      for (const track of stream.getTracks()) track.stop();
      void context.close();
    },
  };
}
