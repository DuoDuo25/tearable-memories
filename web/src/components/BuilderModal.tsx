import { useEffect, useMemo, useRef, useState } from 'react';
import { resizeImage, isImageFile, type ResizedImage } from '../lib/resize';
import {
  createAlbum, uploadPhoto, finalizeAlbum, updateAlbum,
  type ReadAlbumResponse,
} from '../lib/api';
import { viewerPath, editorPath } from '../lib/route';

const MIN_SLOTS = 1;
const MAX_SLOTS = 5;
const TITLE_MAX = 80;
const SUBTITLE_MAX = 80;
const ENDING_TITLE_MAX = 80;
const ENDING_SUB_MAX = 200;
const CTA_MAX = 32;

/**
 * A photo slot is either an existing already-uploaded photo (edit mode) or
 * a brand-new file the user just picked (create mode). Captions live on
 * both; uploads only apply to the latter.
 */
type PhotoSlot =
  | { id: string; kind: 'new'; file: File; preview: string; resized: ResizedImage | null; title: string; subtitle: string }
  | { id: string; kind: 'existing'; url: string; position: number; title: string; subtitle: string };

type Stage = 'edit' | 'publishing' | 'success' | 'error';

export interface EditContext {
  id: string;
  editToken: string;
  album: ReadAlbumResponse;
}

interface BuilderModalProps {
  open: boolean;
  onClose: () => void;
  /** When provided, the modal opens pre-filled and submits via PUT. */
  edit?: EditContext | null;
}

export function BuilderModal({ open, onClose, edit }: BuilderModalProps) {
  const isEdit = !!edit;

  // Initial state derived from edit context if present.
  const initial = useMemo(() => {
    if (!edit) {
      return {
        slots: [] as PhotoSlot[],
        endingTitle: '看到这里',
        endingSub: '说明你是一个很有趣的人',
        endingCta: '做同款',
      };
    }
    return {
      slots: edit.album.photos.map((p): PhotoSlot => ({
        id: 'p' + p.position,
        kind: 'existing' as const,
        url: p.url,
        position: p.position,
        title: p.title,
        subtitle: p.subtitle,
      })),
      endingTitle: edit.album.ending_title,
      endingSub: edit.album.ending_sub,
      endingCta: stripArrow(edit.album.cta_label) || '做同款',
    };
  }, [edit]);

  const [slots, setSlots] = useState<PhotoSlot[]>(initial.slots);
  const [endingTitle, setEndingTitle] = useState(initial.endingTitle);
  const [endingSub, setEndingSub] = useState(initial.endingSub);
  const [endingCta, setEndingCta] = useState(initial.endingCta);
  const [stage, setStage] = useState<Stage>('edit');
  const [progress, setProgress] = useState({ resized: 0, uploaded: 0 });
  const [result, setResult] = useState<{ id: string; editToken: string; isUpdate: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset state every time the modal opens with a different edit context.
  useEffect(() => {
    if (!open) return;
    setSlots(initial.slots);
    setEndingTitle(initial.endingTitle);
    setEndingSub(initial.endingSub);
    setEndingCta(initial.endingCta);
    setStage('edit');
    setError(null);
    setResult(null);
    setProgress({ resized: 0, uploaded: 0 });
  }, [open, initial]);

  // Revoke object URLs on unmount.
  useEffect(() => {
    return () => {
      slots.forEach((s) => { if (s.kind === 'new') URL.revokeObjectURL(s.preview); });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Esc to close (only mid-edit, not mid-publish).
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
      kind: 'new',
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
      if (dropped?.kind === 'new') URL.revokeObjectURL(dropped.preview);
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

  function patchSlot(id: string, patch: { title?: string; subtitle?: string }) {
    setSlots((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }

  async function publish() {
    setError(null);

    if (isEdit) {
      // ---- Edit mode: caption + ending update only ----
      setStage('publishing');
      try {
        await updateAlbum(edit!.id, edit!.editToken, {
          photos: slots.map((s) => ({ title: s.title, subtitle: s.subtitle })),
          ending_title: endingTitle,
          ending_sub: endingSub,
          cta_label: endingCta || undefined,
        });
        setResult({ id: edit!.id, editToken: edit!.editToken, isUpdate: true });
        setStage('success');
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : String(e));
        setStage('error');
      }
      return;
    }

    // ---- Create mode ----
    if (slots.length < MIN_SLOTS) { setError(`至少要 ${MIN_SLOTS} 张照片`); return; }
    if (slots.length > MAX_SLOTS) { setError(`最多 ${MAX_SLOTS} 张照片`); return; }

    // Create mode only deals with new slots.
    const newSlots = slots.filter((s): s is PhotoSlot & { kind: 'new' } => s.kind === 'new');
    if (newSlots.length !== slots.length) {
      setError('Internal: existing slots present in create mode');
      return;
    }

    setStage('publishing');
    setProgress({ resized: 0, uploaded: 0 });

    try {
      const resized: ResizedImage[] = [];
      for (let i = 0; i < newSlots.length; i++) {
        const r = await resizeImage(newSlots[i].file);
        resized.push(r);
        setProgress({ resized: i + 1, uploaded: 0 });
      }

      const created = await createAlbum({
        photos: newSlots.map((s, i) => ({
          title: s.title,
          subtitle: s.subtitle,
          contentType: resized[i].contentType,
          bytes: resized[i].bytes,
        })),
        ending_title: endingTitle,
        ending_sub: endingSub,
        cta_label: endingCta || undefined,
      });

      // Sequential upload. Mobile Safari struggles with 4+ parallel HTTPS
      // PUTs of multi-megabyte bodies — connection resets mid-upload turn
      // into a generic "Load failed". One-at-a-time is slower but reliable
      // on cellular; 5 photos × ~1 MB sequential is still under 5 s.
      for (let i = 0; i < resized.length; i++) {
        await uploadPhoto(created.id, i, resized[i].blob, created.edit_token);
        setProgress({ resized: newSlots.length, uploaded: i + 1 });
      }

      await finalizeAlbum(created.id, created.edit_token);

      setResult({ id: created.id, editToken: created.edit_token, isUpdate: false });
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
            isUpdate={result.isUpdate}
            onClose={onClose}
          />
        ) : (
          <EditView
            isEdit={isEdit}
            slots={slots}
            endingTitle={endingTitle}
            endingSub={endingSub}
            endingCta={endingCta}
            stage={stage}
            progress={progress}
            error={error}
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
  isEdit: boolean;
  slots: PhotoSlot[];
  endingTitle: string;
  endingSub: string;
  endingCta: string;
  stage: Stage;
  progress: { resized: number; uploaded: number };
  error: string | null;
  onPickFile: () => void;
  onRemove: (id: string) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  onPatchSlot: (id: string, patch: { title?: string; subtitle?: string }) => void;
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
  const slotCount = p.slots.length;
  const canPublish = (p.isEdit ? true : slotCount >= MIN_SLOTS && slotCount <= MAX_SLOTS) && !publishing;

  return (
    <div className="p-6 sm:p-8 space-y-6">
      <header>
        <h2 className="text-xl sm:text-2xl font-bold tracking-tight">
          {p.isEdit ? '编辑你的撕拉相册' : '做你自己的撕拉相册'}
        </h2>
        <p className="text-sm text-neutral-500 mt-1">
          {p.isEdit
            ? '可以改文字（小标题、主文案、按钮文字）。照片本身这一版不能换 — 想换照片就重做一份。'
            : '1–5 张照片，每张一行小标题 + 一行主文案。撕到底显示你的结尾。'}
        </p>
      </header>

      {/* Photos */}
      <section className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
          照片 · {slotCount}{p.isEdit ? '' : `/${MAX_SLOTS}`}
        </h3>

        {!p.isEdit && p.slots.length === 0 ? (
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
                <img
                  src={s.kind === 'new' ? s.preview : s.url}
                  alt=""
                  className="w-20 h-28 sm:w-24 sm:h-32 object-cover rounded-lg flex-shrink-0"
                />
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
                {!p.isEdit && (
                  <div className="flex flex-col items-center gap-1 text-neutral-400">
                    <button type="button" onClick={() => p.onMove(s.id, -1)} disabled={i === 0}
                      className="w-7 h-7 rounded hover:bg-neutral-200 disabled:opacity-30 disabled:cursor-not-allowed"
                      aria-label="上移">▲</button>
                    <button type="button" onClick={() => p.onMove(s.id, 1)} disabled={i === p.slots.length - 1}
                      className="w-7 h-7 rounded hover:bg-neutral-200 disabled:opacity-30 disabled:cursor-not-allowed"
                      aria-label="下移">▼</button>
                    <button type="button" onClick={() => p.onRemove(s.id)}
                      className="w-7 h-7 rounded text-red-500 hover:bg-red-50"
                      aria-label="删除">✕</button>
                  </div>
                )}
              </li>
            ))}
            {!p.isEdit && p.slots.length < MAX_SLOTS && (
              <li>
                <button type="button" onClick={p.onPickFile}
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
        <input type="text" value={p.endingTitle} maxLength={ENDING_TITLE_MAX}
          placeholder="小标题（看到这里）"
          onChange={(e) => p.onSetEndingTitle(e.target.value)}
          className="w-full bg-neutral-50 border border-neutral-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900" />
        <input type="text" value={p.endingSub} maxLength={ENDING_SUB_MAX}
          placeholder="主文案（说明你是一个很有趣的人）"
          onChange={(e) => p.onSetEndingSub(e.target.value)}
          className="w-full bg-neutral-50 border border-neutral-200 rounded-md px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-neutral-900" />
        <input type="text" value={p.endingCta} maxLength={CTA_MAX}
          placeholder='按钮文字（默认"做同款"）'
          onChange={(e) => p.onSetEndingCta(e.target.value)}
          className="w-full bg-neutral-50 border border-neutral-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900" />
      </section>

      {publishing && (
        <div className="text-sm text-neutral-700 bg-neutral-100 rounded-md px-4 py-3 flex items-center gap-3">
          <Spinner />
          <span>
            {p.isEdit
              ? '保存中…'
              : (p.progress.resized < slotCount
                  ? `处理图片 ${p.progress.resized}/${slotCount}…`
                  : `上传 ${p.progress.uploaded}/${slotCount}…`)}
          </span>
        </div>
      )}
      {errored && p.error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-4 py-3 flex items-start gap-3">
          <span>{p.isEdit ? '保存失败' : '发布失败'}：{p.error}</span>
          <button type="button" onClick={p.onRetry} className="ml-auto font-semibold underline">重试</button>
        </div>
      )}
      {!publishing && !errored && p.error && (
        <div className="text-sm text-red-600">{p.error}</div>
      )}

      <footer className="flex justify-between items-center pt-2">
        <button type="button" onClick={p.onCancel} disabled={publishing}
          className="px-5 py-2.5 text-sm font-semibold text-neutral-600 hover:text-neutral-900 disabled:opacity-30">取消</button>
        <button type="button" onClick={p.onPublish} disabled={!canPublish}
          className="px-6 py-2.5 rounded-full bg-neutral-900 text-white text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-neutral-800">
          {publishing ? (p.isEdit ? '保存中…' : '发布中…') : (p.isEdit ? '保存修改' : '发布 →')}
        </button>
      </footer>
    </div>
  );
}

interface SuccessCardProps {
  id: string;
  editToken: string;
  isUpdate: boolean;
  onClose: () => void;
}

function SuccessCard({ id, editToken, isUpdate, onClose }: SuccessCardProps) {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const publicUrl = `${origin}${viewerPath(id)}`;
  const editUrl = `${origin}${editorPath(id, editToken)}`;

  return (
    <div className="p-8 sm:p-10 space-y-6">
      <div className="text-center space-y-2">
        <div className="text-5xl">{isUpdate ? '✓' : '✨'}</div>
        <h2 className="text-2xl font-bold tracking-tight">
          {isUpdate ? '已更新' : '发布成功'}
        </h2>
        <p className="text-sm text-neutral-500">
          {isUpdate
            ? '改动已保存。两个链接还是原来的。'
            : '下面两个链接 — 公开的可以分享，编辑链接自己保管，丢了找不回'}
        </p>
      </div>

      <CopyRow label="🌐 公开链接（分享给别人）" value={publicUrl} />
      <CopyRow label="🔒 编辑链接（自己保管）" value={editUrl} subtle />

      <div className="flex gap-3 pt-2">
        <a href={publicUrl}
          className="flex-1 px-5 py-3 rounded-full bg-neutral-900 text-white text-sm font-bold text-center hover:bg-neutral-800">
          {isUpdate ? '看一下结果 →' : '看一下我的相册 →'}
        </a>
        <button type="button" onClick={onClose}
          className="px-5 py-3 text-sm font-semibold text-neutral-600 hover:text-neutral-900">关闭</button>
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
        <button type="button" onClick={copy}
          className="px-4 rounded-md bg-neutral-900 text-white text-xs font-bold hover:bg-neutral-800">
          {copied ? '已复制' : '复制'}
        </button>
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <>
      <style>{`@keyframes builderSpin { to { transform: rotate(360deg); } }`}</style>
      <span className="inline-block w-4 h-4 rounded-full border-2 border-neutral-300"
        style={{ borderTopColor: '#0d0d0f', animation: 'builderSpin 0.7s linear infinite' }} />
    </>
  );
}

function stripArrow(label: string | undefined | null): string {
  return (label ?? '').replace(/\s*→\s*$/, '').trim();
}
