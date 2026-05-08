import { useEffect, useRef, useState } from 'react';
import { resizeImage, isImageFile, type ResizedImage } from '../lib/resize';
import { createAlbum, uploadToPresigned, finalizeAlbum } from '../lib/api';

const MIN_SLOTS = 1;
const MAX_SLOTS = 5;
const TITLE_MAX = 80;
const SUBTITLE_MAX = 80;
const ENDING_TITLE_MAX = 80;
const ENDING_SUB_MAX = 200;
const CTA_MAX = 32;

interface PhotoSlot {
  id: string;
  file: File;
  preview: string;
  resized: ResizedImage | null;   // populated on publish
  title: string;
  subtitle: string;
}

type Stage = 'edit' | 'publishing' | 'success' | 'error';

interface BuilderModalProps {
  open: boolean;
  onClose: () => void;
}

export function BuilderModal({ open, onClose }: BuilderModalProps) {
  const [slots, setSlots] = useState<PhotoSlot[]>([]);
  const [endingTitle, setEndingTitle] = useState('看到这里');
  const [endingSub, setEndingSub] = useState('说明你是一个很有趣的人');
  const [endingCta, setEndingCta] = useState('做同款');
  const [stage, setStage] = useState<Stage>('edit');
  const [progress, setProgress] = useState({ resized: 0, uploaded: 0 });
  const [result, setResult] = useState<{ id: string; editToken: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Revoke preview URLs when slots leave the DOM.
  useEffect(() => {
    return () => { slots.forEach(s => URL.revokeObjectURL(s.preview)); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Esc to close (only while editing — don't bail out mid-publish)
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && stage === 'edit') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, stage, onClose]);

  if (!open) return null;

  function handleFiles(fileList: FileList | null) {
    if (!fileList) return;
    setError(null);
    const room = MAX_SLOTS - slots.length;
    const incoming = Array.from(fileList).filter(isImageFile).slice(0, room);
    if (incoming.length === 0) {
      if (fileList.length > 0) setError('只支持 JPEG / PNG / WebP / HEIC');
      return;
    }
    const fresh: PhotoSlot[] = incoming.map((file) => ({
      id: Math.random().toString(36).slice(2),
      file,
      preview: URL.createObjectURL(file),
      resized: null,
      title: '',
      subtitle: '',
    }));
    setSlots((prev) => [...prev, ...fresh]);
  }

  function removeSlot(id: string) {
    setSlots((prev) => {
      const dropped = prev.find((s) => s.id === id);
      if (dropped) URL.revokeObjectURL(dropped.preview);
      return prev.filter((s) => s.id !== id);
    });
  }

  function move(id: string, dir: -1 | 1) {
    setSlots((prev) => {
      const i = prev.findIndex((s) => s.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  function patchSlot(id: string, patch: Partial<PhotoSlot>) {
    setSlots((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }

  async function publish() {
    if (slots.length < MIN_SLOTS) { setError(`至少要 ${MIN_SLOTS} 张照片`); return; }
    if (slots.length > MAX_SLOTS) { setError(`最多 ${MAX_SLOTS} 张照片`); return; }

    setError(null);
    setStage('publishing');
    setProgress({ resized: 0, uploaded: 0 });

    try {
      // 1. Resize each photo client-side, sequentially so we can report
      // progress and not OOM by parallelizing huge bitmap decodes.
      const resized: ResizedImage[] = [];
      for (let i = 0; i < slots.length; i++) {
        const r = await resizeImage(slots[i].file);
        resized.push(r);
        setProgress({ resized: i + 1, uploaded: 0 });
      }

      // 2. POST /albums to mint id + presigned PUTs.
      const created = await createAlbum({
        photos: slots.map((s, i) => ({
          title: s.title,
          subtitle: s.subtitle,
          contentType: resized[i].contentType,
          bytes: resized[i].bytes,
        })),
        ending_title: endingTitle,
        ending_sub: endingSub,
        cta_label: endingCta || undefined,
      });

      // 3. Upload to presigned URLs in parallel — independent S3 PUTs.
      let done = 0;
      await Promise.all(created.uploads.map(async (slot) => {
        await uploadToPresigned(slot, resized[slot.position].blob);
        done++;
        setProgress({ resized: slots.length, uploaded: done });
      }));

      // 4. Server-side HEAD-verify + flip to ready.
      await finalizeAlbum(created.id, created.edit_token);

      setResult({ id: created.id, editToken: created.edit_token });
      setStage('success');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      setStage('error');
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(8px)' }}
    >
      <div
        className="bg-white text-neutral-900 rounded-2xl w-full max-w-[640px] max-h-[92vh] overflow-y-auto shadow-2xl"
        style={{ fontFamily: "'Inter','Helvetica Neue',sans-serif" }}
      >
        {stage === 'success' && result ? (
          <SuccessCard
            id={result.id}
            editToken={result.editToken}
            onClose={onClose}
          />
        ) : (
          <EditView
            slots={slots}
            endingTitle={endingTitle}
            endingSub={endingSub}
            endingCta={endingCta}
            stage={stage}
            progress={progress}
            error={error}
            slotCount={slots.length}
            onPickFile={() => fileInputRef.current?.click()}
            onRemove={removeSlot}
            onMove={move}
            onPatchSlot={patchSlot}
            onSetEndingTitle={setEndingTitle}
            onSetEndingSub={setEndingSub}
            onSetEndingCta={setEndingCta}
            onCancel={onClose}
            onPublish={publish}
            onRetry={() => { setStage('edit'); setError(null); }}
          />
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => { handleFiles(e.target.files); e.target.value = ''; }}
      />
    </div>
  );
}

// ============================================================
//  Sub-views
// ============================================================

interface EditViewProps {
  slots: PhotoSlot[];
  endingTitle: string;
  endingSub: string;
  endingCta: string;
  stage: Stage;
  progress: { resized: number; uploaded: number };
  error: string | null;
  slotCount: number;
  onPickFile: () => void;
  onRemove: (id: string) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  onPatchSlot: (id: string, patch: Partial<PhotoSlot>) => void;
  onSetEndingTitle: (v: string) => void;
  onSetEndingSub: (v: string) => void;
  onSetEndingCta: (v: string) => void;
  onCancel: () => void;
  onPublish: () => void;
  onRetry: () => void;
}

function EditView(p: EditViewProps) {
  const publishing = p.stage === 'publishing';
  const errored = p.stage === 'error';
  const canPublish = p.slotCount >= MIN_SLOTS && p.slotCount <= MAX_SLOTS && !publishing;

  return (
    <div className="p-6 sm:p-8 space-y-6">
      <header>
        <h2 className="text-xl sm:text-2xl font-bold tracking-tight">做你自己的撕拉相册</h2>
        <p className="text-sm text-neutral-500 mt-1">1–5 张照片，每张一行小标题 + 一行主文案。撕到底显示你的结尾。</p>
      </header>

      {/* Photos */}
      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">照片 · {p.slotCount}/{MAX_SLOTS}</h3>

        {p.slots.length === 0 ? (
          <button
            type="button"
            onClick={p.onPickFile}
            className="w-full border-2 border-dashed border-neutral-300 rounded-xl py-12 text-neutral-500 hover:border-neutral-900 hover:text-neutral-900 transition"
          >
            <div className="text-3xl mb-1">＋</div>
            <div className="text-sm font-semibold">添加照片</div>
            <div className="text-xs text-neutral-400 mt-1">最少 1 张，最多 5 张</div>
          </button>
        ) : (
          <ol className="space-y-3">
            {p.slots.map((s, i) => (
              <li key={s.id} className="flex gap-3 items-stretch bg-neutral-50 rounded-xl p-3">
                <img src={s.preview} alt="" className="w-20 h-28 sm:w-24 sm:h-32 object-cover rounded-lg flex-shrink-0" />
                <div className="flex-1 min-w-0 flex flex-col gap-2">
                  <input
                    type="text"
                    value={s.title}
                    maxLength={TITLE_MAX}
                    placeholder="小标题（如日期）"
                    onChange={(e) => p.onPatchSlot(s.id, { title: e.target.value })}
                    className="w-full bg-white border border-neutral-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900"
                  />
                  <input
                    type="text"
                    value={s.subtitle}
                    maxLength={SUBTITLE_MAX}
                    placeholder="主文案（如 @地点）"
                    onChange={(e) => p.onPatchSlot(s.id, { subtitle: e.target.value })}
                    className="w-full bg-white border border-neutral-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900"
                  />
                </div>
                <div className="flex flex-col items-center gap-1 text-neutral-400">
                  <button
                    type="button" onClick={() => p.onMove(s.id, -1)} disabled={i === 0}
                    className="w-7 h-7 rounded hover:bg-neutral-200 disabled:opacity-30 disabled:cursor-not-allowed"
                    aria-label="上移"
                  >▲</button>
                  <button
                    type="button" onClick={() => p.onMove(s.id, 1)} disabled={i === p.slots.length - 1}
                    className="w-7 h-7 rounded hover:bg-neutral-200 disabled:opacity-30 disabled:cursor-not-allowed"
                    aria-label="下移"
                  >▼</button>
                  <button
                    type="button" onClick={() => p.onRemove(s.id)}
                    className="w-7 h-7 rounded text-red-500 hover:bg-red-50"
                    aria-label="删除"
                  >✕</button>
                </div>
              </li>
            ))}
            {p.slots.length < MAX_SLOTS && (
              <li>
                <button
                  type="button" onClick={p.onPickFile}
                  className="w-full border border-dashed border-neutral-300 rounded-xl py-4 text-neutral-500 text-sm hover:border-neutral-900 hover:text-neutral-900 transition"
                >＋ 再加一张（{MAX_SLOTS - p.slots.length} 个名额）</button>
              </li>
            )}
          </ol>
        )}
      </section>

      {/* Ending */}
      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">撕完后看到的最后一页</h3>
        <input
          type="text" value={p.endingTitle} maxLength={ENDING_TITLE_MAX}
          placeholder="小标题（看到这里）"
          onChange={(e) => p.onSetEndingTitle(e.target.value)}
          className="w-full bg-neutral-50 border border-neutral-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900"
        />
        <input
          type="text" value={p.endingSub} maxLength={ENDING_SUB_MAX}
          placeholder="主文案（说明你是一个很有趣的人）"
          onChange={(e) => p.onSetEndingSub(e.target.value)}
          className="w-full bg-neutral-50 border border-neutral-200 rounded-md px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-neutral-900"
        />
        <input
          type="text" value={p.endingCta} maxLength={CTA_MAX}
          placeholder='按钮文字（默认"做同款"）'
          onChange={(e) => p.onSetEndingCta(e.target.value)}
          className="w-full bg-neutral-50 border border-neutral-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900"
        />
      </section>

      {/* Progress / error */}
      {publishing && (
        <div className="text-sm text-neutral-700 bg-neutral-100 rounded-md px-4 py-3 flex items-center gap-3">
          <Spinner />
          <span>
            {p.progress.resized < p.slotCount
              ? `处理图片 ${p.progress.resized}/${p.slotCount}…`
              : `上传 ${p.progress.uploaded}/${p.slotCount}…`}
          </span>
        </div>
      )}
      {errored && p.error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-4 py-3 flex items-start gap-3">
          <span>发布失败：{p.error}</span>
          <button type="button" onClick={p.onRetry} className="ml-auto font-semibold underline">重试</button>
        </div>
      )}
      {!publishing && !errored && p.error && (
        <div className="text-sm text-red-600">{p.error}</div>
      )}

      {/* Footer */}
      <footer className="flex justify-between items-center pt-2">
        <button
          type="button" onClick={p.onCancel} disabled={publishing}
          className="px-5 py-2.5 text-sm font-semibold text-neutral-600 hover:text-neutral-900 disabled:opacity-30"
        >取消</button>
        <button
          type="button" onClick={p.onPublish} disabled={!canPublish}
          className="px-6 py-2.5 rounded-full bg-neutral-900 text-white text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-neutral-800"
        >{publishing ? '发布中…' : '发布 →'}</button>
      </footer>
    </div>
  );
}

interface SuccessCardProps {
  id: string;
  editToken: string;
  onClose: () => void;
}

function SuccessCard({ id, editToken, onClose }: SuccessCardProps) {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const publicUrl = `${origin}/m/${id}`;
  const editUrl = `${origin}/m/${id}/edit?t=${editToken}`;

  return (
    <div className="p-8 sm:p-10 space-y-6">
      <div className="text-center space-y-2">
        <div className="text-5xl">✨</div>
        <h2 className="text-2xl font-bold tracking-tight">发布成功</h2>
        <p className="text-sm text-neutral-500">下面两个链接 — 公开的可以分享，编辑链接自己保管，丢了找不回</p>
      </div>

      <CopyRow label="🌐 公开链接（分享给别人）" value={publicUrl} />
      <CopyRow label="🔒 编辑链接（自己保管）" value={editUrl} subtle />

      <div className="flex gap-3 pt-2">
        <a
          href={publicUrl}
          className="flex-1 px-5 py-3 rounded-full bg-neutral-900 text-white text-sm font-bold text-center hover:bg-neutral-800"
        >看一下我的相册 →</a>
        <button
          type="button" onClick={onClose}
          className="px-5 py-3 text-sm font-semibold text-neutral-600 hover:text-neutral-900"
        >关闭</button>
      </div>
    </div>
  );
}

function CopyRow({ label, value, subtle }: { label: string; value: string; subtle?: boolean }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* ignore */ }
  }
  return (
    <div>
      <div className="text-xs font-semibold text-neutral-500 mb-1.5">{label}</div>
      <div className={`flex gap-2 items-stretch ${subtle ? 'opacity-90' : ''}`}>
        <input
          readOnly
          value={value}
          className="flex-1 bg-neutral-50 border border-neutral-200 rounded-md px-3 py-2 text-xs font-mono text-neutral-700 focus:outline-none focus:ring-2 focus:ring-neutral-900"
          onFocus={(e) => e.currentTarget.select()}
        />
        <button
          type="button" onClick={copy}
          className="px-4 rounded-md bg-neutral-900 text-white text-xs font-bold hover:bg-neutral-800"
        >{copied ? '已复制' : '复制'}</button>
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <>
      <style>{`@keyframes builderSpin { to { transform: rotate(360deg); } }`}</style>
      <span
        className="inline-block w-4 h-4 rounded-full border-2 border-neutral-300"
        style={{
          borderTopColor: '#0d0d0f',
          animation: 'builderSpin 0.7s linear infinite',
        }}
      />
    </>
  );
}
