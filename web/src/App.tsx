import { useEffect, useRef, useState } from 'react';
import { boot, type EngineHandle } from './engine';
import { DEFAULT_PHOTOS, DEFAULT_ENDING } from './photos';
import { Ending } from './components/Ending';
import { Loader } from './components/Loader';

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const handleRef = useRef<EngineHandle | null>(null);
  const [loaderFading, setLoaderFading] = useState(false);
  const [loaderMessage, setLoaderMessage] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const handle = await boot({
          canvas: canvasRef.current!,
          photos: DEFAULT_PHOTOS,
          ending: {
            title: DEFAULT_ENDING.title,
            sub: DEFAULT_ENDING.sub,
            ctaLabel: DEFAULT_ENDING.ctaLabel,
          },
        });
        if (cancelled) { handle.destroy(); return; }
        handleRef.current = handle;
        setLoaderFading(true);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setLoaderMessage('照片加载失败：' + msg);
      }
    })();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'r' || e.key === 'R') {
        handleRef.current?.reset();
      }
    };
    window.addEventListener('keydown', onKey);

    return () => {
      cancelled = true;
      window.removeEventListener('keydown', onKey);
      handleRef.current?.destroy();
      handleRef.current = null;
    };
  }, []);

  return (
    <>
      <canvas ref={canvasRef} className="fixed top-0 left-0 block" />
      <Ending
        onCta={() => alert('Builder coming in Phase 4 — for now, this just confirms the CTA wiring works.')}
      />
      <Loader fading={loaderFading} message={loaderMessage} />
    </>
  );
}
