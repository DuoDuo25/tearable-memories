import { ENDING_CTA_GEOMETRY } from '../engine';

interface EndingProps {
  onCta: () => void;
}

/**
 * Transparent click target sitting where the canvas-painted CTA button is.
 *
 * The button's *visual* (white pill + label) is baked into the ending texture
 * (drawEndingTexture in engine.ts) so it peeks through any tear, just like
 * the title/subtitle. This component is purely about catching clicks/taps —
 * it is invisible and always pointer-events:auto so the user can act the
 * moment they see the button emerging from the tears.
 */
export function Ending({ onCta }: EndingProps) {
  return (
    <button
      type="button"
      onClick={onCta}
      aria-label="上传我的照片"
      className="fixed left-1/2 -translate-x-1/2 z-[3] cursor-pointer"
      style={{
        bottom: ENDING_CTA_GEOMETRY.bottomCss,
        width: ENDING_CTA_GEOMETRY.hitWidthCss + 'px',
        height: ENDING_CTA_GEOMETRY.hitHeightCss + 'px',
        background: 'transparent',
        border: 'none',
        padding: 0,
        // `appearance: none` removes default UA button styling
        appearance: 'none',
        WebkitAppearance: 'none',
      }}
    />
  );
}
