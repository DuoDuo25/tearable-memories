interface EndingProps {
  ctaLabel: string;
  revealed: boolean;
  onCta: () => void;
}

/**
 * The ending CTA button — the only DOM piece of the ending overlay.
 * Title + subtitle are painted into the canvas as a backdrop layer
 * (see drawEndingTexture in engine.ts), so they peek through any tear
 * in the photo layers immediately. This component only renders the
 * interactive bit, which fades + pops in once the engine emits the
 * onEndingReveal event.
 */
export function Ending({ ctaLabel, revealed, onCta }: EndingProps) {
  return (
    <>
      <style>{`
        @keyframes ctaPop {
          0%   { opacity: 0; transform: translateY(14px) scale(0.96); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
        .ending-cta-anim { animation: ctaPop 0.9s cubic-bezier(.2,.9,.2,1) 0s forwards; }
      `}</style>
      <div
        aria-hidden={!revealed}
        className={[
          'fixed left-0 right-0 z-[3] flex justify-center',
          'pointer-events-none',
        ].join(' ')}
        style={{ bottom: 'clamp(48px, 12vh, 120px)' }}
      >
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
            boxShadow: '0 14px 36px rgba(0,0,0,0.55), 0 3px 10px rgba(0,0,0,0.4)',
            fontFamily: "'Inter',sans-serif",
          }}
        >
          {ctaLabel}
          <span className="font-medium transition-transform duration-200">→</span>
        </button>
      </div>
    </>
  );
}
