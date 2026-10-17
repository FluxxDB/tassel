// Ada until P6 brings her customizable, lip-synced avatar: the chosen mock's sketch of a woman in
// the reference's soft flat style. Illustration colors, not UI tokens.
import { useId } from 'react';

export function AvatarPlaceholder({ className }: { className?: string }) {
  // Gradient ids must be unique in the document.
  const id = useId();
  const top = `${id}-top`;
  const skin = `${id}-skin`;
  const hair = `${id}-hair`;
  return (
    <svg viewBox="0 0 200 200" className={className} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={top} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#eadcfb" />
          <stop offset="1" stopColor="#8f74d9" />
        </linearGradient>
        <radialGradient id={skin} cx=".45" cy=".4" r=".7">
          <stop offset="0" stopColor="#ffe4d1" />
          <stop offset="1" stopColor="#f4c3a2" />
        </radialGradient>
        <linearGradient id={hair} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7b5149" />
          <stop offset="1" stopColor="#47302b" />
        </linearGradient>
      </defs>
      <path
        d="M126 50C152 36 176 52 172 84C169 110 156 126 144 140C150 118 148 98 134 84Z"
        fill={`url(#${hair})`}
      />
      <path d="M40 200C40 162 66 148 100 148C134 148 160 162 160 200Z" fill={`url(#${top})`} />
      <rect x="88" y="120" width="24" height="34" rx="10" fill="#efb995" />
      <path
        d="M58 94C54 54 80 34 104 34C130 34 150 54 146 94L146 112C138 100 66 100 58 112Z"
        fill={`url(#${hair})`}
      />
      <circle cx="62" cy="98" r="9" fill="#efb995" />
      <circle cx="142" cy="98" r="9" fill="#efb995" />
      <ellipse cx="102" cy="96" rx="40" ry="42" fill={`url(#${skin})`} />
      <path
        d="M60 88C62 54 88 40 108 42C128 44 146 60 144 88C132 68 116 62 104 60C96 72 80 82 60 88Z"
        fill={`url(#${hair})`}
      />
      <ellipse cx="134" cy="48" rx="9" ry="7" fill="#b98fe8" />
      <ellipse cx="86" cy="100" rx="4.5" ry="5.2" fill="#2e2222" />
      <ellipse cx="118" cy="100" rx="4.5" ry="5.2" fill="#2e2222" />
      <ellipse cx="78" cy="114" rx="7" ry="4" fill="#f4a3a3" opacity=".4" />
      <ellipse cx="126" cy="114" rx="7" ry="4" fill="#f4a3a3" opacity=".4" />
      <ellipse cx="102" cy="119" rx="6" ry="5" fill="#8a3b34" />
    </svg>
  );
}
