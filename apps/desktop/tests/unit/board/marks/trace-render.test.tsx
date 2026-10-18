// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runAutomaton } from '../../../../src/renderer/src/board/automata/run';
import { FIXTURE_DFA_WRONG } from '../../../../src/renderer/src/board/marks/fixture-paper';
import { resolveTarget, stepDotFor } from '../../../../src/renderer/src/board/marks/geometry';
import type { Snapshot } from '../../../../src/renderer/src/board/marks/marks-store';
import { containFit, rectProjector } from '../../../../src/renderer/src/board/marks/project';
import { TraceMarks } from '../../../../src/renderer/src/board/marks/TraceMarks';
import { MOTION } from '../../../../src/renderer/src/board/motion';

const { spec, elements, w, h } = FIXTURE_DFA_WRONG;
const snapshot: Snapshot = {
  ref: { kind: 'fixture', name: 'dfa-wrong' },
  image: { kind: 'fixture', name: 'dfa-wrong', w, h },
  project: rectProjector(w, h),
  elements,
  spec,
  capturedAt: '2026-10-17T00:00:00Z',
};
const run = runAutomaton(spec, '1010');
const fit = containFit({ w, h }, { w: 698, h: 736 });
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe('TraceMarks', () => {
  it('projects numbered dots and current ring onto the ink, including after resize', () => {
    const { rerender } = render(
      <TraceMarks snapshot={snapshot} fit={fit} trace={{ run, shown: 2 }} />,
    );
    for (const next of [fit, containFit({ w, h }, { w: 490, h: 516 })]) {
      rerender(<TraceMarks snapshot={snapshot} fit={next} trace={{ run, shown: 2 }} />);
      const edge = resolveTarget({ el: 'edge:q0>q1' }, elements, snapshot.project, next);
      if (!edge) throw new Error('missing edge');
      const dot = stepDotFor(edge, 0);
      const circle = screen.getByTestId('trace-dot-2').querySelector('circle');
      expect(Number(circle?.getAttribute('cx'))).toBeCloseTo(dot.x);
      expect(Number(circle?.getAttribute('cy'))).toBeCloseTo(dot.y);
      const state = resolveTarget({ el: 'state:q1' }, elements, snapshot.project, next);
      expect(Number(screen.getByTestId('trace-ring-q1').getAttribute('r'))).toBeCloseTo(
        (state?.radius ?? 0) * 1.25,
      );
    }
  });
  it('glides on the projected path, cancels on a new step, and leaves the final state underneath', () => {
    const cancel = vi.fn();
    const animate = vi.fn(() => ({ cancel }));
    Object.defineProperty(SVGElement.prototype, 'animate', { configurable: true, value: animate });
    const { rerender, unmount } = render(
      <TraceMarks snapshot={snapshot} fit={fit} trace={{ run, shown: 1 }} />,
    );
    expect(animate).toHaveBeenCalledTimes(1);
    rerender(<TraceMarks snapshot={snapshot} fit={fit} trace={{ run, shown: 1 }} />);
    expect(cancel).not.toHaveBeenCalled();
    const [frames, options] = animate.mock.calls[0] as unknown as [
      Keyframe[],
      KeyframeAnimationOptions,
    ];
    expect(options).toMatchObject({ duration: MOTION.glideMs, easing: MOTION.glideEase });
    expect(frames.length).toBeGreaterThan(2); // The loop must not collapse to its chord.
    expect(screen.getByTestId('trace-token').style.transform).toBe(frames.at(-1)?.transform);
    rerender(<TraceMarks snapshot={snapshot} fit={fit} trace={{ run, shown: 2 }} />);
    expect(cancel).toHaveBeenCalled();
    expect(animate).toHaveBeenCalledTimes(2);
    unmount();
    expect(cancel).toHaveBeenCalledTimes(2);
    delete (SVGElement.prototype as unknown as { animate?: unknown }).animate;
  });
  it('reduced motion jumps to the endpoint without starting a glide', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const animate = vi.fn();
    Object.defineProperty(SVGElement.prototype, 'animate', { configurable: true, value: animate });
    render(<TraceMarks snapshot={snapshot} fit={fit} trace={{ run, shown: 4 }} />);
    expect(screen.getByTestId('trace-dot-4')).toHaveTextContent('4');
    expect(screen.getByTestId('trace-ring-q3')).toBeInTheDocument();
    const path = resolveTarget({ el: 'edge:q2>q3' }, elements, snapshot.project, fit)?.path;
    const end = path?.at(-1);
    expect(screen.getByTestId('trace-token').style.transform).toBe(
      `translate(${end?.x}px, ${end?.y}px)`,
    );
    expect(animate).not.toHaveBeenCalled();
    delete (SVGElement.prototype as unknown as { animate?: unknown }).animate;
  });
});
