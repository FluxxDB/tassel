// Where Ada's actions go: views to the stage, board actions to her board and paper actions to the
// marks on the student's paper. Each action is checked first; a bad one is skipped with a
// warning and the rest still apply (Review Focus 5). Something she shows on a view that isn't up
// brings it in beside the other, as a request: while the student has a view pinned, it waits,
// remembered, so nothing Ada does is lost (Review Focus 1).
import {
  type BeatAction,
  type BoardAction,
  type ImageAction,
  type PaperAction,
  parseAction,
} from '@tassel/shared/beats';
import { useStageStore } from '../features/session/stage-store';
import { applyBoardAction } from './board-store';
import { applyImageAction } from './marks/image-store';
import { applyPaperAction } from './marks/marks-store';

/** Checks and applies each action, in order. */
export function dispatchActions(actions: readonly unknown[]): void {
  if (!Array.isArray(actions)) {
    console.warn('[tassel] Skipped actions that are not a list:', actions);
    return;
  }
  for (const data of actions) {
    const action = parseAction(data);
    if (!action) {
      console.warn('[tassel] Skipped an invalid action:', data);
      continue;
    }
    try {
      apply(action);
    } catch (error) {
      // A bug behind a sink, not bad input: report it and go on with the rest.
      console.error(`[tassel] Applying a ${action.kind} action failed:`, error);
    }
  }
}

/**
 * True when the action puts something in view, so the stage should show its side: every action
 * but focus, clear, an automaton or diagram drawn hidden, a highlight turned off, unmark, paper.clear,
 * paper.live, image.clear and stage.
 */
export function isShowing(action: BeatAction): boolean {
  switch (action.kind) {
    case 'board.focus':
    case 'board.clear':
    case 'paper.unmark':
    case 'paper.clear':
    case 'paper.live':
    case 'image.clear':
    case 'stage':
      return false;
    case 'board.automaton':
    case 'board.diagram':
      return action.reveal !== 'none';
    case 'board.highlight':
      return action.on;
    default:
      return true;
  }
}

function apply(action: BeatAction): void {
  if (action.kind === 'stage') {
    useStageStore.getState().requestMode(action.view);
  } else if (isBoardAction(action)) {
    showBeside('paper', action);
    applyBoardAction(action);
  } else if (isImageAction(action)) {
    // The student's image takes the paper panel's slot, so it shows where her paper does.
    showBeside('board', action);
    applyImageAction(action);
  } else {
    showBeside('board', action);
    applyPaperAction(action);
  }
}

function isBoardAction(action: BoardAction | PaperAction | ImageAction): action is BoardAction {
  return action.kind.startsWith('board.');
}

function isImageAction(action: PaperAction | ImageAction): action is ImageAction {
  return action.kind.startsWith('image.');
}

/** Requests split when a showing action's side is hidden by `hiding`, Ada's view. */
function showBeside(hiding: 'paper' | 'board', action: BeatAction): void {
  const { mode, pinned, requested, requestMode } = useStageStore.getState();
  // Her view: what she asked for last while a view is pinned, else what shows.
  const adaView = pinned ? requested : mode;
  if (isShowing(action) && adaView === hiding) requestMode('split');
}
