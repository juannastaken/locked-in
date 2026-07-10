import { useEffect, useState } from 'react';

export type MascotMood =
  | 'sleep'
  | 'relax'
  | 'happy'
  | 'think'
  | 'focus'
  | 'sad'
  | 'hyped'
  | 'angry';

/**
 * 14x12 chunky pixel creature with legs. '.' empty, 'B' body (accent), 'D' dark features.
 * Rows 0-8 = head/body (mood-dependent face), rows 9-11 = legs (walk frames).
 */
const R_ANTENNA = '......BB......';
const R_HEAD_TOP = '....BBBBBB....';
const R_HEAD = '..BBBBBBBBBB..';

// face rows (3,4,5 = eye zone; 6 = mouth zone; 7 = chin)
const EYES_UP_A = '.BBDDBBBBDDBB.';
const EYES_ROW_PLAIN = '.BBBBBBBBBBBB.';
const CHIN = '..BBBBBBBBBB..';

const MOUTH_NEUTRAL = '.BBBBBDDBBBBB.';
const MOUTH_SMILE = '.BBBDDDDDDBBB.';
const MOUTH_GRIN = '.BBDDDDDDDDBB.';
const MOUTH_NONE = '.BBBBBBBBBBBB.';
const CHIN_FROWN = '..BBBDDDDBBB..';

// legs: 4 legs, two walk frames
const LEGS_ROW = '.BB.BB..BB.BB.';
const FEET_A = '.BB........BB.';
const FEET_B = '....BB....BB..';
const FEET_REST = '.BB.BB..BB.BB.';

interface Face {
  r3: string;
  r4: string;
  r5: string;
  r6: string;
  r7: string;
}

const FACE_OPEN: Face = {
  r3: EYES_ROW_PLAIN,
  r4: EYES_UP_A,
  r5: EYES_UP_A,
  r6: MOUTH_NEUTRAL,
  r7: CHIN,
};
const FACE_CLOSED: Face = {
  r3: EYES_ROW_PLAIN,
  r4: EYES_ROW_PLAIN,
  r5: EYES_UP_A,
  r6: MOUTH_NEUTRAL,
  r7: CHIN,
};
const FACE_HAPPY_A: Face = {
  r3: EYES_ROW_PLAIN,
  r4: EYES_ROW_PLAIN,
  r5: EYES_UP_A,
  r6: MOUTH_SMILE,
  r7: CHIN,
};
const FACE_HAPPY_B: Face = { ...FACE_HAPPY_A, r4: EYES_UP_A, r5: EYES_UP_A };
const FACE_THINK: Face = {
  r3: EYES_UP_A,
  r4: EYES_UP_A,
  r5: EYES_ROW_PLAIN,
  r6: MOUTH_NEUTRAL,
  r7: CHIN,
};
const FACE_SAD: Face = {
  r3: EYES_ROW_PLAIN,
  r4: EYES_UP_A,
  r5: EYES_UP_A,
  r6: MOUTH_NONE,
  r7: CHIN_FROWN,
};
const FACE_SAD_BLINK: Face = { ...FACE_SAD, r4: EYES_ROW_PLAIN, r5: EYES_UP_A };
const FACE_SLEEP: Face = {
  r3: EYES_ROW_PLAIN,
  r4: EYES_ROW_PLAIN,
  r5: EYES_UP_A,
  r6: MOUTH_NONE,
  r7: CHIN,
};
const FACE_HYPED_A: Face = {
  r3: EYES_ROW_PLAIN,
  r4: EYES_UP_A,
  r5: EYES_UP_A,
  r6: MOUTH_SMILE,
  r7: CHIN,
};
const FACE_HYPED_B: Face = { ...FACE_HYPED_A, r6: MOUTH_GRIN };
// angry: inner brow tips slanting down + clenched frown
const BROWS_IN = '.BBBDBBBBDBBB.';
const BROWS_OUT = '.BBDBBBBBBDBB.';
const FACE_ANGRY_A: Face = {
  r3: BROWS_IN,
  r4: EYES_UP_A,
  r5: EYES_UP_A,
  r6: MOUTH_NONE,
  r7: CHIN_FROWN,
};
const FACE_ANGRY_B: Face = { ...FACE_ANGRY_A, r3: BROWS_OUT };

const MOOD_FACES: Record<MascotMood, [Face, Face]> = {
  sleep: [FACE_SLEEP, FACE_SLEEP],
  relax: [FACE_OPEN, FACE_CLOSED],
  happy: [FACE_HAPPY_A, FACE_HAPPY_B],
  think: [FACE_THINK, FACE_THINK],
  focus: [FACE_OPEN, FACE_OPEN],
  sad: [FACE_SAD, FACE_SAD_BLINK],
  hyped: [FACE_HYPED_A, FACE_HYPED_B],
  angry: [FACE_ANGRY_A, FACE_ANGRY_B],
};

const FACE_MS: Record<MascotMood, number> = {
  sleep: 2000,
  relax: 2400,
  happy: 400,
  think: 800,
  focus: 4000,
  sad: 2200,
  hyped: 600,
  angry: 450,
};

function buildMap(face: Face, feet: string): string[] {
  return [
    R_ANTENNA,
    R_HEAD_TOP,
    R_HEAD,
    face.r3,
    face.r4,
    face.r5,
    face.r6,
    face.r7,
    R_HEAD,
    LEGS_ROW,
    feet,
  ];
}

interface MascotProps {
  mood: MascotMood;
  size?: number;
  className?: string;
  /** floating zzz / thought dots */
  effects?: boolean;
  /** walk cycle: alternating feet + strolling side to side */
  walk?: boolean;
}

export function Mascot({ mood, size = 64, className = '', effects = true, walk = false }: MascotProps) {
  const [faceFrame, setFaceFrame] = useState(0);
  const [legFrame, setLegFrame] = useState(0);

  useEffect(() => {
    setFaceFrame(0);
    const id = window.setInterval(() => setFaceFrame((f) => (f === 0 ? 1 : 0)), FACE_MS[mood]);
    return () => window.clearInterval(id);
  }, [mood]);

  const legsMoving = walk || mood === 'happy' || mood === 'hyped';
  useEffect(() => {
    if (!legsMoving) {
      setLegFrame(0);
      return;
    }
    const id = window.setInterval(() => setLegFrame((f) => (f === 0 ? 1 : 0)), 240);
    return () => window.clearInterval(id);
  }, [legsMoving]);

  const face = MOOD_FACES[mood][faceFrame];
  const feet = legsMoving ? (legFrame === 0 ? FEET_A : FEET_B) : FEET_REST;
  const map = buildMap(face, feet);

  const pixels: { x: number; y: number; c: string }[] = [];
  map.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch === 'B') pixels.push({ x, y, c: 'var(--color-accent)' });
      else if (ch === 'D') pixels.push({ x, y, c: 'var(--color-bg)' });
    }
  });

  const motion =
    mood === 'happy' || mood === 'hyped'
      ? 'animate-mascot-bounce'
      : mood === 'angry'
        ? 'animate-mascot-rage'
        : mood === 'sleep'
          ? 'animate-mascot-breathe'
          : walk
            ? ''
            : 'animate-mascot-bob';

  const inner = (
    <div
      className={`relative inline-block select-none ${walk ? '' : className}`}
      style={{ width: size, height: size * (11 / 14) + (effects ? 8 : 0) }}
      aria-hidden
    >
      {effects && mood === 'sleep' && (
        <span className="animate-mascot-zzz absolute -top-1 right-1 font-mono text-[10px] font-bold text-text-faint">
          z
        </span>
      )}
      {effects && mood === 'think' && (
        <div className="absolute -top-2 right-0 flex items-end gap-[3px]">
          <span className="animate-pulse-dot h-1 w-1 rounded-full bg-text-faint" />
          <span
            className="animate-pulse-dot h-1.5 w-1.5 rounded-full bg-text-dim"
            style={{ animationDelay: '0.3s' }}
          />
          <span
            className="animate-pulse-dot h-2 w-2 rounded-full bg-accent"
            style={{ animationDelay: '0.6s' }}
          />
        </div>
      )}
      {effects && mood === 'angry' && (
        <span
          className="animate-pulse-dot absolute -top-1.5 -right-1 font-mono text-[11px] font-bold leading-none text-danger"
          aria-hidden
        >
          ✕
        </span>
      )}
      {effects && mood === 'hyped' && (
        <>
          <span
            className="animate-mascot-sparkle absolute -top-1 -left-1 text-[9px] leading-none text-accent"
            aria-hidden
          >
            ✦
          </span>
          <span
            className="animate-mascot-sparkle absolute -top-2 right-0 text-[11px] leading-none text-accent"
            style={{ animationDelay: '0.5s' }}
            aria-hidden
          >
            ✦
          </span>
        </>
      )}
      <svg
        viewBox="0 0 14 11"
        width={size}
        height={size * (11 / 14)}
        className={`${motion} block`}
        shapeRendering="crispEdges"
      >
        {pixels.map((p, i) => (
          <rect key={i} x={p.x} y={p.y} width={1.03} height={1.03} fill={p.c} />
        ))}
      </svg>
    </div>
  );

  if (walk) {
    return (
      <div className={`animate-mascot-walk inline-block ${className}`} aria-hidden>
        {inner}
      </div>
    );
  }
  return inner;
}
