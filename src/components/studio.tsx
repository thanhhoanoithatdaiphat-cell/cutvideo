import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Aperture,
  Check,
  Clapperboard,
  Download,
  FolderDown,
  ImageDown,
  Pause,
  Play,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/lib/cn";
import {
  DEFAULT_SETTINGS,
  MAX_FRAMES,
  describePlan,
  directoryPicker,
  downloadUrl,
  extractFrames,
  formatBytes,
  formatClock,
  isVideoFile,
  sanitizeSettings,
  saveToDirectory,
  sensitivityLabel,
  shotFilename,
  zipShots,
  type ExtractSettings,
  type ImageFormat,
  type Mode,
  type Progress,
  type Shot,
} from "@/lib/frames";
import { recordSampleClip } from "@/lib/sample-clip";

const STORAGE_KEY = "khung-settings-v1";

const MODES: { value: Mode; label: string; hint: string }[] = [
  { value: "count", label: "Chia đều", hint: "Rải đều số ảnh trên suốt video." },
  { value: "interval", label: "Mỗi khoảng", hint: "Cứ sau từng khoảng thời gian, lấy một ảnh." },
  { value: "scene", label: "Đổi cảnh", hint: "Bỏ đoạn giống nhau, chỉ giữ khi hình đổi." },
  { value: "playhead", label: "Đang xem", hint: "Chụp đúng khung đang dừng." },
];

const EDGES: { value: number; label: string }[] = [
  { value: 0, label: "Gốc" },
  { value: 1920, label: "1920" },
  { value: 1280, label: "1280" },
  { value: 720, label: "720" },
];

const FORMATS: { value: ImageFormat; label: string }[] = [
  { value: "image/jpeg", label: "JPG" },
  { value: "image/png", label: "PNG" },
  { value: "image/webp", label: "WebP" },
];

type Notice = { tone: "info" | "error"; text: string } | null;

export function Studio() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const shotsRef = useRef<Shot[]>([]);
  const videoUrlRef = useRef<string | null>(null);
  const hintRef = useRef<number | undefined>(undefined);
  const cancelRef = useRef(false);
  const busyRef = useRef(false);
  const settingsRef = useRef<ExtractSettings>(DEFAULT_SETTINGS);

  const [settings, setSettings] = useState<ExtractSettings>(DEFAULT_SETTINGS);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileSize, setFileSize] = useState(0);
  const [meta, setMeta] = useState({ width: 0, height: 0, duration: 0 });
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [shots, setShots] = useState<Shot[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [job, setJob] = useState<"extract" | "other" | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [lightbox, setLightbox] = useState<number | null>(null);

  settingsRef.current = settings;
  shotsRef.current = shots;

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setSettings(sanitizeSettings(JSON.parse(raw)));
    } catch {
      /* keep defaults */
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }, [settings]);

  const releaseVideo = useCallback(() => {
    if (videoUrlRef.current) URL.revokeObjectURL(videoUrlRef.current);
    videoUrlRef.current = null;
  }, []);

  const releaseShots = useCallback((list: Shot[]) => {
    for (const shot of list) URL.revokeObjectURL(shot.url);
  }, []);

  useEffect(() => {
    return () => {
      if (videoUrlRef.current) URL.revokeObjectURL(videoUrlRef.current);
      for (const shot of shotsRef.current) URL.revokeObjectURL(shot.url);
    };
  }, []);

  const loadFile = useCallback(
    (file: File, hint?: number) => {
      if (!isVideoFile(file)) {
        setNotice({ tone: "error", text: "Chọn một file video — MP4, WebM hoặc MOV." });
        return;
      }
      if (file.size === 0) {
        setNotice({ tone: "error", text: "File này trống." });
        return;
      }
      releaseShots(shotsRef.current);
      setShots([]);
      setSelected(new Set());
      setLightbox(null);
      releaseVideo();
      const url = URL.createObjectURL(file);
      videoUrlRef.current = url;
      hintRef.current = hint;
      setVideoUrl(url);
      setFileName(file.name);
      setFileSize(file.size);
      setMeta({ width: 0, height: 0, duration: hint ?? 0 });
      setPlayhead(0);
      setPlaying(false);
      setNotice(
        file.size > 500 * 1024 * 1024
          ? { tone: "info", text: "File lớn, tách sẽ chậm hơn. Máy vẫn xử lý tại chỗ, không tải lên." }
          : null,
      );
    },
    [releaseShots, releaseVideo],
  );

  useEffect(() => {
    let depth = 0;
    const hasFiles = (event: DragEvent) => event.dataTransfer?.types?.includes("Files") ?? false;
    const onOver = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
    };
    const onEnter = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth += 1;
      setDragging(true);
    };
    const onLeave = () => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onDrop = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth = 0;
      setDragging(false);
      const file = event.dataTransfer?.files?.[0];
      if (file) loadFile(file);
    };
    window.addEventListener("dragover", onOver);
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [loadFile]);

  const busy = progress !== null;

  const appendShots = useCallback((incoming: Shot[]) => {
    if (incoming.length === 0) return;
    setShots((prev) => [...prev, ...incoming]);
    setSelected((prev) => {
      const next = new Set(prev);
      for (const shot of incoming) next.add(shot.id);
      return next;
    });
  }, []);

  const run = useCallback(
    async (mode: Mode) => {
      const video = videoRef.current;
      if (!video || busyRef.current) return;
      busyRef.current = true;
      cancelRef.current = false;
      setJob("extract");
      setNotice(null);
      setProgress({ done: 0, total: 1, label: "Đang chuẩn bị" });
      try {
        const made = await extractFrames(
          video,
          { ...settingsRef.current, mode },
          hintRef.current,
          setProgress,
          () => cancelRef.current,
        );
        appendShots(made);
        if (made.length === 0) {
          setNotice({ tone: "error", text: "Chưa chụp được ảnh nào." });
        }
      } catch (error) {
        setNotice({
          tone: "error",
          text: error instanceof Error ? error.message : "Tách ảnh thất bại.",
        });
      } finally {
        busyRef.current = false;
        setJob(null);
        setProgress(null);
      }
    },
    [appendShots],
  );

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video || busyRef.current) return;
    if (video.paused) void video.play();
    else video.pause();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (event.key === "Escape") {
        setLightbox(null);
        return;
      }
      if (event.key === " ") {
        event.preventDefault();
        togglePlay();
      } else if (event.key === "c" || event.key === "C") {
        if (videoRef.current && !busyRef.current) void run("playhead");
      } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        const video = videoRef.current;
        if (!video || busyRef.current) return;
        event.preventDefault();
        const delta = event.key === "ArrowLeft" ? -0.1 : 0.1;
        video.pause();
        video.currentTime = Math.max(0, video.currentTime + delta);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [run, togglePlay]);

  const chosen = useMemo(() => shots.filter((shot) => selected.has(shot.id)), [shots, selected]);
  const chosenBytes = chosen.reduce((sum, shot) => sum + shot.blob.size, 0);
  const plan = describePlan(meta.duration, settings);
  const modeHint = MODES.find((item) => item.value === settings.mode)?.hint ?? "";

  const update = (patch: Partial<ExtractSettings>) => setSettings((prev) => ({ ...prev, ...patch }));

  async function makeSample() {
    if (busyRef.current) return;
    busyRef.current = true;
    setJob("other");
    setNotice(null);
    setProgress({ done: 0, total: 1, label: "Đang dựng clip mẫu" });
    try {
      const sample = await recordSampleClip((label) => setProgress({ done: 0, total: 1, label }));
      loadFile(sample.file, sample.duration);
    } catch (error) {
      setNotice({
        tone: "error",
        text: error instanceof Error ? error.message : "Không dựng được clip mẫu.",
      });
    } finally {
      busyRef.current = false;
      setJob(null);
      setProgress(null);
    }
  }

  function namesFor(list: Shot[]) {
    return list.map((shot) => {
      const index = shots.findIndex((item) => item.id === shot.id);
      return shotFilename(index < 0 ? 0 : index, shot, settings.prefix);
    });
  }

  async function downloadZip() {
    if (chosen.length === 0 || busyRef.current) return;
    busyRef.current = true;
    setJob("other");
    setProgress({ done: 0, total: chosen.length, label: "Đang đóng gói ZIP" });
    try {
      const blob = await zipShots(chosen, namesFor(chosen));
      const url = URL.createObjectURL(blob);
      downloadUrl(url, `${settings.prefix || "khung"}-anh.zip`);
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (error) {
      setNotice({
        tone: "error",
        text: error instanceof Error ? error.message : "Không tạo được file ZIP.",
      });
    } finally {
      busyRef.current = false;
      setJob(null);
      setProgress(null);
    }
  }

  async function saveFolder() {
    if (chosen.length === 0 || busyRef.current) return;
    const pick = directoryPicker();
    if (!pick) {
      setNotice({
        tone: "info",
        text: "Trình duyệt này không mở được thư mục. Hãy dùng Tải ZIP.",
      });
      return;
    }
    let dir;
    try {
      dir = await pick({ mode: "readwrite" });
    } catch {
      return;
    }
    busyRef.current = true;
    setJob("other");
    setProgress({ done: 0, total: chosen.length, label: "Đang ghi vào thư mục" });
    try {
      await saveToDirectory(chosen, namesFor(chosen), dir, (done, total) => {
        setProgress({ done, total, label: "Đang ghi vào thư mục" });
      });
      setNotice({ tone: "info", text: `Đã ghi ${chosen.length} ảnh vào thư mục bạn chọn.` });
    } catch (error) {
      setNotice({
        tone: "error",
        text: error instanceof Error ? error.message : "Không ghi được vào thư mục.",
      });
    } finally {
      busyRef.current = false;
      setJob(null);
      setProgress(null);
    }
  }

  function clearStrip() {
    releaseShots(shotsRef.current);
    setShots([]);
    setSelected(new Set());
    setLightbox(null);
  }

  function removeShot(id: string) {
    const shot = shotsRef.current.find((item) => item.id === id);
    if (shot) URL.revokeObjectURL(shot.url);
    setShots((prev) => prev.filter((item) => item.id !== id));
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setLightbox(null);
  }

  const percent =
    progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="min-h-screen bg-ink text-cream">
      <header className="border-b border-line px-4 py-5 sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold tracking-widest text-brass">TÁCH ẢNH TẠI CHỖ</p>
            <h1 className="font-display text-5xl italic leading-none text-cream">KHUNG</h1>
          </div>
          <p className="max-w-sm text-sm leading-relaxed text-muted sm:text-right">
            Kéo video vào, lấy từng khung hình ra file ảnh. Mọi thứ chạy trên máy này — không gửi đi đâu.
          </p>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-4 px-4 py-4 lg:grid-cols-[minmax(0,1.45fr)_22rem] lg:px-6">
        <section className="min-w-0">
          {fileName ? (
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="truncate text-sm text-cream">{fileName}</p>
              <button
                type="button"
                className="shrink-0 text-sm text-muted underline-offset-2 hover:text-cream hover:underline"
                onClick={() => fileRef.current?.click()}
              >
                Đổi video
              </button>
            </div>
          ) : null}

          <div className="overflow-hidden rounded-lg bg-stage shadow-sheet">
            {videoUrl ? (
              <div className="flex">
                <div className="sprocket hidden w-5 sm:block" aria-hidden />
                <div className="stage-well flex min-w-0 flex-1 items-center justify-center bg-stage">
                  <video
                    ref={videoRef}
                    src={videoUrl}
                    className={cn("stage-video", busy && "opacity-80")}
                    playsInline
                    preload="auto"
                    onLoadedMetadata={(event) => {
                      const video = event.currentTarget;
                      const duration = Number.isFinite(video.duration)
                        ? video.duration
                        : (hintRef.current ?? 0);
                      setMeta({ width: video.videoWidth, height: video.videoHeight, duration });
                    }}
                    onTimeUpdate={(event) => setPlayhead(event.currentTarget.currentTime)}
                    onPlay={() => setPlaying(true)}
                    onPause={() => setPlaying(false)}
                    onEnded={() => setPlaying(false)}
                    onError={() =>
                      setNotice({
                        tone: "error",
                        text: "Không phát được video này. Hãy dùng MP4 hoặc WebM.",
                      })
                    }
                    onClick={togglePlay}
                  />
                </div>
                <div className="sprocket hidden w-5 sm:block" aria-hidden />
              </div>
            ) : (
              <div className="flex min-h-80 flex-col items-center justify-center gap-4 px-6 py-12 text-center">
                <Clapperboard className="size-8 text-brass" strokeWidth={1.5} aria-hidden />
                <div>
                  <p className="text-xs font-semibold tracking-widest text-brass">CHƯA CÓ CUỘN</p>
                  <h2 className="mt-2 text-2xl font-semibold text-cream">Thả một video vào bàn.</h2>
                  <p className="mt-2 text-sm text-muted">MP4, WebM hoặc MOV. Ảnh tách ra nằm lại trên máy này.</p>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <button
                    type="button"
                    className="inline-flex min-h-11 items-center gap-2 rounded-md bg-cream px-4 text-sm font-semibold text-ink"
                    onClick={() => fileRef.current?.click()}
                  >
                    Chọn video
                  </button>
                  <button
                    id="sample-btn"
                    type="button"
                    className="inline-flex min-h-11 items-center gap-2 rounded-md border border-line px-4 text-sm font-medium text-cream"
                    onClick={() => void makeSample()}
                    disabled={busy}
                  >
                    Xem clip mẫu
                  </button>
                </div>
              </div>
            )}

            {progress ? (
              <div className="px-4 pb-3">
                <div className="h-1 overflow-hidden rounded-full bg-line">
                  <div className="h-full bg-brass transition-[width] duration-200" style={{ width: `${percent}%` }} />
                </div>
              </div>
            ) : null}
          </div>

          {videoUrl ? (
            <div className="mt-3 space-y-3">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  className="inline-flex size-11 items-center justify-center rounded-md bg-panel text-cream"
                  onClick={togglePlay}
                  disabled={busy}
                  aria-label={playing ? "Dừng" : "Phát"}
                >
                  {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
                </button>
                <input
                  className="range range-dark"
                  type="range"
                  min={0}
                  max={meta.duration || 0}
                  step={0.01}
                  value={Math.min(playhead, meta.duration || 0)}
                  aria-label="Tua video"
                  disabled={busy || meta.duration <= 0}
                  onChange={(event) => {
                    const video = videoRef.current;
                    if (!video) return;
                    video.pause();
                    video.currentTime = Number(event.target.value);
                  }}
                />
                <p className="w-28 shrink-0 text-right text-sm tabular-nums text-muted">
                  {formatClock(playhead)}
                  <span className="text-line"> / </span>
                  {formatClock(meta.duration)}
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm tabular-nums text-muted">
                  {meta.width > 0 ? `${meta.width}×${meta.height}` : "Đang đọc"}
                  {fileSize > 0 ? ` · ${formatBytes(fileSize)}` : ""}
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="inline-flex min-h-11 items-center gap-2 rounded-md border border-line px-3 text-sm text-cream"
                    disabled={busy}
                    onClick={() => void run("playhead")}
                  >
                    <Aperture className="size-4 text-brass" />
                    Chụp khung này
                  </button>
                  {settings.mode !== "playhead" ? (
                    <button
                      id="extract-btn"
                      type="button"
                      className="inline-flex min-h-11 items-center gap-2 rounded-md bg-brass px-4 text-sm font-semibold text-ink hover:bg-brass-hot disabled:opacity-50"
                      disabled={busy || meta.width === 0}
                      onClick={() => void run(settings.mode)}
                    >
                      Tách ảnh
                    </button>
                  ) : (
                    <button
                      id="extract-btn"
                      type="button"
                      className="sr-only"
                      disabled={busy || meta.width === 0}
                      onClick={() => void run("playhead")}
                    >
                      Tách ảnh
                    </button>
                  )}
                </div>
              </div>
              <p className="text-xs text-muted">Phím cách phát hoặc dừng · mũi tên tua 0,1 giây · C chụp khung đang xem.</p>
            </div>
          ) : null}

          <input
            ref={fileRef}
            type="file"
            accept="video/mp4,video/webm,video/quicktime,video/*"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) loadFile(file);
            }}
          />
        </section>

        <aside className="lg:sticky lg:top-4 lg:self-start">
          <div className="rounded-lg bg-paper p-4 text-ink shadow-sheet">
            <h2 className="text-sm font-semibold tracking-wide">Cách tách</h2>
            <div className="mt-3 grid grid-cols-2 gap-1 rounded-md bg-paper-2 p-1">
              {MODES.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  aria-pressed={settings.mode === item.value}
                  className={cn(
                    "min-h-11 rounded-sm px-2 text-sm font-medium",
                    settings.mode === item.value ? "bg-ink text-cream" : "text-ink",
                  )}
                  onClick={() => update({ mode: item.value })}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-sm leading-relaxed text-ink-soft">{modeHint}</p>

            {settings.mode === "count" ? (
              <label className="mt-4 block text-sm font-medium">
                Số ảnh
                <input
                  className="mt-1 h-11 w-full rounded-md border border-paper-2 bg-paper px-3 tabular-nums"
                  type="number"
                  min={1}
                  max={MAX_FRAMES}
                  value={settings.count}
                  onChange={(event) => {
                    const n = Number(event.target.value);
                    if (Number.isFinite(n)) update({ count: Math.round(Math.min(MAX_FRAMES, Math.max(1, n))) });
                  }}
                />
              </label>
            ) : null}

            {settings.mode === "interval" ? (
              <label className="mt-4 block text-sm font-medium">
                Mỗi bao nhiêu giây
                <input
                  className="mt-1 h-11 w-full rounded-md border border-paper-2 bg-paper px-3 tabular-nums"
                  type="number"
                  min={0.1}
                  max={60}
                  step={0.1}
                  value={settings.intervalSec}
                  onChange={(event) => {
                    const n = Number(event.target.value);
                    if (Number.isFinite(n)) update({ intervalSec: Math.min(60, Math.max(0.1, n)) });
                  }}
                />
              </label>
            ) : null}

            {settings.mode === "scene" ? (
              <label className="mt-4 block text-sm font-medium">
                Độ nhạy
                <input
                  className="range mt-2"
                  type="range"
                  min={1}
                  max={10}
                  step={1}
                  value={settings.sensitivity}
                  onChange={(event) => update({ sensitivity: Number(event.target.value) })}
                />
                <span className="mt-1 block text-sm font-normal text-ink-soft">
                  {sensitivityLabel(settings.sensitivity)}
                </span>
              </label>
            ) : null}

            <p className="mt-4 text-sm font-medium">Định dạng</p>
            <div className="mt-1 flex gap-1 rounded-md bg-paper-2 p-1">
              {FORMATS.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  aria-pressed={settings.format === item.value}
                  className={cn(
                    "min-h-11 flex-1 rounded-sm text-sm font-medium",
                    settings.format === item.value ? "bg-ink text-cream" : "text-ink",
                  )}
                  onClick={() => update({ format: item.value })}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <p className="mt-4 text-sm font-medium">Cạnh dài tối đa</p>
            <div className="mt-1 flex gap-1 rounded-md bg-paper-2 p-1">
              {EDGES.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  aria-pressed={settings.maxEdge === item.value}
                  className={cn(
                    "min-h-11 flex-1 rounded-sm text-sm font-medium",
                    settings.maxEdge === item.value ? "bg-ink text-cream" : "text-ink",
                  )}
                  onClick={() => update({ maxEdge: item.value })}
                >
                  {item.label}
                </button>
              ))}
            </div>

            {settings.format !== "image/png" ? (
              <label className="mt-4 block text-sm font-medium">
                Độ nét · {Math.round(settings.quality * 100)}%
                <input
                  className="range mt-2"
                  type="range"
                  min={0.5}
                  max={1}
                  step={0.01}
                  value={settings.quality}
                  onChange={(event) => update({ quality: Number(event.target.value) })}
                />
              </label>
            ) : null}

            <label className="mt-4 block text-sm font-medium">
              Tên file
              <input
                className="mt-1 h-11 w-full rounded-md border border-paper-2 bg-paper px-3"
                value={settings.prefix}
                maxLength={40}
                onChange={(event) => update({ prefix: event.target.value })}
              />
            </label>

            <p className="mt-4 text-sm leading-relaxed text-ink-soft" aria-live="polite">
              {progress ? `${progress.label} · ${progress.done}/${progress.total}` : plan}
            </p>

            {videoUrl ? (
              <button
                type="button"
                className="mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-md bg-brass text-sm font-semibold text-ink hover:bg-brass-hot disabled:opacity-50"
                disabled={busy || meta.width === 0}
                onClick={() => void run(settings.mode)}
              >
                {busy ? "Đang chạy…" : settings.mode === "playhead" ? "Chụp khung này" : "Tách ảnh"}
              </button>
            ) : (
              <button
                type="button"
                className="mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-md bg-brass text-sm font-semibold text-ink"
                onClick={() => fileRef.current?.click()}
              >
                Chọn video
              </button>
            )}

            {job === "extract" ? (
              <button
                type="button"
                className="mt-2 inline-flex min-h-11 w-full items-center justify-center rounded-md border border-ink/15 text-sm font-medium"
                onClick={() => {
                  cancelRef.current = true;
                }}
              >
                Dừng, giữ ảnh đã chụp
              </button>
            ) : null}

            <p className="mt-3 text-xs leading-relaxed text-ink-soft">
              Trình duyệt tua tới từng mốc rồi chụp. Lệch có thể một khung hình so với phần mềm dựng — đủ để lấy ảnh.
            </p>
          </div>
        </aside>
      </main>

      <section className="mx-auto max-w-6xl px-4 pb-10 lg:px-6">
        <div className="rounded-lg border border-line bg-panel">
          <div className="flex flex-col gap-3 border-b border-line px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold">Dải ảnh</h2>
              <p id="frame-count" className="text-sm tabular-nums text-muted">
                {shots.length === 0
                  ? "Ảnh tách ra sẽ nằm ở đây."
                  : `${shots.length} ảnh · ${chosen.length} đang chọn · ${formatBytes(chosenBytes)}`}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="inline-flex min-h-11 items-center rounded-md px-3 text-sm text-cream disabled:opacity-40"
                disabled={shots.length === 0}
                onClick={() =>
                  setSelected((prev) =>
                    prev.size === shots.length ? new Set() : new Set(shots.map((shot) => shot.id)),
                  )
                }
              >
                {selected.size === shots.length && shots.length > 0 ? "Bỏ chọn" : "Chọn hết"}
              </button>
              <button
                type="button"
                className="inline-flex min-h-11 items-center gap-2 rounded-md border border-line px-3 text-sm text-cream disabled:opacity-40"
                disabled={chosen.length === 0 || busy}
                onClick={() => void saveFolder()}
              >
                <FolderDown className="size-4" />
                Lưu thư mục
              </button>
              <button
                id="zip-btn"
                type="button"
                className="inline-flex min-h-11 items-center gap-2 rounded-md bg-cream px-3 text-sm font-semibold text-ink disabled:opacity-40"
                disabled={chosen.length === 0 || busy}
                onClick={() => void downloadZip()}
              >
                <Download className="size-4" />
                Tải ZIP
              </button>
              <button
                type="button"
                className="inline-flex min-h-11 items-center gap-2 rounded-md px-3 text-sm text-muted disabled:opacity-40"
                disabled={shots.length === 0 || busy}
                onClick={clearStrip}
              >
                <Trash2 className="size-4" />
                Xóa dải
              </button>
            </div>
          </div>

          {notice ? (
            <p
              className={cn(
                "px-4 py-3 text-sm",
                notice.tone === "error" ? "text-ember" : "text-brass",
              )}
              role={notice.tone === "error" ? "alert" : "status"}
            >
              {notice.text}
            </p>
          ) : null}

          {shots.length > 0 ? (
            <ul id="frame-grid" className="strip grid grid-cols-2 gap-3 overflow-auto p-4 sm:grid-cols-3 lg:grid-cols-6">
              {shots.map((shot, index) => {
                const on = selected.has(shot.id);
                return (
                  <li key={shot.id} className={cn("overflow-hidden rounded-md bg-stage ring-2 ring-transparent", on && "ring-brass")}>
                    <div className="relative">
                      <button
                        type="button"
                        className="block w-full"
                        onClick={() => setLightbox(index)}
                        aria-label={`Xem khung ${formatClock(shot.time)}`}
                      >
                        <span className="flex aspect-video items-center justify-center bg-stage">
                          <img
                            src={shot.url}
                            alt={`Khung lúc ${formatClock(shot.time)}`}
                            className="max-h-full max-w-full"
                          />
                        </span>
                      </button>
                      <label className="absolute top-0 left-0 flex size-11 items-start justify-start p-2">
                        <input
                          type="checkbox"
                          className="sr-only"
                          checked={on}
                          onChange={() =>
                            setSelected((prev) => {
                              const next = new Set(prev);
                              if (next.has(shot.id)) next.delete(shot.id);
                              else next.add(shot.id);
                              return next;
                            })
                          }
                        />
                        <span
                          className={cn(
                            "flex size-5 items-center justify-center rounded-sm border",
                            on ? "border-brass bg-brass text-ink" : "border-cream/70 bg-ink/70 text-cream",
                          )}
                          aria-hidden
                        >
                          {on ? <Check className="size-3" /> : null}
                        </span>
                      </label>
                    </div>
                    <div className="flex items-center justify-between gap-1 px-2 py-1">
                      <p className="text-xs tabular-nums text-muted">{formatClock(shot.time)}</p>
                      <div className="flex">
                        <button
                          type="button"
                          className="inline-flex size-11 items-center justify-center text-muted hover:text-cream"
                          aria-label="Tải ảnh này"
                          onClick={() => downloadUrl(shot.url, shotFilename(index, shot, settings.prefix))}
                        >
                          <ImageDown className="size-4" />
                        </button>
                        <button
                          type="button"
                          className="inline-flex size-11 items-center justify-center text-muted hover:text-cream"
                          aria-label="Bỏ ảnh này"
                          onClick={() => removeShot(shot.id)}
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      </section>

      {lightbox !== null && shots[lightbox] ? (
        <div
          className="fixed inset-0 z-50 flex flex-col bg-ink/95 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Xem khung hình"
        >
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm tabular-nums text-muted">
              {formatClock(shots[lightbox].time)} · {shots[lightbox].width}×{shots[lightbox].height}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                className="inline-flex min-h-11 items-center gap-2 rounded-md bg-cream px-3 text-sm font-semibold text-ink"
                onClick={() =>
                  downloadUrl(
                    shots[lightbox].url,
                    shotFilename(lightbox, shots[lightbox], settings.prefix),
                  )
                }
              >
                <ImageDown className="size-4" />
                Tải ảnh
              </button>
              <button
                type="button"
                className="inline-flex size-11 items-center justify-center rounded-md border border-line text-cream"
                aria-label="Đóng"
                autoFocus
                onClick={() => setLightbox(null)}
              >
                <X className="size-4" />
              </button>
            </div>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center gap-2 py-4">
            <button
              type="button"
              className="hidden size-11 shrink-0 items-center justify-center rounded-md border border-line text-cream sm:inline-flex"
              aria-label="Khung trước"
              disabled={lightbox <= 0}
              onClick={() => setLightbox((index) => (index === null ? index : Math.max(0, index - 1)))}
            >
              ‹
            </button>
            <img
              src={shots[lightbox].url}
              alt={`Khung lúc ${formatClock(shots[lightbox].time)}`}
              className="max-h-full max-w-full object-contain"
            />
            <button
              type="button"
              className="hidden size-11 shrink-0 items-center justify-center rounded-md border border-line text-cream sm:inline-flex"
              aria-label="Khung sau"
              disabled={lightbox >= shots.length - 1}
              onClick={() =>
                setLightbox((index) => (index === null ? index : Math.min(shots.length - 1, index + 1)))
              }
            >
              ›
            </button>
          </div>
        </div>
      ) : null}

      {dragging ? (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-ink/80">
          <p className="font-display text-4xl italic text-cream">Thả video vào</p>
        </div>
      ) : null}
    </div>
  );
}
