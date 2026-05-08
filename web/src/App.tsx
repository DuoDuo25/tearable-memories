import { useEffect, useMemo, useRef, useState } from 'react';
import { boot, type EngineHandle, type Photo, type EndingText } from './engine';
import { DEFAULT_PHOTOS, DEFAULT_ENDING } from './photos';
import { Ending } from './components/Ending';
import { Loader } from './components/Loader';
import { BuilderModal, type EditContext } from './components/BuilderModal';
import { parseRoute, type RouteIntent } from './lib/route';
import { readAlbum } from './lib/api';

interface SceneConfig {
  photos: Photo[];
  ending: EndingText;
}

const TEMPLATE_CONFIG: SceneConfig = {
  photos: DEFAULT_PHOTOS,
  ending: {
    title: DEFAULT_ENDING.title,
    sub: DEFAULT_ENDING.sub,
    ctaLabel: DEFAULT_ENDING.ctaLabel,
  },
};

function stripArrow(s: string | null | undefined): string {
  return (s ?? '').replace(/\s*→\s*$/, '').trim();
}

export default function App() {
  const route = useMemo<RouteIntent>(parseRoute, []);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const handleRef = useRef<EngineHandle | null>(null);

  const [config, setConfig] = useState<SceneConfig | null>(
    route.kind === 'template' ? TEMPLATE_CONFIG : null
  );
  const [editContext, setEditContext] = useState<EditContext | null>(null);
  const [loaderFading, setLoaderFading] = useState(false);
  const [loaderMessage, setLoaderMessage] = useState<string | undefined>();
  const [builderOpen, setBuilderOpen] = useState(false);

  // 1. For non-template routes, fetch the album.
  useEffect(() => {
    if (route.kind === 'template') return;
    let cancelled = false;

    setLoaderMessage(undefined);
    readAlbum(route.id)
      .then((album) => {
        if (cancelled) return;
        const sceneCfg: SceneConfig = {
          photos: album.photos.map((p) => ({
            src: p.url,
            title: p.title,
            subtitle: p.subtitle,
          })),
          ending: {
            title: album.ending_title || '看到这里',
            sub: album.ending_sub || '',
            ctaLabel: stripArrow(album.cta_label) || '做同款',
          },
        };
        setConfig(sceneCfg);

        if (route.kind === 'editor') {
          setEditContext({ id: route.id, editToken: route.token, album });
          setBuilderOpen(true);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        setLoaderMessage(`相册加载失败：${msg}`);
      });

    return () => { cancelled = true; };
  }, [route]);

  // 2. Boot the engine once a config is available.
  useEffect(() => {
    if (!config) return;
    let cancelled = false;
    (async () => {
      try {
        const handle = await boot({
          canvas: canvasRef.current!,
          photos: config.photos,
          ending: config.ending,
        });
        if (cancelled) { handle.destroy(); return; }
        handleRef.current = handle;
        setLoaderFading(true);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setLoaderMessage(`照片加载失败：${msg}`);
      }
    })();
    return () => {
      cancelled = true;
      handleRef.current?.destroy();
      handleRef.current = null;
    };
  }, [config]);

  // 3. R-key reset (suppressed while modal is open).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'r' || e.key === 'R') && !builderOpen) {
        handleRef.current?.reset();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [builderOpen]);

  return (
    <>
      <canvas ref={canvasRef} className="fixed top-0 left-0 block" />
      <Ending onCta={() => {
        // Viewer/template CTA always opens a fresh create. Edit is reached only
        // via /m/:id/edit?t=...
        setEditContext(null);
        setBuilderOpen(true);
      }} />
      <Loader fading={loaderFading} message={loaderMessage} />
      <BuilderModal
        open={builderOpen}
        onClose={() => setBuilderOpen(false)}
        edit={editContext}
      />
    </>
  );
}
