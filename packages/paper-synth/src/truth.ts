// A clip's truth as JSON, with frame pixels beside every page coordinate, for the E2E specs and
// for anyone checking a trigger against what was drawn.

import { type NormRect, PAGE_ASPECT, type Pt, toFrame } from './geometry.ts';
import { type Clip, GENERATOR_VERSION, sceneOf, sheetPlacement } from './scene.ts';

/**
 * ClipTruth plus every coordinate in frame pixels too. A position in pixels depends on where the
 * page lies, so each one uses the page as it lay when its group was drawn: at the group's endMs
 * (0 for ink already on the page). `pageQuads` gives the page's quad at each keyframe of its
 * motion; it moves linearly between them.
 */
export function truthJson(clip: Clip, width: number, height: number): object {
  const scene = sceneOf(clip);
  const truth = clip.truth;
  const placementAt = (t: number) => sheetPlacement(scene, 0, t, width, height);
  const px = (p: Pt, t: number): Pt => toFrame(placementAt(t), p.x, p.y * PAGE_ASPECT);
  const rectPx = (r: NormRect, t: number) => {
    const corners = [
      px({ x: r.x, y: r.y }, t),
      px({ x: r.x + r.w, y: r.y }, t),
      px({ x: r.x + r.w, y: r.y + r.h }, t),
      px({ x: r.x, y: r.y + r.h }, t),
    ];
    const xs = corners.map((c) => c.x);
    const ys = corners.map((c) => c.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  };
  const endOf = (id: string) => truth.groups.find((g) => g.id === id)?.endMs ?? 0;
  const transitionGroup = (from: string, to: string) =>
    from === to ? `loop-${from}` : `${from}-${to}`;
  const keyTimes = [...new Set([0, ...(scene.sheets[0]?.offsets ?? []).map((k) => k.t)])].sort(
    (a, b) => a - b,
  );
  return {
    name: clip.name,
    durationMs: clip.durationMs,
    generatorVersion: GENERATOR_VERSION,
    width,
    height,
    pageQuad: clip.pageQuadAt(0, width, height),
    pageQuads: keyTimes.map((atMs) => ({ atMs, quad: clip.pageQuadAt(atMs, width, height) })),
    dfa: {
      states: truth.dfa.states.map((s) => ({
        ...s,
        centerPx: px(s.center, endOf(s.id)),
        radiusPx: s.radius * placementAt(endOf(s.id)).scale,
      })),
      transitions: truth.dfa.transitions.map((t) => ({
        ...t,
        labelAtPx: px(t.labelAt, endOf(transitionGroup(t.from, t.to))),
      })),
    },
    groups: truth.groups.map((g) => ({ ...g, bboxPx: rectPx(g.bbox, g.endMs) })),
    hand: truth.hand,
    expectedTriggers: truth.expectedTriggers,
  };
}
