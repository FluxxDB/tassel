// @vitest-environment jsdom
// The board download: its file name from the session's title and the day, and the temporary link
// that hands the PNG to the browser.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { boardFileName, saveBlob } from '../../../src/renderer/src/board/download';

describe('boardFileName', () => {
  const day = new Date(2026, 9, 18, 15, 30);

  it("slugs the session's title and adds the local date", () => {
    expect(boardFileName('Strings that start with 010', day)).toBe(
      'tassel-board-strings-that-start-with-010-2026-10-18.png',
    );
  });

  it('keeps letters of any script, and folds everything else into one hyphen', () => {
    expect(boardFileName('DFA 연습: 010으로 시작!', day)).toBe(
      'tassel-board-dfa-연습-010으로-시작-2026-10-18.png',
    );
    expect(boardFileName('¿Qué es un AFD?  / repaso', day)).toBe(
      'tassel-board-qué-es-un-afd-repaso-2026-10-18.png',
    );
  });

  it('is untitled for no title, an empty one or one with nothing to keep', () => {
    for (const title of [null, '', '   ', '---', '!!!']) {
      expect(boardFileName(title, day)).toBe('tassel-board-untitled-2026-10-18.png');
    }
  });

  it('cuts a long title at 60 characters, never ending in a hyphen', () => {
    const name = boardFileName(`${'word '.repeat(20)}end`, day);
    const slug = name.slice('tassel-board-'.length, -'-2026-10-18.png'.length);
    expect(slug.length).toBeLessThanOrEqual(60);
    expect(slug.endsWith('-')).toBe(false);
    expect(slug.startsWith('word-word')).toBe(true);
  });

  it('pads the month and the day', () => {
    expect(boardFileName('x', new Date(2026, 0, 5))).toBe('tassel-board-x-2026-01-05.png');
  });
});

describe('saveBlob', () => {
  const clicks: HTMLAnchorElement[] = [];
  let revoked: string[];
  beforeEach(() => {
    vi.useFakeTimers();
    revoked = [];
    URL.createObjectURL = vi.fn(() => 'blob:tassel/board');
    URL.revokeObjectURL = vi.fn((url: string) => {
      revoked.push(url);
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicks.push(this.cloneNode() as HTMLAnchorElement);
    });
  });
  afterEach(() => {
    clicks.length = 0;
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('clicks a hidden link named for the file, removes it, and releases the URL after', () => {
    const blob = new Blob(['png'], { type: 'image/png' });
    saveBlob(blob, 'tassel-board-x-2026-10-18.png');
    expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
    expect(clicks).toHaveLength(1);
    expect(clicks[0].getAttribute('href')).toBe('blob:tassel/board');
    expect(clicks[0].download).toBe('tassel-board-x-2026-10-18.png');
    expect(clicks[0].hidden).toBe(true);
    // Gone from the document once clicked.
    expect(document.querySelectorAll('a')).toHaveLength(0);
    expect(revoked).toEqual([]);
    vi.advanceTimersByTime(1_000);
    expect(revoked).toEqual(['blob:tassel/board']);
  });

  it('removes the link and still releases the URL when the click throws', () => {
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
      throw new Error('no');
    });
    expect(() => saveBlob(new Blob(['png']), 'x.png')).toThrow('no');
    expect(document.querySelectorAll('a')).toHaveLength(0);
    vi.advanceTimersByTime(1_000);
    expect(revoked).toEqual(['blob:tassel/board']);
  });
});
