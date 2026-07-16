import { useEffect, useState } from 'react';
import { Mascot } from './Mascot';

// Boot splash held for a minimum duration so it's actually visible while the
// rest of the app loads behind it.
export function Splash() {
  const [pct, setPct] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const id = window.setInterval(() => {
      const p = Math.min(100, ((Date.now() - start) / 5000) * 100);
      setPct(p);
      if (p >= 100) window.clearInterval(id);
    }, 60);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="animate-fade-in relative flex h-screen w-screen flex-col items-center justify-center gap-6 bg-bg">
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage: 'radial-gradient(var(--color-accent) 1.5px, transparent 1.5px)',
          backgroundSize: '26px 26px',
        }}
        aria-hidden
      />

      <div className="relative flex flex-col items-center gap-4">
        <Mascot mood="happy" size={96} />
        <div className="flex items-center gap-2.5">
          <span className="h-3.5 w-3.5 rounded-[3px] bg-accent" />
          <span className="text-3xl font-extrabold tracking-tight text-text">Locked In</span>
        </div>

        {/* chunky progress bar */}
        <div
          className="mt-2 h-3 w-56 overflow-hidden rounded-[4px] border-2 bg-surface"
          style={{ borderColor: 'var(--color-border-strong)' }}
        >
          <div
            className="h-full rounded-[2px] bg-accent"
            style={{ width: `${pct}%`, transition: 'width 80ms linear' }}
          />
        </div>
      </div>
    </div>
  );
}
