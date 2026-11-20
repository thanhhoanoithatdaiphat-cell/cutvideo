const WIDTH = 960;
const HEIGHT = 540;
const DURATION = 3;

export async function recordSampleClip(onProgress?: (label: string) => void): Promise<{
  file: File;
  duration: number;
}> {
  onProgress?.("Đang dựng clip mẫu");
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("Không tạo được clip mẫu");

  const capture = (
    canvas as HTMLCanvasElement & { captureStream?: (fps?: number) => MediaStream }
  ).captureStream;
  if (!capture || typeof MediaRecorder === "undefined") {
    throw new Error("Trình duyệt này không dựng được clip mẫu. Hãy chọn một video có sẵn.");
  }

  if (document.fonts?.ready) await document.fonts.ready;

  const mime = pickMime();
  const stream = capture.call(canvas, 30);
  const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 2_500_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };
  const stopped = new Promise<Blob>((resolve, reject) => {
    recorder.onerror = () => reject(new Error("Không ghi được clip mẫu"));
    recorder.onstop = () => resolve(new Blob(chunks, { type: "video/webm" }));
  });

  paint(ctx, 0);
  recorder.start();
  const started = performance.now();
  await new Promise<void>((resolve) => {
    const tick = (now: number) => {
      const t = Math.min(1, (now - started) / (DURATION * 1000));
      paint(ctx, t);
      if (t < 1) requestAnimationFrame(tick);
      else resolve();
    };
    requestAnimationFrame(tick);
  });
  recorder.stop();
  stream.getTracks().forEach((track) => track.stop());
  const blob = await stopped;
  if (blob.size < 800) throw new Error("Clip mẫu bị trống. Hãy chọn video của bạn.");
  return {
    file: new File([blob], "clip-mau-khung.webm", { type: "video/webm" }),
    duration: DURATION,
  };
}

function pickMime() {
  const candidates = ["video/webm;codecs=vp8", "video/webm;codecs=vp9", "video/webm"];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? "video/webm";
}

function paint(ctx: CanvasRenderingContext2D, t: number) {
  const { width: w, height: h } = ctx.canvas;
  const scene = t < 1 / 3 ? 0 : t < 2 / 3 ? 1 : 2;
  if (scene === 0) {
    ctx.fillStyle = "#14110E";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#C6A15B";
    ctx.beginPath();
    ctx.arc(w * (0.22 + t * 0.9), h * 0.55, 78, 0, Math.PI * 2);
    ctx.fill();
  } else if (scene === 1) {
    ctx.fillStyle = "#F3EEE6";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#14110E";
    const p = (t - 1 / 3) * 3;
    ctx.fillRect(w * 0.12, h * 0.22, Math.max(8, w * 0.76 * p), h * 0.56);
  } else {
    ctx.fillStyle = "#1C1915";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "#C6A15B";
    ctx.lineWidth = 10;
    ctx.beginPath();
    const p = (t - 2 / 3) * 3;
    ctx.moveTo(w * 0.08, h * 0.78);
    ctx.lineTo(w * (0.08 + 0.84 * p), h * (0.78 - 0.46 * p));
    ctx.stroke();
  }

  ctx.fillStyle = scene === 1 ? "#14110E" : "#F7F3EC";
  ctx.font = "560 42px Fraunces, Georgia, serif";
  ctx.fillText("KHUNG", 36, 72);
  ctx.font = "500 18px 'Be Vietnam Pro', sans-serif";
  ctx.fillText(`mẫu · ${t.toFixed(2)}s`, 36, h - 36);
}
