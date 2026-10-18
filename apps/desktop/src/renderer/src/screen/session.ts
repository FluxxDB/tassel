import type { ScreenIdentity, ScreenMark } from '../../../shared/screen-bridge';
/** One owner for cancellation epochs. UI and network acknowledgments cannot roll it back. */
export class ScreenSession {
  private source = '';
  private epoch = Date.now() * 1000;
  private revision = 0;
  marks: ScreenMark[] = [];
  constructor(private readonly interrupt: (identity: ScreenIdentity) => Promise<void>) {}
  start(source: string) {
    this.source = source;
    ++this.epoch;
    this.revision = 0;
    this.marks = [];
  }
  identity(): ScreenIdentity {
    return { source: this.source, epoch: this.epoch, revision: this.revision };
  }
  accepts(id: ScreenIdentity) {
    return id.source === this.source && id.epoch === this.epoch && id.revision === this.revision;
  }
  add(mark: ScreenMark, identity: ScreenIdentity) {
    if (this.accepts(identity)) {
      this.marks = [...this.marks.slice(-199), mark];
      while (this.marks.reduce((n, m) => n + m.points.length, 0) > 32768) this.marks.shift();
    }
  }
  invalidate() {
    ++this.revision;
    this.marks = [];
  }
  async reset() {
    ++this.epoch;
    this.marks = [];
    await this.interrupt(this.identity());
  }
}
