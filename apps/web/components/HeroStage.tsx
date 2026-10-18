// A drawn stand-in for the app's session screen as it is now: Ada's board fills the stage, her
// tile floats in the top right corner with its breathing iris ring while she speaks, the desk
// camera floats in the bottom right, captions sit above the dock, and the chat sidebar runs beside
// the stage on wide screens. The whole mock is one image to assistive tech. Swap it for a real
// screenshot once the UI settles.
import type { ReactNode } from 'react';
import { Avatar } from './avatar/Avatar';
import { DEFAULT_AVATAR } from './avatar/catalog';
import { Board, Camera, Captions, Mic, Paperclip, Screen } from './icons';
import './hero-stage.css';

const STATES = [
  { id: 'q0', x: 48 },
  { id: 'q1', x: 128 },
  { id: 'q2', x: 208 },
  { id: 'q3', x: 288, accept: true },
];
const EDGES = [
  { from: 48, to: 128, label: '0' },
  { from: 128, to: 208, label: '1' },
  { from: 208, to: 288, label: '0' },
];
const Y = 92;
const R = 17;

function BoardDfa() {
  return (
    <svg viewBox="0 0 336 170" className="h-auto w-full" aria-hidden="true">
      <defs>
        <marker
          id="arrow"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M0 0 10 5 0 10z" fill="var(--color-iris-ink)" />
        </marker>
      </defs>
      <path
        d={`M6 ${Y}H${48 - R - 2}`}
        stroke="var(--color-ink)"
        strokeWidth="1.5"
        markerEnd="url(#arrow)"
      />
      {EDGES.map((e) => (
        <g key={e.from}>
          <path
            d={`M${e.from + R} ${Y}H${e.to - R - 2}`}
            stroke="var(--color-iris-ink)"
            strokeWidth="1.6"
            markerEnd="url(#arrow)"
          />
          <text
            x={(e.from + e.to) / 2}
            y={Y - 8}
            textAnchor="middle"
            className="fill-ink font-mono text-[12px]"
          >
            {e.label}
          </text>
        </g>
      ))}
      {/* Accept state's self-loop on 0, 1. */}
      <path
        d={`M${288 - 9} ${Y - R + 2}C${288 - 26} ${Y - 62} ${288 + 26} ${Y - 62} ${288 + 9} ${Y - R + 1}`}
        fill="none"
        stroke="var(--color-iris-ink)"
        strokeWidth="1.6"
        markerEnd="url(#arrow)"
      />
      <text x="288" y={Y - 50} textAnchor="middle" className="fill-ink font-mono text-[12px]">
        0, 1
      </text>
      {STATES.map((s) => (
        <g key={s.id}>
          <circle
            cx={s.x}
            cy={Y}
            r={R}
            className="fill-paper"
            stroke="var(--color-ink)"
            strokeWidth="1.5"
          />
          {s.accept && (
            <circle
              cx={s.x}
              cy={Y}
              r={R - 4}
              fill="none"
              stroke="var(--color-ink)"
              strokeWidth="1.2"
            />
          )}
          <text x={s.x} y={Y + 4} textAnchor="middle" className="fill-ink font-mono text-[11px]">
            {s.id}
          </text>
        </g>
      ))}
      {/* The token gliding along the trace. */}
      <circle cx="168" cy={Y} r="5" fill="var(--color-iris)" />
      <circle cx="168" cy={Y} r="10" fill="var(--color-iris)" opacity="0.25" />
    </svg>
  );
}

/** Her (wrong) pencil DFA: q1 loops back on 1 instead of rejecting. Ada circles the edge. */
function PaperSketch({ pill = true }: { pill?: boolean }) {
  return (
    <svg viewBox="0 0 260 200" className="h-auto w-full" aria-hidden="true">
      <g
        fill="none"
        stroke="var(--color-slate-plum)"
        strokeWidth="1.4"
        strokeLinecap="round"
        opacity="0.8"
      >
        <path d="M44 96c0-11 7-18 17-18s17 8 16 18-8 17-17 17-16-7-16-17Z" />
        <path d="M118 95c1-10 8-17 17-16s16 8 16 17-7 18-17 18-17-9-16-19Z" />
        <path d="M193 97c-1-10 7-18 17-18s17 7 17 17-8 18-18 18-16-7-16-17Z" />
        <path d="M197 97c0-7 6-13 13-13s13 6 13 13-6 13-13 13-13-6-13-13Z" />
        <path d="M78 95c13-1 25 0 38 0M112 91l5 4-5 4" />
        <path d="M152 96c13 0 25 1 39 0M186 92l5 4-5 4" />
        <path d="M128 79c-6-24 22-26 16-1M141 73l3 6 4-5" />
      </g>
      <g className="fill-slate-plum font-mono text-[11px]" opacity="0.85">
        <text x="97" y="88">
          0
        </text>
        <text x="170" y="89">
          0
        </text>
        <text x="132" y="55">
          1
        </text>
      </g>
      {/* Ada's mark, in iris ink with a soft wash. */}
      <ellipse cx="136" cy="62" rx="22" ry="18" fill="var(--color-iris)" opacity="0.2" />
      <path
        d="M115 60c2-14 18-20 30-15s16 19 4 27-32 6-35-8"
        fill="none"
        stroke="var(--color-iris-ink)"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      {pill && (
        <g transform="translate(150 132)">
          <rect width="94" height="24" rx="12" className="fill-ink" />
          <text
            x="47"
            y="16"
            textAnchor="middle"
            className="fill-paper font-mono text-[10px] uppercase tracking-[0.025em]"
          >
            Try 1010
          </text>
        </g>
      )}
    </svg>
  );
}

function DockButton({ children, pressed = false }: { children: ReactNode; pressed?: boolean }) {
  return (
    <span
      className={
        pressed
          ? 'flex size-9 items-center justify-center rounded-full bg-ink text-paper'
          : 'flex size-9 items-center justify-center rounded-full text-ink'
      }
    >
      {children}
    </span>
  );
}

function ChatSidebar() {
  return (
    <div className="hidden w-[272px] shrink-0 flex-col border-l border-hairline bg-bone lg:flex">
      <div className="flex h-11 items-center justify-between px-4">
        <span className="mono text-[11px] text-smoke-text">Chat</span>
        <span className="text-[12px] text-smoke-text">Hide</span>
      </div>
      <div className="flex flex-1 flex-col justify-end gap-4 px-4 pb-3">
        <div className="flex max-w-[86%] flex-col items-end gap-1.5 self-end">
          <div className="w-[104px] overflow-hidden rounded-card-sm border border-hairline bg-paper p-1">
            <PaperSketch pill={false} />
          </div>
          <p className="rounded-card-sm border border-hairline bg-paper px-3 py-1.5 text-[13px] leading-5 text-ink">
            Does my DFA work?
          </p>
        </div>
        <div className="pr-4">
          <p className="mono mb-1 text-[11px] leading-[14px] text-iris-ink">Ada</p>
          <p className="text-[13px] leading-5 text-ink">
            Almost. Your q1 loops on 1, so 0110 slips through. I circled it on your page.
          </p>
        </div>
      </div>
      <div className="m-3 mt-0 flex items-center gap-2 rounded-card-sm border border-hairline bg-paper px-3 py-2.5">
        <Paperclip className="size-4 text-smoke" />
        <span className="flex-1 text-[13px] text-smoke-text">Message Ada…</span>
      </div>
    </div>
  );
}

export function HeroStage() {
  return (
    <div
      role="img"
      aria-label="Tassel's session screen: Ada, the tutor, speaks from a floating tile while she draws the correct DFA on the whiteboard, the student's desk camera shows her paper with Ada's mark on it, captions run above the controls, and a chat sidebar sits beside the stage."
      className="overflow-hidden rounded-hero border border-hairline bg-bone"
    >
      {/* The window's title strip. */}
      <div className="flex h-12 items-center gap-3 border-b border-hairline px-4">
        <span className="flex gap-1.5">
          <span className="size-3 rounded-full bg-[#ff5f57]" />
          <span className="size-3 rounded-full bg-[#febc2e]" />
          <span className="size-3 rounded-full bg-[#28c840]" />
        </span>
        <span className="ml-2 hidden truncate text-[13px] font-w520 text-ink sm:block">
          Strings that start with 010
        </span>
        <span className="mono hidden rounded-pill bg-paper px-2 py-0.5 text-[10px] text-smoke-text md:inline">
          Automata
        </span>
        <div className="ml-auto flex rounded-pill bg-paper p-0.5 text-[12px]">
          <span className="rounded-pill px-3 py-1 text-smoke-text">Paper</span>
          <span className="rounded-pill bg-ink px-3 py-1 font-w520 text-paper">Board</span>
          <span className="rounded-pill px-3 py-1 text-smoke-text">Split</span>
        </div>
      </div>

      <div className="flex">
        {/* The stage: Ada's board fills it and the tiles float over it. */}
        <div className="dot-grid relative aspect-[4/5] min-w-0 flex-1 sm:aspect-[16/10]">
          <div className="absolute inset-x-[6%] top-[33%] sm:top-[24%] sm:right-[32%] sm:left-[4%]">
            <BoardDfa />
          </div>

          {/* Ada's tile: blush, her avatar, name and state, the breathing ring while she speaks. */}
          <div className="tutor-tile absolute top-3 right-3 aspect-[212/176] w-[44%] max-w-[212px] overflow-hidden rounded-card bg-blush sm:w-[25%]">
            <Avatar
              speaking
              profile={DEFAULT_AVATAR}
              className="absolute top-[3.4%] left-1/2 aspect-square h-[88.6%] -translate-x-1/2"
            />
            <div className="absolute bottom-2 left-2 flex h-[25px] items-center gap-1.5 rounded-pill bg-paper px-2.5">
              <span className="text-[12px] leading-4 font-w520 text-ink">Ada</span>
              <span className="mono text-[10px] leading-[14px] text-iris-ink">Speaking</span>
            </div>
          </div>

          {/* Her desk camera, small, while the board fills the stage. */}
          <div className="absolute right-3 bottom-[138px] hidden aspect-[4/3] w-[20%] max-w-[180px] overflow-hidden rounded-card bg-desk p-2 sm:block">
            <div className="flex size-full rotate-[-1.5deg] items-center rounded-input bg-paper p-1">
              <PaperSketch pill={false} />
            </div>
          </div>

          {/* Captions above the dock: the previous line small and muted, the current one large. */}
          <div className="absolute inset-x-3 bottom-[66px] mx-auto max-w-[560px] rounded-card bg-ink px-4 pt-2.5 pb-3 text-paper sm:inset-x-6 sm:px-5">
            <p className="mb-1 text-[12px] leading-4 text-caption-muted sm:text-[13px]">
              <span className="mono mr-2 text-[10px]">You</span>I think it only accepts strings that
              start with 010.
            </p>
            <p className="text-[15px] leading-5 font-[450] sm:text-[18px] sm:leading-6">
              <span className="mono mr-2 align-[0.15em] text-[10px] text-iris">Ada</span>
              Try running 1010 through it. Where does it end up?
            </p>
          </div>

          {/* The dock. */}
          <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-pill bg-paper p-1.5 shadow-[0_0_0_1px_var(--color-hairline)]">
            <DockButton pressed>
              <Mic className="size-[18px]" />
            </DockButton>
            <span className="mr-1 flex h-[18px] items-end gap-0.5">
              <span className="level-bar w-[3px] rounded-full bg-ink" />
              <span className="level-bar w-[3px] rounded-full bg-ink [animation-delay:-0.3s]" />
              <span className="level-bar w-[3px] rounded-full bg-ink [animation-delay:-0.6s]" />
            </span>
            <DockButton pressed>
              <Camera className="size-[18px]" />
            </DockButton>
            <span className="hidden sm:contents">
              <DockButton>
                <Screen className="size-[18px]" />
              </DockButton>
            </span>
            <DockButton>
              <Board className="size-[18px]" />
            </DockButton>
            <DockButton pressed>
              <Captions className="size-[18px]" />
            </DockButton>
            <span className="mx-1 h-6 w-px bg-hairline" />
            <span className="flex h-9 items-center rounded-pill bg-ink px-4 text-[13px] font-w520 text-paper">
              End
            </span>
          </div>
        </div>
        <ChatSidebar />
      </div>
    </div>
  );
}
