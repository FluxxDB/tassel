import { vi } from 'vitest';

export class FakeTrack extends EventTarget {
  kind = 'audio';
  enabled = true;
  readyState = 'live';
  constructor(readonly deviceId = 'mic-1') {
    super();
  }
  stop = vi.fn(() => {
    this.readyState = 'ended';
  });
  getSettings() {
    return { deviceId: this.deviceId };
  }
  asTrack() {
    return this as unknown as MediaStreamTrack;
  }
}
export class FakeStream {
  constructor(readonly tracks: MediaStreamTrack[] = [new FakeTrack().asTrack()]) {}
  getTracks() {
    return this.tracks;
  }
  getAudioTracks() {
    return this.tracks.filter((track) => track.kind === 'audio');
  }
  asStream() {
    return this as unknown as MediaStream;
  }
}
export class FakeNode {
  inputs = new Set<FakeNode>();
  outputs = new Set<FakeNode>();
  amplitude: number | null = null;
  gain = {
    value: 1,
    cancelScheduledValues: vi.fn(),
    setValueAtTime: vi.fn((v: number) => {
      this.gain.value = v;
    }),
    linearRampToValueAtTime: vi.fn((v: number) => {
      this.gain.value = v;
    }),
  };
  fftSize = 32;
  get frequencyBinCount() {
    return this.fftSize / 2;
  }
  stream = new FakeStream().asStream();
  connect(node: FakeNode) {
    node.inputs.add(this);
    this.outputs.add(node);
    return node;
  }
  disconnect() {
    for (const node of this.outputs) node.inputs.delete(this);
    this.outputs.clear();
  }
  signal(): number {
    return (
      (this.amplitude ?? [...this.inputs].reduce((s, n) => s + n.signal(), 0)) * this.gain.value
    );
  }
  getFloatTimeDomainData(data: Float32Array) {
    data.fill(this.signal());
  }
}
export class FakeContext {
  state = 'running';
  currentTime = 2;
  destination = new FakeNode();
  nodes: FakeNode[] = [];
  sources: FakeNode[] = [];
  gains: FakeNode[] = [];
  createGain() {
    const n = this.node();
    this.gains.push(n);
    return n;
  }
  createAnalyser() {
    return this.node();
  }
  createMediaStreamDestination() {
    return this.node();
  }
  createMediaStreamSource = vi.fn((_stream: MediaStream) => {
    const n = this.node();
    n.amplitude = 0.5;
    this.sources.push(n);
    return n;
  });
  resume = vi.fn(async () => {
    this.state = 'running';
  });
  close = vi.fn(async () => {
    this.state = 'closed';
  });
  private node() {
    const n = new FakeNode();
    this.nodes.push(n);
    return n;
  }
  asContext() {
    return this as unknown as AudioContext;
  }
}
export function device(deviceId: string, kind: MediaDeviceKind = 'audioinput'): MediaDeviceInfo {
  return { deviceId, kind, label: deviceId, groupId: '', toJSON: () => ({}) };
}
export function micHarness() {
  const events = new EventTarget();
  const captures: FakeStream[] = [];
  const contexts: FakeContext[] = [];
  const media = {
    getUserMedia: vi.fn(async (_constraints?: MediaStreamConstraints) => {
      const s = new FakeStream();
      captures.push(s);
      return s.asStream();
    }),
    enumerateDevices: vi.fn(async () => [
      device('mic-1'),
      device('mic-2'),
      device('speaker', 'audiooutput'),
    ]),
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
  };
  const deps = {
    media,
    createContext: () => {
      const c = new FakeContext();
      contexts.push(c);
      return c.asContext();
    },
  };
  return { deps, media, captures, contexts, events };
}
