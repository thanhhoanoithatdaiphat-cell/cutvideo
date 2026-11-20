import { zip } from "fflate";

export const MAX_FRAMES = 180;

export type Mode = "interval" | "count" | "scene" | "playhead";
export type ImageFormat = "image/jpeg" | "image/png" | "image/webp";

export type ExtractSettings = {
  mode: Mode;
  intervalSec: number;
  count: number;
  sensitivity: number;
  format: ImageFormat;
  quality: number;
  maxEdge: number;
  prefix: string;
};

export type Shot = {
  id: string;
  time: number;
  blob: Blob;
  url: string;
  width: number;
  height: number;
  mime: string;
};

export type Progress = {
  done: number;
  total: number;
  label: string;
};

export const DEFAULT_SETTINGS: ExtractSettings = {
  mode: "count",
  intervalSec: 1,
  count: 12,
  sensitivity: 6,
  format: "image/jpeg",
  quality: 0.86,
  maxEdge: 1280,
  prefix: "khung",
};

const MODES: Mode[] = ["interval", "count", "scene", "playhead"];
const FORMATS: ImageFormat[] = ["image/jpeg", "image/png", "image/webp"];

export function sanitizeSettings(raw: unknown): ExtractSettings {
  const d = DEFAULT_SETTINGS;
  if (!raw || typeof raw !== "object") return d;
  const o = raw as Partial<ExtractSettings>;
  return {
    mode: MODES.includes(o.mode as Mode) ? (o.mode as Mode) : d.mode,
    intervalSec: clampNum(o.intervalSec, 0.1, 60, d.intervalSec),
    count: Math.round(clampNum(o.count, 1, MAX_FRAMES, d.count)),
    sensitivity: Math.round(clampNum(o.sensitivity, 1, 10, d.sensitivity)),
    format: FORMATS.includes(o.format as ImageFormat) ? (o.format as ImageFormat) : d.format,
    quality: clampNum(o.quality, 0.5, 1, d.quality),
    maxEdge: [0, 720, 1280, 1920].includes(o.maxEdge as number) ? (o.maxEdge as number) : d.maxEdge,
    prefix: typeof o.prefix === "string" ? o.prefix.slice(0, 40) : d.prefix,
  };
}

function clampNum(value: unknown, min: number, max: number, fallback: number) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function safePrefix(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/[^\p{L}\p{N}_-]+/gu, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return cleaned || "khung";
}

export function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "00:00.00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const cs = Math.floor((seconds % 1) * 100);
  return `${pad(m)}:${pad(s)}.${pad(cs)}`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function pad(n: number) {
  return n.toString().padStart(2, "0");
}

export function fileStamp(seconds: number): string {
  const ms = Math.max(0, seconds);
  const h = Math.floor(ms / 3600);
  const m = Math.floor((ms % 3600) / 60);
  const s = Math.floor(ms % 60);
  const cs = Math.floor((ms % 1) * 100);
  const body = `${pad(m)}-${pad(s)}-${pad(cs)}`;
  return h > 0 ? `${pad(h)}-${body}` : body;
}

export function extensionFor(mime: string): string {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "jpg";
}

export function shotFilename(index: number, shot: Shot, prefix: string): string {
  return `${safePrefix(prefix)}-${pad3(index + 1)}-${fileStamp(shot.time)}.${extensionFor(shot.mime)}`;
}

function pad3(n: number) {
  return n.toString().padStart(3, "0");
}

export function sensitivityLabel(n: number): string {
  if (n <= 3) return "Chỉ giữ khi cảnh khác hẳn";
  if (n <= 7) return "Vừa — bỏ qua rung nhẹ";
  return "Nhạy — bắt cả thay đổi nhỏ";
}

export function describePlan(duration: number, settings: ExtractSettings): string {
  if (!Number.isFinite(duration) || duration <= 0) return "Đưa video vào rồi chọn cách tách.";
  if (settings.mode === "playhead") return "Sẽ chụp đúng khung đang dừng trên màn hình.";
  if (settings.mode === "scene") {
    const step = sampleStep(duration);
    return `Dò cảnh mỗi ${step < 1 ? `${Math.round(step * 1000)} ms` : `${step.toFixed(1)} giây`}. Video dài thì bước dò thưa hơn để máy không đơ.`;
  }
  const times = buildTimes(duration, settings);
  if (settings.mode === "interval" && times.length >= MAX_FRAMES) {
    return `Sẽ lấy ${times.length} ảnh — đã chạm trần ${MAX_FRAMES} để máy không nghẹn.`;
  }
  return `Sẽ lấy ${times.length} ảnh.`;
}

export function buildTimes(duration: number, settings: ExtractSettings): number[] {
  const end = Math.max(0, duration - 0.04);
  if (settings.mode === "count") {
    const n = Math.round(clampNum(settings.count, 1, MAX_FRAMES, 1));
    if (n === 1) return [0];
    return Array.from({ length: n }, (_, i) => roundTime(Math.min(end, (end * i) / (n - 1))));
  }
  const step = clampNum(settings.intervalSec, 0.1, 60, 1);
  const times: number[] = [];
  for (let t = 0; t <= end + 0.0001 && times.length < MAX_FRAMES; t += step) {
    times.push(roundTime(Math.min(t, end)));
  }
  return times.length > 0 ? times : [0];
}

function sampleStep(duration: number) {
  const samples = Math.min(240, Math.max(12, Math.round(duration * 4)));
  return Math.max(0.2, duration / samples);
}

function sampleTimes(duration: number): number[] {
  const end = Math.max(0, duration - 0.04);
  const step = sampleStep(duration);
  const times: number[] = [];
  for (let t = 0; t <= end + 0.0001; t += step) times.push(roundTime(Math.min(t, end)));
  if (times.length === 0) times.push(0);
  return times;
}

function roundTime(t: number) {
  return Math.round(t * 1000) / 1000;
}

export function isVideoFile(file: File): boolean {
  if (file.type.startsWith("video/")) return true;
  return /\.(mp4|webm|mov|m4v|ogv|mkv|avi)$/i.test(file.name);
}

// MediaRecorder WebM often reports Infinity until the playhead reaches the end.
export async function ensureDuration(video: HTMLVideoElement, hint?: number): Promise<number> {
  if (usableDuration(video.duration)) return video.duration;
  await seek(video, 1e9);
  if (usableDuration(video.duration)) return video.duration;
  if (hint && hint > 0) return hint;
  throw new Error("Không đọc được độ dài video. Hãy thử file MP4.");
}

function usableDuration(value: number) {
  return Number.isFinite(value) && value > 0 && value !== Number.POSITIVE_INFINITY;
}

export async function extractFrames(
  video: HTMLVideoElement,
  settings: ExtractSettings,
  hint: number | undefined,
  onProgress: (progress: Progress) => void,
  isCancelled: () => boolean,
): Promise<Shot[]> {
  if (!video.videoWidth || !video.videoHeight) {
    throw new Error("Video chưa có hình. Đợi một nhịp rồi thử lại.");
  }
  const playhead = video.currentTime;
  video.pause();
  const duration = await ensureDuration(video, hint);
  const shots: Shot[] = [];
  try {
    if (settings.mode === "playhead") {
      onProgress({ done: 0, total: 1, label: "Đang chụp khung đang xem" });
      await seek(video, clampTime(playhead, duration));
      await nextPresentedFrame(video);
      shots.push(await captureCurrent(video, clampTime(playhead, duration), settings));
      onProgress({ done: 1, total: 1, label: "Đã chụp" });
      return shots;
    }

    if (settings.mode === "scene") {
      const times = sampleTimes(duration);
      const threshold = 54 - settings.sensitivity * 4.4;
      const sample = document.createElement("canvas");
      let prev: Uint8ClampedArray | null = null;
      for (let i = 0; i < times.length; i++) {
        if (isCancelled() || shots.length >= MAX_FRAMES) break;
        onProgress({ done: i, total: times.length, label: "Đang dò cảnh" });
        await seek(video, times[i]);
        await nextPresentedFrame(video);
        const luma = readLuma(video, sample);
        const diff = prev ? lumaDiff(prev, luma) : Number.POSITIVE_INFINITY;
        prev = luma;
        if (diff >= threshold) shots.push(await captureCurrent(video, times[i], settings));
        await yieldToUi();
      }
      onProgress({ done: times.length, total: times.length, label: "Xong" });
      if (shots.length === 0) shots.push(await captureCurrent(video, 0, settings));
      return shots;
    }

    const times = buildTimes(duration, settings);
    for (let i = 0; i < times.length; i++) {
      if (isCancelled()) break;
      onProgress({ done: i, total: times.length, label: "Đang chụp khung hình" });
      await seek(video, times[i]);
      await nextPresentedFrame(video);
      shots.push(await captureCurrent(video, times[i], settings));
      await yieldToUi();
    }
    onProgress({
      done: shots.length,
      total: times.length,
      label: isCancelled() ? "Đã dừng" : "Xong",
    });
    return shots;
  } finally {
    await seek(video, clampTime(playhead, duration));
  }
}

function clampTime(time: number, duration: number) {
  if (!usableDuration(duration)) return Math.max(0, time || 0);
  return Math.min(Math.max(0, time || 0), Math.max(0, duration - 0.04));
}

function seek(video: HTMLVideoElement, time: number): Promise<void> {
  const target = usableDuration(video.duration)
    ? Math.min(Math.max(time, 0), Math.max(video.duration - 0.001, 0))
    : Math.max(time, 0);
  if (Math.abs(video.currentTime - target) < 0.001) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      video.removeEventListener("seeked", done);
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(done, 2000);
    video.addEventListener("seeked", done);
    try {
      video.currentTime = target;
    } catch {
      done();
    }
  });
}

function nextPresentedFrame(video: HTMLVideoElement): Promise<void> {
  const withCallback = video as HTMLVideoElement & {
    requestVideoFrameCallback?: (cb: () => void) => number;
  };
  if (withCallback.requestVideoFrameCallback) {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, 800);
      withCallback.requestVideoFrameCallback?.(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

async function captureCurrent(video: HTMLVideoElement, time: number, settings: ExtractSettings) {
  const canvas = document.createElement("canvas");
  const { width, height } = drawFitted(video, settings.maxEdge, canvas);
  const mime = resolveMime(settings.format);
  const blob = await canvasToBlob(canvas, mime, settings.quality);
  return {
    id: crypto.randomUUID(),
    time,
    blob,
    url: URL.createObjectURL(blob),
    width,
    height,
    mime: blob.type || mime,
  } satisfies Shot;
}

function drawFitted(video: HTMLVideoElement, maxEdge: number, canvas: HTMLCanvasElement) {
  const sourceW = video.videoWidth;
  const sourceH = video.videoHeight;
  if (!sourceW || !sourceH) throw new Error("Khung hình trống");
  let width = sourceW;
  let height = sourceH;
  if (maxEdge > 0 && Math.max(width, height) > maxEdge) {
    const scale = maxEdge / Math.max(width, height);
    width = Math.round(sourceW * scale);
    height = Math.round(sourceH * scale);
  }
  width = Math.max(2, width - (width % 2));
  height = Math.max(2, height - (height % 2));
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("Không tạo được vùng vẽ");
  ctx.drawImage(video, 0, 0, width, height);
  return { width, height };
}

const SAMPLE_W = 64;
const SAMPLE_H = 36;

function readLuma(video: HTMLVideoElement, canvas: HTMLCanvasElement) {
  canvas.width = SAMPLE_W;
  canvas.height = SAMPLE_H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Không đọc được khung hình");
  ctx.drawImage(video, 0, 0, SAMPLE_W, SAMPLE_H);
  return ctx.getImageData(0, 0, SAMPLE_W, SAMPLE_H).data;
}

function lumaDiff(a: Uint8ClampedArray, b: Uint8ClampedArray) {
  let sum = 0;
  const pixels = a.length / 4;
  for (let i = 0; i < a.length; i += 4) {
    const la = a[i] * 0.299 + a[i + 1] * 0.587 + a[i + 2] * 0.114;
    const lb = b[i] * 0.299 + b[i + 1] * 0.587 + b[i + 2] * 0.114;
    sum += Math.abs(la - lb);
  }
  return sum / pixels;
}

let webpOk: boolean | null = null;

function supportsWebp() {
  if (webpOk !== null) return webpOk;
  const canvas = document.createElement("canvas");
  canvas.width = 2;
  canvas.height = 2;
  webpOk = canvas.toDataURL("image/webp").startsWith("data:image/webp");
  return webpOk;
}

function resolveMime(format: ImageFormat): ImageFormat {
  if (format === "image/webp" && !supportsWebp()) return "image/jpeg";
  return format;
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob && blob.size > 0) resolve(blob);
        else reject(new Error("Không xuất được ảnh"));
      },
      type,
      quality,
    );
  });
}

function yieldToUi() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export function downloadUrl(url: string, filename: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export async function zipShots(shots: Shot[], names: string[]): Promise<Blob> {
  const files: Record<string, Uint8Array> = {};
  for (let i = 0; i < shots.length; i++) {
    files[names[i]] = new Uint8Array(await shots[i].blob.arrayBuffer());
  }
  const zipped = await new Promise<Uint8Array>((resolve, reject) => {
    zip(files, { level: 0 }, (err, data) => {
      if (err || !data) reject(err ?? new Error("Không đóng gói được"));
      else resolve(data);
    });
  });
  return new Blob([new Uint8Array(zipped)], { type: "application/zip" });
}

export type SaveWritable = {
  write(data: Blob): Promise<void>;
  close(): Promise<void>;
};

export type SaveDir = {
  getFileHandle(
    name: string,
    options: { create: boolean },
  ): Promise<{ createWritable(): Promise<SaveWritable> }>;
};

export function directoryPicker(): ((options: { mode: "readwrite" }) => Promise<SaveDir>) | null {
  const host = window as Window & {
    showDirectoryPicker?: (options: { mode: "readwrite" }) => Promise<SaveDir>;
  };
  return host.showDirectoryPicker ?? null;
}

export async function saveToDirectory(
  shots: Shot[],
  names: string[],
  dir: SaveDir,
  onProgress: (done: number, total: number) => void,
) {
  for (let i = 0; i < shots.length; i++) {
    const handle = await dir.getFileHandle(names[i], { create: true });
    const writable = await handle.createWritable();
    await writable.write(shots[i].blob);
    await writable.close();
    onProgress(i + 1, shots.length);
  }
}
