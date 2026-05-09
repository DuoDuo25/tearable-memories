import { useEffect, useState } from 'react';

interface TearHintProps {
  isMobile: boolean;
}

/**
 * 2.5-second onboarding overlay shown when a visitor lands on someone's
 * shared album (`/m/<id>`). Auto-dismisses on a timer or on the first
 * pointer-down anywhere — whichever comes first. Two copy variants so
 * the gesture matches the device.
 */
export function TearHint({ isMobile }: TearHintProps) {
  const [visible, setVisible] = useState(true);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    const fadeTimer = setTimeout(() => setFading(true), 2500);
    const removeTimer = setTimeout(() => setVisible(false), 3300);

    const onInteract = () => {
      setFading(true);
      setTimeout(() => setVisible(false), 600);
    };
    window.addEventListener('pointerdown', onInteract, { once: true });

    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(removeTimer);
      window.removeEventListener('pointerdown', onInteract);
    };
  }, []);

  if (!visible) return null;

  const text = isMobile ? '用手指撕开屏幕' : '按住鼠标，拖一下';

  return (
    <>
      <style>{`
        @keyframes hintTear {
          0%   { transform: translate(28px, -28px) scale(.9); opacity: 0; }
          15%  { opacity: 1; }
          85%  { transform: translate(-28px, 28px) scale(1); opacity: 1; }
          100% { transform: translate(-28px, 28px) scale(.9); opacity: 0; }
        }
        @keyframes hintTrail {
          0%   { stroke-dashoffset: 88; opacity: 0; }
          15%  { opacity: 0.55; }
          85%  { opacity: 0.55; }
          100% { stroke-dashoffset: 0;  opacity: 0; }
        }
        @keyframes hintBob {
          0%, 100% { transform: translateY(0); }
          50%      { transform: translateY(-6px); }
        }
        .hint-overlay {
          position: fixed; inset: 0; z-index: 50;
          display: flex; align-items: center; justify-content: center;
          background: rgba(0,0,0,0.42);
          backdrop-filter: blur(6px);
          -webkit-backdrop-filter: blur(6px);
          pointer-events: none;
          transition: opacity 600ms cubic-bezier(.2,.7,.2,1);
        }
        .hint-overlay.fading { opacity: 0; }
        .hint-inner {
          text-align: center; color: rgba(255,255,255,0.95);
          font-family: 'Inter','Helvetica Neue',-apple-system,sans-serif;
          animation: hintBob 2s ease-in-out infinite;
        }
        .hint-icon-wrap {
          position: relative; width: 120px; height: 120px; margin: 0 auto 24px;
        }
        .hint-trail {
          stroke: rgba(255,255,255,0.55);
          stroke-width: 3;
          stroke-dasharray: 6 6;
          stroke-linecap: round;
          fill: none;
          stroke-dashoffset: 88;
          animation: hintTrail 1.6s cubic-bezier(.55,.08,.45,.92) infinite;
        }
        .hint-dot {
          position: absolute;
          width: 28px; height: 28px;
          left: 30px; top: 30px;
          background: white;
          border-radius: 50%;
          box-shadow: 0 0 24px rgba(255,255,255,0.45),
                      0 4px 12px rgba(0,0,0,0.4);
          animation: hintTear 1.6s cubic-bezier(.55,.08,.45,.92) infinite;
        }
        .hint-finger {
          position: absolute;
          left: 22px; top: 22px;
          font-size: 36px;
          line-height: 1;
          animation: hintTear 1.6s cubic-bezier(.55,.08,.45,.92) infinite;
          filter: drop-shadow(0 4px 12px rgba(0,0,0,0.5));
        }
        .hint-text {
          font-size: 17px; font-weight: 600;
          letter-spacing: 0.04em;
          text-shadow: 0 2px 12px rgba(0,0,0,0.6);
        }
        .hint-sub {
          margin-top: 6px;
          font-size: 12px; font-weight: 500;
          color: rgba(255,255,255,0.6);
          letter-spacing: 0.08em;
        }
      `}</style>
      <div className={`hint-overlay ${fading ? 'fading' : ''}`}>
        <div className="hint-inner">
          <div className="hint-icon-wrap">
            <svg width="120" height="120" viewBox="0 0 120 120" aria-hidden="true">
              {/* trailing dashed line from upper-right to lower-left */}
              <path className="hint-trail" d="M 92 28 L 28 92" />
            </svg>
            {isMobile ? (
              <div className="hint-finger">👆</div>
            ) : (
              <div className="hint-dot" />
            )}
          </div>
          <div className="hint-text">{text}</div>
          <div className="hint-sub">TEAR · DRAG · 撕</div>
        </div>
      </div>
    </>
  );
}
