import logoUrl from '../assets/logo.png';

/** Boot splash: wordmark over the focus-screen glow + a sweeping accent arc. */
export function Splash() {
  return (
    <div className="animate-fade-in relative flex h-screen w-screen flex-col items-center justify-center gap-8 overflow-hidden bg-bg">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(circle 63vh at 50% 45%, color-mix(in srgb, var(--color-accent) 6.5%, transparent), transparent 72%)',
        }}
        aria-hidden
      />
      <img
        src={logoUrl}
        alt="Locked In"
        draggable={false}
        className="pointer-events-none relative h-12 w-auto select-none"
      />
      <svg
        width="36"
        height="36"
        viewBox="0 0 36 36"
        className="relative animate-spin"
        style={{ animationDuration: '900ms' }}
        aria-hidden
      >
        <circle cx="18" cy="18" r="14" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="3.5" />
        <circle
          cx="18"
          cy="18"
          r="14"
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeDasharray="88"
          strokeDashoffset="66"
        />
      </svg>
    </div>
  );
}
