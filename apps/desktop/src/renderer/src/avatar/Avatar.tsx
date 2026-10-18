import { type CSSProperties, useId } from 'react';
import { type AvatarProfile, COLORS, materialBoundary } from './catalog';
import './avatar.css';

/** All parts share one viewBox and fixed anchors. IDs in the catalog select authored SVG layers. */
export function Avatar({
  profile: p,
  celebrating = false,
  speaking = false,
  className,
}: {
  profile: AvatarProfile;
  celebrating?: boolean;
  speaking?: boolean;
  className?: string;
}) {
  const id = useId();
  const dress = p.outfit === 'dress';
  const body = dress
    ? 'M35 220V191Q40 160 87 150Q89 149 89 145H114Q114 149 117 150Q164 160 170 191V220Z'
    : 'M35 220V191Q40 160 87 150Q102 168 117 150Q164 160 170 191V220Z';
  const hair = COLORS.hair[p.hairColor];
  const skin = COLORS.skin[p.skin];
  const outfit = COLORS.outfit[p.outfitColor];
  const scarf = p.hat === 'headscarf';
  const hat = COLORS.hair[p.hatColor];
  const happy = celebrating || p.face === 'happy';
  const eyes = happy
    ? 'M77 100l8-7 8 7 M110 100l8-7 8 7'
    : p.face === 'sideways'
      ? 'M81 92.5l9 6-9 6 M114 92.5l9 6-9 6'
      : p.face === 'sleepy'
        ? 'M78 99q8 6 16 0 M110 99q8 6 16 0'
        : 'M85 96v5 M118 96v5';
  return (
    <svg
      viewBox="0 0 200 220"
      className={className}
      aria-hidden="true"
      focusable="false"
      data-speaking={speaking && !celebrating}
      data-outfit={p.outfit}
      data-hair={p.hair}
      data-hat={p.hat}
      data-face={celebrating ? 'celebration' : p.face}
      style={
        { '--avatar-hair': hair, '--avatar-skin': skin, '--avatar-outfit': outfit } as CSSProperties
      }
    >
      <defs>
        <clipPath id={`${id}-body`}>
          <path d={body} />
        </clipPath>
        <linearGradient id={`${id}-skin`} x2=".9" y2="1">
          <stop stopColor={skin} />
          <stop
            offset="1"
            stopColor={skin}
            style={{ stopColor: 'color-mix(in oklab, var(--avatar-skin), #3d2430 12%)' }}
          />
        </linearGradient>
        <linearGradient id={`${id}-hair`} x2="1" y2="1">
          <stop stopColor={hair} />
          <stop
            offset="1"
            stopColor={hair}
            style={{ stopColor: 'color-mix(in oklab, var(--avatar-hair), #171323 25%)' }}
          />
        </linearGradient>
      </defs>
      <g fill={`url(#${id}-hair)`} visibility={scarf ? 'hidden' : undefined}>
        {p.hair === 'ponytail' && (
          <path d="M125 48Q184 28 176 95Q170 131 145 149Q156 106 128 78Z" />
        )}
        {p.hair === 'long' && (
          <path d="M51 82Q45 33 102 28Q157 30 156 90L165 178Q105 196 39 177Z" />
        )}
        {p.hair === 'bob' && <path d="M49 83Q48 31 102 29Q158 32 155 90L159 139Q102 163 44 139Z" />}
        {p.hair === 'curls' && (
          <path d="M46 84Q24 62 49 50Q40 24 68 31Q85 9 103 29Q129 12 140 35Q173 30 162 61Q184 79 162 99Q178 131 145 141L58 142Q22 129 42 105Q23 92 46 84Z" />
        )}
        {p.hair === 'buns' && (
          <>
            <circle cx="54" cy="53" r="24" />
            <circle cx="148" cy="53" r="24" />
          </>
        )}
        <path d="M55 90Q48 32 102 30Q157 32 150 94L142 119H63Z" />
      </g>
      {scarf && <path d="M45 92Q43 23 102 23Q164 23 162 93L169 164Q101 191 34 164Z" fill={hat} />}
      <path d="M89 124H114V164H89Z" fill={scarf ? hat : skin} />
      <g clipPath={`url(#${id}-body)`}>
        <path d={body} fill={outfit} />
        {dress && (
          <g data-testid="dress-layer">
            <path
              d="M89 145H114Q114 149 117 150L127 153L122 177Q102 184 81 177L76 153L87 150Q89 149 89 145Z"
              fill={skin}
            />
            <path
              d="M71 210Q102 219 133 210L137 220H67Z"
              fill="color-mix(in oklab, var(--avatar-outfit), #30232b 10%)"
            />
          </g>
        )}
        {p.outfit === 'sweater' && (
          <g
            fill="none"
            stroke="color-mix(in oklab, var(--avatar-outfit), #30232b 20%)"
            strokeWidth="3"
          >
            <path d="M85 150Q102 173 119 150" strokeWidth="7" />
            <path d="M52 178Q60 194 57 220M152 178Q144 194 147 220" opacity=".45" />
            <path d="M57 211h91" strokeWidth="6" opacity=".4" />
          </g>
        )}
        {p.outfit === 'collar' && (
          <path d="M87 150l15 13-14 15-14-23M117 150l-15 13 14 15 14-23" fill="#fff9f3" />
        )}
        {p.outfit === 'hoodie' && (
          <>
            <path
              d="M78 153Q69 173 102 179Q136 173 126 153"
              fill="none"
              stroke="color-mix(in oklab, var(--avatar-outfit), #fff9f3 40%)"
              strokeWidth="9"
            />
            <path
              d="M88 178v21m28-21v21"
              stroke="#fff9f3"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
            <path
              d="M78 216l5-15h38l5 15Z"
              fill="none"
              stroke="color-mix(in oklab, var(--avatar-outfit), #30232b 20%)"
              strokeWidth="2"
            />
          </>
        )}
        {p.outfit === 'overalls' && (
          <>
            <path
              d="M73 154h12v29h34v-29h12v37l8 29H65l8-29Z"
              fill={materialBoundary(outfit) === '#f1ddc8' ? '#b7cad7' : '#364d6e'}
            />
            <path
              d="M89 193h26v15H89Z"
              fill="none"
              stroke={materialBoundary(
                materialBoundary(outfit) === '#f1ddc8' ? '#b7cad7' : '#364d6e',
              )}
              strokeWidth="2"
            />
            <g fill="#eadfc9">
              <circle cx="79" cy="183" r="3" />
              <circle cx="125" cy="183" r="3" />
            </g>
          </>
        )}
      </g>
      {!scarf && (
        <g fill={skin}>
          <ellipse cx="62" cy="99" rx="8" ry="11" />
          <ellipse cx="141" cy="99" rx="8" ry="11" />
        </g>
      )}
      <ellipse cx="102" cy="94" rx="40" ry="45" fill={`url(#${id}-skin)`} />
      {scarf ? (
        <path
          d="M58 93Q50 41 102 34Q155 40 147 93Q124 59 99 53Q87 78 58 93ZM58 113Q69 147 102 151Q136 146 147 113L154 163Q99 182 49 162Z"
          fill={hat}
        />
      ) : (
        <path
          d={
            p.hair === 'pixie'
              ? 'M58 87Q48 35 104 31Q151 35 147 79L123 60 113 76 96 58Q85 79 58 87Z'
              : p.hair === 'bob'
                ? 'M57 87Q53 35 104 33Q153 37 147 88L129 70 129 82 111 66 105 79 88 64Q78 82 57 87Z'
                : p.hair === 'curls'
                  ? 'M55 83Q42 60 65 56Q60 34 84 42Q95 21 111 42Q137 29 140 54Q163 56 148 82Q128 68 105 59Q83 86 55 83Z'
                  : 'M57 88Q55 35 105 33Q153 36 147 88Q127 66 104 59Q88 80 57 88Z'
          }
          fill={`url(#${id}-hair)`}
        />
      )}
      {p.hat === 'cap' && (
        <g fill={hat}>
          <path d="M52 74Q53 26 103 24Q151 26 152 74Q101 61 52 74Z" />
          <path d="M51 71Q103 58 155 72L172 82Q131 93 100 76Q73 83 51 80Z" />
          <path d="M104 29V64" fill="none" stroke="#fff9f3" strokeOpacity=".2" strokeWidth="2" />
        </g>
      )}
      {p.hat === 'beanie' && (
        <g fill={hat}>
          <path d="M49 70Q50 23 102 21Q154 23 155 70Z" />
          <rect x="49" y="61" width="106" height="21" rx="7" />
          <path
            d="M58 65v12m12-12v12m12-12v12m12-12v12m12-12v12m12-12v12m12-12v12m12-12v12"
            stroke="#fff9f3"
            strokeOpacity=".2"
            strokeWidth="2"
          />
          <circle cx="102" cy="22" r="10" />
        </g>
      )}
      <g
        fill="none"
        stroke="#30232b"
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path data-testid="avatar-eyes" d={eyes} />
        <path className="avatar-mouth-rest" d="M94 112q0 12 8 12t8-12" />
        <path className="avatar-mouth avatar-mouth-closed" d="M96 117h12" />
        <ellipse
          className="avatar-mouth avatar-mouth-small"
          cx="102"
          cy="117"
          rx="4"
          ry="4.5"
          fill="#63363c"
          strokeWidth="2"
        />
        <ellipse
          className="avatar-mouth avatar-mouth-open"
          cx="102"
          cy="117"
          rx="5.5"
          ry="7"
          fill="#63363c"
          strokeWidth="2"
        />
      </g>
      <g fill="#df8490" opacity=".4">
        <ellipse cx="77" cy="111" rx="7" ry="3" />
        <ellipse cx="128" cy="111" rx="7" ry="3" />
      </g>
      {p.accessory === 'clip' && p.hat === 'none' && (
        <path d="M129 62l11 8" stroke="#e0b1e5" strokeWidth="7" strokeLinecap="round" />
      )}
      {p.accessory === 'glasses' && (
        <g fill="none" stroke="#514456" strokeWidth="2.5">
          <circle cx="85" cy="99" r="13" />
          <circle cx="118" cy="99" r="13" />
          <path d="M98 98h7M65 95l7 2m59 0 9-3" />
        </g>
      )}
      {p.accessory === 'earrings' && !scarf && (
        <g fill="none" stroke="#e2be6b" strokeWidth="3">
          <circle cx="62" cy="116" r="6" />
          <circle cx="142" cy="116" r="6" />
        </g>
      )}
      {p.accessory === 'stars' && p.hat === 'none' && (
        <path d="M136 56l3 7 8 1-6 5 2 8-7-4-7 4 2-8-6-5 8-1Z" fill="#f0d08c" />
      )}
    </svg>
  );
}
