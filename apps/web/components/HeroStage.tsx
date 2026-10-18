// A drawn stand-in for the session stage (the "One stage, her work first" mock): her paper on the
// left with the tutor's mark over it, the board on the right with the corrected DFA, and Ada's
// caption underneath. Swap for a real screenshot once the app's UI settles.

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
    <svg
      viewBox="0 0 336 170"
      className="h-auto w-full"
      role="img"
      aria-label="A four-state DFA for binary strings that start with 010"
    >
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

function PaperSketch() {
  // Her (wrong) pencil DFA: it loops back on 1 instead of rejecting. Ada circles the edge.
  return (
    <svg
      viewBox="0 0 260 200"
      className="h-auto w-full"
      role="img"
      aria-label="A pencil sketch of a DFA on paper, with one transition circled by the tutor"
    >
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
        {/* The wrong edge: q1 back to itself on 1. */}
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
        strokeWidth="2"
        strokeLinecap="round"
      />
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
    </svg>
  );
}

export function HeroStage() {
  return (
    <div className="relative rounded-hero border border-hairline bg-paper p-2.5 sm:p-3">
      <div className="flex items-center justify-between px-2 pb-2.5 pt-1">
        <div className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-live" aria-hidden="true" />
          <span className="mono text-[11px] text-smoke-text">Live session</span>
        </div>
        <div className="flex rounded-pill bg-bone p-0.5 text-[12px]" aria-hidden="true">
          <span className="rounded-pill px-3 py-1 text-smoke-text">Paper</span>
          <span className="rounded-pill px-3 py-1 text-smoke-text">Board</span>
          <span className="rounded-pill bg-paper px-3 py-1 font-w520 text-ink">Split</span>
        </div>
      </div>
      <div className="grid gap-2.5 sm:grid-cols-2">
        <div className="relative overflow-hidden rounded-card bg-desk p-4 sm:p-5">
          <span className="mono absolute left-3 top-3 rounded-pill bg-paper/80 px-2 py-0.5 text-[10px] text-smoke-text">
            Her paper
          </span>
          <div className="mt-5 rotate-[-1.5deg] rounded-input bg-paper p-3">
            <PaperSketch />
          </div>
        </div>
        <div className="dot-grid relative overflow-hidden rounded-card border border-hairline p-4 sm:p-5">
          <span className="mono absolute left-3 top-3 rounded-pill bg-bone px-2 py-0.5 text-[10px] text-smoke-text">
            Board
          </span>
          <div className="mt-8">
            <BoardDfa />
          </div>
        </div>
      </div>
      <div className="mt-2.5 flex items-start gap-3 rounded-card bg-ink px-4 py-3.5 text-paper">
        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-blush text-[12px] font-w520 text-ink">
          A
        </span>
        <p className="text-[14px] leading-snug sm:text-[15px]">
          <span className="mono mr-2 text-[11px] text-caption-muted">Ada</span>
          Before you move on, try running 1010 through your DFA. Where does it end up?
        </p>
      </div>
    </div>
  );
}
