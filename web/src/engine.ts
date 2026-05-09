/**
 * Tearable-cloth engine — verlet physics + Canvas-2D textured triangles.
 *
 * Public API:
 *   const handle = await boot({ canvas, photos, onEndingReveal });
 *   handle.reset();      // re-build scene (for reset button or photo swap)
 *   handle.destroy();    // detach listeners, stop RAF (for React unmount)
 *
 * Adapted from the v1 single-file index.html (commit 7ebc01b). Same physics
 * tuning (breakRatio 1.7, gravity 1300*dpr, pristine fast-path, etc.) — only
 * differences are TypeScript types and a clean lifecycle.
 */

export interface Photo {
  /** URL or path the browser can fetch. e.g. "/photos/01-lacha.jpg" */
  src: string;
  /** Caption line 1 — small/mono. */
  title: string;
  /** Caption line 2 — large/italic. */
  subtitle: string;
}

export interface EndingText {
  title: string;
  sub: string;
  ctaLabel: string;
}

/** Stable button geometry shared by the canvas painter and the DOM hit-target. */
export const ENDING_CTA_GEOMETRY = {
  /** Used directly as a CSS value for `bottom`. Matches both DOM and canvas paint.
   *  Pushed up from the original 12vh because on mobile portrait the gap between
   *  the centered subtitle text and a bottom-anchored button was visually empty. */
  bottomCss: 'clamp(140px, 28vh, 240px)',
  /** CSS-pixel hit area — generous enough to catch finger taps. */
  hitWidthCss: 280,
  hitHeightCss: 64,
};

export interface BootOptions {
  canvas: HTMLCanvasElement;
  /** 1–5 photos. Top of the array = first thing user sees (visual top). */
  photos: Photo[];
  /** Always-painted backdrop: visible through any tear in any photo layer. */
  ending: EndingText;
  /** Fired once when the user has torn through all photos. */
  onEndingReveal?: () => void;
}

export interface EngineHandle {
  reset: () => void;
  destroy: () => void;
}

interface LoadedPhoto extends Photo {
  img: HTMLImageElement;
}

interface ClothPoint {
  x: number; y: number;       // current position
  ox: number; oy: number;     // previous position (verlet)
  tx: number; ty: number;     // texture coord (rest pose)
  pinned: boolean;
  edge: boolean;
  brokenLinks: number;
  alive: boolean;
}

interface Constraint {
  a: number;       // index into points
  b: number;
  len: number;     // rest length
  broken: boolean;
}

// Triangle clip-path overdraw, in device pixels per vertex. Adjacent
// triangles overlap by 2× this along their shared edge, fully covering
// the canvas's anti-aliased clip-edge fade. 0.6 was enough at dpr=2
// (1.2 device px = ≈0.6 CSS px overlap), but on iOS Safari at dpr=3
// the user saw visible triangle seams across every photo — iOS's AA
// filter is wider than Chromium's. 1.5 device px (≈1.0 CSS px overlap)
// covers it. Texture overlap is invisible because both triangles
// sample the same source.
const TRI_OVERDRAW = 1.5;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load ' + src));
    img.src = src;
  });
}

/**
 * Cover-mode drawImage: scale image to fill (dx,dy,dw,dh), crop overflow.
 * High-quality smoothing is set here so source pixels are sharp; the
 * downstream textured-triangle pass uses 'low' for perf.
 */
function drawCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  dx: number, dy: number, dw: number, dh: number
) {
  const ir = img.naturalWidth / img.naturalHeight;
  const cr = dw / dh;
  let sx = 0, sy = 0, sw = img.naturalWidth, sh = img.naturalHeight;
  if (ir > cr) {
    sw = img.naturalHeight * cr;
    sx = (img.naturalWidth - sw) / 2;
  } else {
    sh = img.naturalWidth / cr;
    sy = (img.naturalHeight - sh) / 2;
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
}

function drawPhotoTexture(
  photo: LoadedPhoto, W: number, H: number, dpr: number
): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d')!;

  // 1. Photo as full-bleed background, cover-mode crop
  drawCover(x, photo.img, 0, 0, W, H);

  // 2. Subtle film-grain pass for cinema texture
  const grainCount = Math.floor((W * H) / 14000);
  for (let i = 0; i < grainCount; i++) {
    x.fillStyle = `rgba(255,255,255,${Math.random() * 0.025})`;
    x.fillRect(Math.random() * W, Math.random() * H, dpr, dpr);
  }

  // 3. Bottom gradient for caption legibility — tuned light. On mobile
  // the bottom-left of a dark photo (e.g. Lacha's palm-tree silhouettes)
  // combined with a strong dark gradient + dark caption shadow read as
  // "a hole in the cloth" instead of "a moody photo edge." Halving the
  // peak alpha keeps captions readable but lets the photo show through.
  const grad = x.createLinearGradient(0, H * 0.55, 0, H);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(0.55, 'rgba(0,0,0,0.18)');
  grad.addColorStop(1, 'rgba(0,0,0,0.42)');
  x.fillStyle = grad;
  x.fillRect(0, 0, W, H);

  if (!photo.title && !photo.subtitle) return c;

  // 4. Caption — title (small/mono) above divider, subtitle (large/italic) below
  const margin = Math.max(32 * dpr, W * 0.03);
  const baseY = H - margin * 1.2;
  x.textAlign = 'left';

  // subtitle (large)
  if (photo.subtitle) {
    x.shadowColor = 'rgba(0,0,0,0.55)';
    x.shadowBlur = 10 * dpr;
    x.shadowOffsetY = 2 * dpr;
    const subSize = Math.min(W, H) * 0.052;
    x.font = `800 italic ${subSize}px 'Inter', 'Helvetica Neue', sans-serif`;
    x.fillStyle = 'rgba(255,255,255,0.98)';
    x.textBaseline = 'alphabetic';
    x.fillText(photo.subtitle, margin, baseY);
    x.shadowBlur = 0; x.shadowOffsetY = 0;

    // divider
    const subMetrics = x.measureText(photo.subtitle);
    const dividerY = baseY - subSize * 1.05;
    x.strokeStyle = 'rgba(255,255,255,0.6)';
    x.lineWidth = 1.5 * dpr;
    x.beginPath();
    x.moveTo(margin, dividerY);
    x.lineTo(margin + Math.min(subMetrics.width * 0.45, 180 * dpr), dividerY);
    x.stroke();

    // title (small/mono, above divider)
    if (photo.title) {
      const titleSize = Math.min(W, H) * 0.022;
      x.font = `600 ${titleSize}px 'Space Grotesk', 'JetBrains Mono', monospace`;
      x.fillStyle = 'rgba(255,255,255,0.92)';
      x.textBaseline = 'alphabetic';
      x.shadowColor = 'rgba(0,0,0,0.5)';
      x.shadowBlur = 6 * dpr;
      // Soft date-style separator if it looks date-like (YYYY-MM-DD).
      const niceTitle = /^\d{4}-\d{2}-\d{2}$/.test(photo.title)
        ? photo.title.replace(/-/g, ' · ')
        : photo.title;
      x.fillText(niceTitle, margin, dividerY - titleSize * 0.6);
      x.shadowBlur = 0;
    }
  }

  return c;
}

/**
 * Paint the always-on ending backdrop: a black field with the title +
 * subtitle centered. Sits behind every photo layer so torn holes reveal
 * the text immediately.
 */
/**
 * Paint the ending backdrop straight into the active canvas every frame.
 *
 * Two reasons we don't go via an offscreen texture (which we used to):
 *   1. iOS Safari has a soft canvas memory budget — every full-screen
 *      W×H×dpr canvas we keep alive cuts into it, and once over budget
 *      Safari silently downsamples canvases. The text rendered into the
 *      offscreen ending canvas then drawImage'd back to the main one
 *      came out mushy.
 *   2. Doing it inline lets shadowBlur values stay small (so iOS doesn't
 *      drop into a low-resolution text path) without needing a separate
 *      "sharp text + halo composite" pass.
 *
 * Cost is one extra fillRect + a handful of fillText calls per frame.
 * Cheap; the per-triangle cloth render dominates the frame budget anyway.
 */
function renderEndingInline(
  ctx: CanvasRenderingContext2D, ending: EndingText, W: number, H: number, dpr: number
) {
  // Solid dark base + soft radial highlight from center for depth.
  ctx.fillStyle = '#0d0d0f';
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.6);
  glow.addColorStop(0, 'rgba(255,255,255,0.07)');
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Title — small caps, mono, letter-spaced. shadowBlur kept small (was
  // 16*dpr, blurry on iOS); text reads sharp on the dark backdrop without
  // a heavy halo.
  const titleSize = Math.max(11 * dpr, Math.min(W, H) * 0.018);
  ctx.font = `600 ${titleSize}px 'Space Grotesk', 'Inter', sans-serif`;
  ctx.fillStyle = 'rgba(255,255,255,0.72)';
  ctx.shadowColor = 'rgba(0,0,0,0.85)';
  ctx.shadowBlur = 4 * dpr;
  drawSpacedText(ctx, ending.title.toUpperCase(), W / 2, H / 2 - titleSize * 4.5, titleSize * 0.32);

  // Subtitle — large italic. shadowBlur was 30*dpr — Safari was rendering
  // the text body itself at a lower resolution to compensate for the huge
  // halo composite. 6*dpr keeps a hint of legibility shadow without
  // tripping that path.
  const subSize = Math.min(W, H) * 0.072;
  ctx.font = `800 italic ${subSize}px 'Inter', 'Helvetica Neue', sans-serif`;
  ctx.fillStyle = 'rgba(255,255,255,0.98)';
  ctx.shadowColor = 'rgba(0,0,0,0.95)';
  ctx.shadowBlur = 6 * dpr;
  drawWrappedText(ctx, ending.sub, W / 2, H / 2 + subSize * 0.2, W * 0.85, subSize * 1.18);

  // CTA button — white pill. Click handling lives on the transparent DOM
  // overlay (Ending.tsx), positioned with ENDING_CTA_GEOMETRY.bottomCss.
  // Mirror the same formula here so the visual + hit target align.
  if (ending.ctaLabel) {
    const btnFontSize = 14 * dpr;
    ctx.font = `700 ${btnFontSize}px 'Inter', 'Helvetica Neue', sans-serif`;
    const labelText = `${ending.ctaLabel}  →`;
    const labelW = ctx.measureText(labelText).width;
    const padX = 28 * dpr;
    const btnW = labelW + padX * 2;
    const btnH = 56 * dpr;
    // Mirrors `bottom: clamp(140px, 28vh, 240px)` — see ENDING_CTA_GEOMETRY.
    const bottomGap = Math.min(240 * dpr, Math.max(140 * dpr, H * 0.28));
    const btnY = H - bottomGap - btnH;
    const btnX = W / 2 - btnW / 2;

    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = 22 * dpr;
    ctx.shadowOffsetY = 10 * dpr;
    ctx.fillStyle = 'rgba(255,255,255,0.98)';
    roundedRect(ctx, btnX, btnY, btnW, btnH, btnH / 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    ctx.fillStyle = '#0d0d0f';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(labelText, W / 2, btnY + btnH / 2);
  }

  ctx.shadowBlur = 0;
}

function roundedRect(
  ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function drawSpacedText(ctx: CanvasRenderingContext2D, text: string, cx: number, y: number, spacing: number) {
  let total = 0;
  const chars = Array.from(text);
  for (const ch of chars) total += ctx.measureText(ch).width;
  total += spacing * Math.max(0, chars.length - 1);
  let x = cx - total / 2;
  for (const ch of chars) {
    const w = ctx.measureText(ch).width;
    ctx.fillText(ch, x + w / 2, y);
    x += w + spacing;
  }
}

function drawWrappedText(
  ctx: CanvasRenderingContext2D, text: string,
  cx: number, y: number, maxWidth: number, lineHeight: number
) {
  const chars = Array.from(text);
  const lines: string[] = [];
  let current = '';
  for (const ch of chars) {
    const test = current + ch;
    if (ctx.measureText(test).width > maxWidth && current.length > 0) {
      lines.push(current);
      current = ch;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  const startY = y - ((lines.length - 1) * lineHeight) / 2;
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], cx, startY + i * lineHeight);
  }
}

class Cloth {
  cols: number;
  rows: number;
  texture: HTMLCanvasElement;
  points: ClothPoint[];
  constraints: Constraint[];

  // Tuning. Mobile is intentionally tougher: smaller cell sizes amplify
  // per-frame stress and a finger drag conveys more momentum than a mouse
  // cursor, so a single small pull was cascading into a full collapse.
  //
  // Note on `damping`: it's the velocity retention multiplier per frame
  // (verlet implicit velocity = (p.x - p.ox) * damping). HIGHER value =
  // LESS friction = momentum persists longer = cascades propagate further.
  // Pass 3 had this wrong (bumped 0.985→0.991 thinking "more damp =
  // tougher"). Reversed here: mobile gets a much smaller value (0.96)
  // for substantially more frame-to-frame friction, killing the
  // self-tearing cascade where torn-edge points kept yanking neighbors
  // until the whole sheet fell.
  breakRatio: number;
  damping: number;
  iterations: number;
  gravity: number;

  constructor(cols: number, rows: number, w: number, h: number, texture: HTMLCanvasElement, dpr: number, isMobile = false) {
    this.cols = cols;
    this.rows = rows;
    this.texture = texture;
    this.breakRatio = isMobile ? 2.8 : 1.7;
    this.damping    = isMobile ? 0.960 : 0.985;
    this.iterations = isMobile ? 5 : 4;
    this.gravity    = (isMobile ? 800 : 1300) * dpr;
    this.points = new Array(cols * rows);
    this.constraints = [];

    const dx = w / (cols - 1);
    const dy = h / (rows - 1);

    for (let r = 0; r < rows; r++) {
      for (let cIdx = 0; cIdx < cols; cIdx++) {
        const px = cIdx * dx;
        const py = r * dy;
        const onEdge = (cIdx === 0 || cIdx === cols - 1 || r === 0 || r === rows - 1);
        this.points[r * cols + cIdx] = {
          x: px, y: py, ox: px, oy: py, tx: px, ty: py,
          pinned: onEdge, edge: onEdge, brokenLinks: 0, alive: true,
        };
      }
    }

    for (let r = 0; r < rows; r++) {
      for (let cIdx = 0; cIdx < cols; cIdx++) {
        const i = r * cols + cIdx;
        if (cIdx < cols - 1) this.constraints.push({ a: i, b: i + 1, len: dx, broken: false });
        if (r < rows - 1)    this.constraints.push({ a: i, b: i + cols, len: dy, broken: false });
      }
    }
  }

  update(dt: number) {
    const dt2 = dt * dt;
    const g = this.gravity;
    const damp = this.damping;
    const points = this.points;

    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      if (p.pinned) { p.ox = p.x; p.oy = p.y; continue; }
      const vx = (p.x - p.ox) * damp;
      const vy = (p.y - p.oy) * damp;
      p.ox = p.x; p.oy = p.y;
      p.x += vx;
      p.y += vy + g * dt2;
    }

    const cs = this.constraints;
    for (let it = 0; it < this.iterations; it++) {
      for (let k = 0; k < cs.length; k++) {
        const c = cs[k];
        if (c.broken) continue;
        const a = points[c.a];
        const b = points[c.b];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 1e-6;
        if (d > c.len * this.breakRatio) {
          c.broken = true;
          a.brokenLinks++;
          b.brokenLinks++;
          continue;
        }
        const diff = (d - c.len) / d * 0.5;
        const ox = dx * diff;
        const oy = dy * diff;
        if (!a.pinned) { a.x += ox; a.y += oy; }
        if (!b.pinned) { b.x -= ox; b.y -= oy; }
      }
    }

    // Border points whose inward neighbor tore away become free → torn chunks fall.
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      if (p.pinned && p.edge && p.brokenLinks >= 2) p.pinned = false;
    }
  }

  pickInRadius(x: number, y: number, radius: number): Array<{ p: ClothPoint; w: number }> {
    const out: Array<{ p: ClothPoint; w: number }> = [];
    const r2 = radius * radius;
    for (let i = 0; i < this.points.length; i++) {
      const p = this.points[i];
      if (p.edge || !p.alive) continue;
      const dx = p.x - x;
      const dy = p.y - y;
      const d2 = dx * dx + dy * dy;
      if (d2 < r2) {
        const t = Math.sqrt(d2) / radius;
        const w = Math.max(0.55, 1 - t * 0.7);
        out.push({ p, w });
      }
    }
    return out;
  }

  tornRatio(): number {
    let broken = 0;
    for (let i = 0; i < this.constraints.length; i++) if (this.constraints[i].broken) broken++;
    return broken / this.constraints.length;
  }

  isPristine(): boolean {
    // Any broken constraint? Definitely not pristine.
    const cs = this.constraints;
    for (let i = 0; i < cs.length; i++) if (cs[i].broken) return false;
    // Any displaced point? An exhaustive scan over <1000 points is far cheaper
    // (~0.05ms) than the textured-triangle render path it gates (~5–15ms), and
    // the previous sampling approach (every 9th point) introduced a one-pull
    // lag where the user's first drag was invisible until a sampled point
    // happened to move.
    const pts = this.points;
    const eps = 0.5;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (Math.abs(p.x - p.tx) > eps || Math.abs(p.y - p.ty) > eps) return false;
    }
    return true;
  }

  /**
   * Fraction of points that have left the viewport. Used to detach physics +
   * render for fully-fallen debris layers so the active top stays responsive.
   */
  offRatio(W: number, H: number): number {
    const xMin = -W * 0.05, xMax = W * 1.05;
    const yMin = -H * 0.05, yMax = H * 1.08;
    const pts = this.points;
    let off = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (p.x < xMin || p.x > xMax || p.y < yMin || p.y > yMax) off++;
    }
    return off / pts.length;
  }

  render(ctx: CanvasRenderingContext2D) {
    const { cols, rows, points: pts, texture: tex } = this;
    const maxStretch = 3.0;
    for (let r = 0; r < rows - 1; r++) {
      for (let cIdx = 0; cIdx < cols - 1; cIdx++) {
        const i00 = r * cols + cIdx;
        const p00 = pts[i00], p01 = pts[i00 + 1], p10 = pts[i00 + cols], p11 = pts[i00 + cols + 1];
        if (triangleOk(p00, p01, p10, maxStretch)) {
          drawTexturedTriangle(ctx, tex,
            p00.tx, p00.ty, p01.tx, p01.ty, p10.tx, p10.ty,
            p00.x, p00.y, p01.x, p01.y, p10.x, p10.y);
        }
        if (triangleOk(p01, p11, p10, maxStretch)) {
          drawTexturedTriangle(ctx, tex,
            p01.tx, p01.ty, p11.tx, p11.ty, p10.tx, p10.ty,
            p01.x, p01.y, p11.x, p11.y, p10.x, p10.y);
        }
      }
    }
  }

  renderShadow(ctx: CanvasRenderingContext2D, dpr: number) {
    const { cols, rows, points: pts } = this;
    const maxStretch = 3.0;
    const off = 8 * dpr;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.beginPath();
    for (let r = 0; r < rows - 1; r++) {
      for (let cIdx = 0; cIdx < cols - 1; cIdx++) {
        const i00 = r * cols + cIdx;
        const p00 = pts[i00], p01 = pts[i00 + 1], p10 = pts[i00 + cols], p11 = pts[i00 + cols + 1];
        if (triangleOk(p00, p01, p10, maxStretch)) {
          ctx.moveTo(p00.x + off, p00.y + off);
          ctx.lineTo(p01.x + off, p01.y + off);
          ctx.lineTo(p10.x + off, p10.y + off);
          ctx.closePath();
        }
        if (triangleOk(p01, p11, p10, maxStretch)) {
          ctx.moveTo(p01.x + off, p01.y + off);
          ctx.lineTo(p11.x + off, p11.y + off);
          ctx.lineTo(p10.x + off, p10.y + off);
          ctx.closePath();
        }
      }
    }
    ctx.filter = `blur(${4 * dpr}px)`;
    ctx.fill();
    ctx.restore();
  }
}

function triangleOk(a: ClothPoint, b: ClothPoint, c: ClothPoint, maxStretch: number): boolean {
  const restAB = Math.hypot(b.tx - a.tx, b.ty - a.ty);
  const restBC = Math.hypot(c.tx - b.tx, c.ty - b.ty);
  const restCA = Math.hypot(a.tx - c.tx, a.ty - c.ty);
  const ab = Math.hypot(b.x - a.x, b.y - a.y);
  if (ab > restAB * maxStretch) return false;
  const bc = Math.hypot(c.x - b.x, c.y - b.y);
  if (bc > restBC * maxStretch) return false;
  const ca = Math.hypot(a.x - c.x, a.y - c.y);
  if (ca > restCA * maxStretch) return false;
  return true;
}

/**
 * Draw an affine-warped triangle of `img` clipped to a destination triangle.
 * Each clip path is enlarged by TRI_OVERDRAW px around its centroid so adjacent
 * triangles overlap by ~0.5 device pixels — eliminates faint seams.
 */
function drawTexturedTriangle(
  ctx: CanvasRenderingContext2D, img: CanvasImageSource,
  sx0: number, sy0: number, sx1: number, sy1: number, sx2: number, sy2: number,
  dx0: number, dy0: number, dx1: number, dy1: number, dx2: number, dy2: number
) {
  ctx.save();
  const ccx = (dx0 + dx1 + dx2) / 3;
  const ccy = (dy0 + dy1 + dy2) / 3;
  const o = TRI_OVERDRAW;
  let ex0 = dx0, ey0 = dy0, ex1 = dx1, ey1 = dy1, ex2 = dx2, ey2 = dy2;
  const v0x = dx0 - ccx, v0y = dy0 - ccy;
  const v1x = dx1 - ccx, v1y = dy1 - ccy;
  const v2x = dx2 - ccx, v2y = dy2 - ccy;
  const l0 = Math.hypot(v0x, v0y); if (l0 > 0.01) { ex0 = ccx + v0x * (1 + o / l0); ey0 = ccy + v0y * (1 + o / l0); }
  const l1 = Math.hypot(v1x, v1y); if (l1 > 0.01) { ex1 = ccx + v1x * (1 + o / l1); ey1 = ccy + v1y * (1 + o / l1); }
  const l2 = Math.hypot(v2x, v2y); if (l2 > 0.01) { ex2 = ccx + v2x * (1 + o / l2); ey2 = ccy + v2y * (1 + o / l2); }

  ctx.beginPath();
  ctx.moveTo(ex0, ey0); ctx.lineTo(ex1, ey1); ctx.lineTo(ex2, ey2);
  ctx.closePath();
  ctx.clip();

  const denom = sx0 * (sy2 - sy1) + sx1 * (sy0 - sy2) + sx2 * (sy1 - sy0);
  if (denom === 0) { ctx.restore(); return; }
  const inv = 1 / denom;
  const m11 = (dx0 * (sy2 - sy1) + dx1 * (sy0 - sy2) + dx2 * (sy1 - sy0)) * inv;
  const m12 = (dy0 * (sy2 - sy1) + dy1 * (sy0 - sy2) + dy2 * (sy1 - sy0)) * inv;
  const m21 = (dx0 * (sx1 - sx2) + dx1 * (sx2 - sx0) + dx2 * (sx0 - sx1)) * inv;
  const m22 = (dy0 * (sx1 - sx2) + dy1 * (sx2 - sx0) + dy2 * (sx0 - sx1)) * inv;
  const tdx = (dx0 * (sx2 * sy1 - sx1 * sy2) + dx1 * (sx0 * sy2 - sx2 * sy0) + dx2 * (sx1 * sy0 - sx0 * sy1)) * inv;
  const tdy = (dy0 * (sx2 * sy1 - sx1 * sy2) + dy1 * (sx0 * sy2 - sx2 * sy0) + dy2 * (sx1 * sy0 - sx0 * sy1)) * inv;
  ctx.transform(m11, m12, m21, m22, tdx, tdy);
  ctx.drawImage(img, 0, 0);
  ctx.restore();
}

// ============================================================
//  boot — entrypoint
// ============================================================

export async function boot(opts: BootOptions): Promise<EngineHandle> {
  const { canvas, photos, ending, onEndingReveal } = opts;
  if (photos.length < 1 || photos.length > 5) {
    throw new Error('boot: photos must have 1–5 entries (got ' + photos.length + ')');
  }

  const ctx = canvas.getContext('2d', { alpha: false })!;
  const isMobile = window.matchMedia('(max-width: 640px)').matches
                || ('ontouchstart' in window && window.innerWidth < 900);
  // Round dpr up to an integer (Math.ceil), then cap at 3. iOS reports
  // integer dpr (2 or 3) but a chunk of Android phones report fractional
  // values like 2.625 / 2.75 — when the canvas backing buffer is at a
  // fractional dpr, every pixel of the output ends up sampling between
  // source pixels and the whole scene reads as soft. Rounding up
  // guarantees pixel-grid alignment.
  const dpr = Math.min(Math.ceil(window.devicePixelRatio || 1), 3);
  // Mobile grid is intentionally smaller — at dpr=3 the textured-triangle pass
  // is the bottleneck. 18×12 keeps tear silhouettes detailed enough on a 393-px
  // viewport while dropping ~30% of per-frame drawImage work vs 20×14.
  // Mobile grid was 18×12. The bigger per-triangle area meant each warped
  // drawImage covered a larger chunk of the source texture, and bilinear/
  // bicubic interpolation across that big a stretch reads as "mushy" — the
  // user's "photos and bottom captions look blurry on mobile" complaint.
  // 24×16 keeps each triangle small enough that the texture sampling stays
  // sharp; with the debris-perf cleanup it still hits 60fps on iPhone.
  const TOP_COLS = isMobile ? 24 : 36;
  const TOP_ROWS = isMobile ? 16 : 22;
  // Brush radius scales with viewport. 110 CSS px = 28% of an iPhone 390px
  // viewport but only 7.6% of a 1440px desktop. Same value meant a finger
  // on mobile hauled away ~4× the proportion of cloth a desktop cursor
  // would, which the user reported as "too easy on mobile". 70px on mobile
  // restores the desktop's relative pinch.
  const GRAB_RADIUS = isMobile ? 70 : 110;

  // Load all source images first (so we can build textures synchronously after).
  const loaded: LoadedPhoto[] = await Promise.all(
    photos.map(async (p) => ({ ...p, img: await loadImage(p.src) }))
  );

  let W = 0, H = 0;
  let layers: Cloth[] = [];
  let currentTopIdx = 0;
  let endingRevealed = false;
  // Ending backdrop is rendered inline every frame (see renderEndingInline).
  // No offscreen ending texture; iOS canvas-memory pressure was making the
  // round-trip texture come back blurry.

  function resize() {
    const cw = window.innerWidth;
    const ch = window.innerHeight;
    W = canvas.width = Math.floor(cw * dpr);
    H = canvas.height = Math.floor(ch * dpr);
    canvas.style.width = cw + 'px';
    canvas.style.height = ch + 'px';
  }

  function buildScene() {
    layers = [];
    // Texture-z order: layers[0] is the bottom-most (revealed last).
    // Caller passes photos with photos[0] = top (first visible). Reverse for stack.
    const stackBottomToTop = [...loaded].reverse();
    for (let i = 0; i < stackBottomToTop.length; i++) {
      const tex = drawPhotoTexture(stackBottomToTop[i], W, H, dpr);
      layers.push(new Cloth(TOP_COLS, TOP_ROWS, W, H, tex, dpr, isMobile));
    }
    currentTopIdx = layers.length - 1;
    endingRevealed = false;
  }

  // -- input (mouse + touch, soft-brush grab) ---------------------------
  type Grab = { active: boolean; affected: { p: ClothPoint; w: number }[]; lastX: number; lastY: number };
  const grab: Grab = { active: false, affected: [], lastX: 0, lastY: 0 };

  function eventPos(e: MouseEvent | TouchEvent) {
    const t = (e as TouchEvent).touches?.[0] ?? (e as MouseEvent);
    return { x: t.clientX * dpr, y: t.clientY * dpr };
  }

  function onDown(e: MouseEvent | TouchEvent) {
    e.preventDefault();
    if (currentTopIdx < 0) return;
    const top = layers[currentTopIdx];
    if (!top) return;
    const pos = eventPos(e);
    const picked = top.pickInRadius(pos.x, pos.y, GRAB_RADIUS * dpr);
    if (picked.length === 0) return;
    for (const { p } of picked) p.pinned = true;
    grab.affected = picked;
    grab.active = true;
    grab.lastX = pos.x;
    grab.lastY = pos.y;
    document.body.classList.add('grabbing');
  }

  function onMove(e: MouseEvent | TouchEvent) {
    if (!grab.active) return;
    if (e.cancelable) e.preventDefault();
    const pos = eventPos(e);
    const dx = pos.x - grab.lastX;
    const dy = pos.y - grab.lastY;
    grab.lastX = pos.x;
    grab.lastY = pos.y;
    for (const { p, w } of grab.affected) {
      p.x += dx * w;
      p.y += dy * w;
    }
  }

  function onUp() {
    if (!grab.active) return;
    for (const { p } of grab.affected) p.pinned = false;
    grab.affected = [];
    grab.active = false;
    document.body.classList.remove('grabbing');
  }

  // -- animation loop ---------------------------------------------------
  let raf = 0;
  let lastT = performance.now();
  let stopped = false;

  function frame(now: number) {
    if (stopped) return;
    let dt = (now - lastT) / 1000;
    if (dt > 1 / 30) dt = 1 / 30;
    lastT = now;

    // Physics: active top + non-fully-gone debris. Once a debris layer's
    // points are mostly off-screen there's nothing visible to update — keep
    // those frames cheap so the active top stays responsive to input.
    for (let i = 0; i < layers.length; i++) {
      if (i < currentTopIdx) continue;
      if (i !== currentTopIdx && layers[i].offRatio(W, H) > 0.7) continue;
      layers[i].update(dt);
    }

    if (currentTopIdx >= 0 && !endingRevealed) {
      const top = layers[currentTopIdx];
      const offRatio = top.offRatio(W, H);

      // Threshold scales with grid density. Mobile uses 18×12 (~400
      // constraints), desktop 36×22 (~1500). The same percentage on the
      // sparse mobile grid is way more visually destructive — at 22% on
      // mobile the cloth looks barely scratched but the layer demotes,
      // which the user reported as "first layer barely torn and we already
      // moved on." Bump mobile to 40%/45% so the effort matches what the
      // eye sees.
      const tornGate = isMobile ? 0.40 : 0.22;
      const offGate  = isMobile ? 0.45 : 0.28;
      const torn = top.tornRatio() > tornGate || offRatio > offGate;
      if (torn) {
        if (currentTopIdx > 0) currentTopIdx--;
        else {
          endingRevealed = true;
          onEndingReveal?.();
        }
      }
    }

    render();
    raf = requestAnimationFrame(frame);
  }

  function render() {
    // 'high' (Lanczos-class on most browsers) keeps the warped triangles
    // crisp even when they're stretched, vs 'medium's softer bicubic. The
    // user pushed back against any softness — modern phones have GPU-
    // accelerated drawImage and the Phase-3 debris cleanup gives us
    // plenty of frame budget on the active top layer.
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // Always-on ending backdrop, painted directly — also fills the canvas
    // with the dark base, so no separate fillRect is needed before this.
    renderEndingInline(ctx, ending, W, H, dpr);

    for (let i = 0; i < currentTopIdx; i++) {
      ctx.drawImage(layers[i].texture, 0, 0);
    }

    // Drop shadow only on the active top layer. Shadow rendering uses
    // ctx.filter='blur(...)', the single most expensive Canvas-2D op in
    // this scene; doing it for debris layers (i > currentTopIdx) is what
    // makes the next-layer tear feel laggy while the previous one is still
    // falling. Debris doesn't really need a contact shadow anyway.
    const topLayer = layers[currentTopIdx];
    if (topLayer && !topLayer.isPristine()) topLayer.renderShadow(ctx, dpr);

    // Top + debris. Skip drawing debris that's mostly off-screen — what's
    // still visible stays; the rest is invisible work that only steals frames.
    for (let i = currentTopIdx; i < layers.length; i++) {
      const cl = layers[i];
      if (i !== currentTopIdx && cl.offRatio(W, H) > 0.85) continue;
      if (cl.isPristine()) ctx.drawImage(cl.texture, 0, 0);
      else                 cl.render(ctx);
    }

    const grad = ctx.createRadialGradient(
      W * 0.5, H * 0.5, Math.min(W, H) * 0.45,
      W * 0.5, H * 0.5, Math.max(W, H) * 0.78
    );
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.32)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
  }

  // -- wire listeners ---------------------------------------------------
  let resizeTimer: ReturnType<typeof setTimeout> | null = null;
  function onResize() {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { resize(); buildScene(); }, 150);
  }
  function onContextMenu(e: Event) { e.preventDefault(); }

  canvas.addEventListener('mousedown', onDown);
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
  canvas.addEventListener('touchstart', onDown, { passive: false });
  window.addEventListener('touchmove', onMove, { passive: false });
  window.addEventListener('touchend', onUp);
  window.addEventListener('touchcancel', onUp);
  window.addEventListener('resize', onResize);
  window.addEventListener('contextmenu', onContextMenu);

  resize();
  buildScene();
  // Diagnostic log so a user / agent can paste it back when reporting issues.
  // eslint-disable-next-line no-console
  console.log('[tearable-memories] booted', {
    dpr,
    isMobile,
    canvasSize: { W, H, css: { w: window.innerWidth, h: window.innerHeight } },
    grid: { cols: TOP_COLS, rows: TOP_ROWS },
    layers: layers.length,
    photoSizes: loaded.map(p => ({ src: p.src, w: p.img.naturalWidth, h: p.img.naturalHeight })),
  });
  raf = requestAnimationFrame(frame);

  return {
    reset: () => buildScene(),
    destroy: () => {
      stopped = true;
      cancelAnimationFrame(raf);
      canvas.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      canvas.removeEventListener('touchstart', onDown);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
      window.removeEventListener('touchcancel', onUp);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('contextmenu', onContextMenu);
      document.body.classList.remove('grabbing');
    },
  };
}
