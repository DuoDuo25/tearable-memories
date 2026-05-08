interface EndingProps {
  title: string;
  sub: string;
  ctaLabel: string;
  revealed: boolean;
  onCta: () => void;
}

/**
 * The hidden 4th-layer ending overlay. Stays opacity-0 until `revealed=true`,
 * at which point the text fades in and the CTA button pops with a tiny delay.
 *
 * Tailwind v4 utilities + small inline `<style>` block for the keyframes.
 */
export function Ending({ title, sub, ctaLabel, revealed, onCta }: EndingProps) {
  return (
    <>
      <style>{`
        @keyframes ctaPop {
          0%   { opacity: 0; transform: translateY(14px) scale(0.96); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
        .ending-cta-anim { animation: ctaPop 0.9s cubic-bezier(.2,.9,.2,1) 0.85s forwards; }
      `}</style>
      <div
        aria-hidden={!revealed}
        className={[
          'fixed inset-0 z-[3] flex items-center justify-center pointer-events-none',
          'transition-opacity duration-[1400ms] ease-[cubic-bezier(.2,.7,.2,1)] delay-[250ms]',
          revealed ? 'opacity-100' : 'opacity-0',
        ].join(' ')}
      >
        <div className="text-center text-white px-6 max-w-[680px]">
          <div
            className="font-semibold uppercase mb-[18px]"
            style={{
              fontFamily: "'Space Grotesk','Inter',sans-serif",
              fontSize: 'clamp(11px, 1.6vw, 14px)',
              letterSpacing: '0.32em',
              color: 'rgba(255,255,255,0.62)',
              textShadow: '0 2px 14px rgba(0,0,0,0.6)',
            }}
          >
            {title}
          </div>
          <div
            className="font-bold italic mb-12 leading-tight"
            style={{
              fontFamily: "'Inter', serif",
              fontSize: 'clamp(28px, 5.2vw, 64px)',
              letterSpacing: '-0.01em',
              textShadow: '0 4px 30px rgba(0,0,0,0.7)',
            }}
          >
            {sub}
          </div>
          <button
            type="button"
            onClick={onCta}
            className={[
              'inline-flex items-center gap-2.5 bg-white text-neutral-950',
              'rounded-full px-7 py-4 text-sm font-bold cursor-pointer',
              'transition-[transform,box-shadow,background] duration-[250ms]',
              'hover:-translate-y-0.5 hover:bg-[#f5f5f5] active:translate-y-0',
              revealed ? 'pointer-events-auto ending-cta-anim opacity-0' : 'pointer-events-none opacity-0',
            ].join(' ')}
            style={{
              letterSpacing: '0.04em',
              boxShadow: '0 14px 36px rgba(0,0,0,0.45), 0 2px 6px rgba(0,0,0,0.3)',
              fontFamily: "'Inter',sans-serif",
            }}
          >
            {ctaLabel}
            <span className="font-medium transition-transform duration-200 group-hover:translate-x-1">→</span>
          </button>
        </div>
      </div>
    </>
  );
}
