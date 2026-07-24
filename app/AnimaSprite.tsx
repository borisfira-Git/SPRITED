"use client";

import {
  ChangeEvent,
  DragEvent,
  PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type Bounds = { x: number; y: number; w: number; h: number };
type Frame = {
  id: string;
  name: string;
  src: string;
  sourceWidth: number;
  sourceHeight: number;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  duration: number;
  charBounds: Bounds;
  alphaBounds: Bounds;
};
type ProjectData = {
  version: 1;
  projectName: string;
  frames: Frame[];
  selectedId: string | null;
  referenceId: string | null;
  canvasWidth: number;
  canvasHeight: number;
  groundRatio: number;
  fps: number;
  loop: boolean;
};
type Snapshot = ProjectData;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));
const uid = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const imageCache = new Map<string, Promise<HTMLImageElement>>();

function loadImage(src: string) {
  if (imageCache.has(src)) return imageCache.get(src)!;
  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
  imageCache.set(src, promise);
  return promise;
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function canvasToBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("PNG export failed"))), "image/png"),
  );
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function alphaBounds(source: string | HTMLImageElement): Promise<Bounds & { empty?: boolean }> {
  const image = typeof source === "string" ? await loadImage(source) : source;
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(image, 0, 0);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let minX = canvas.width;
  let minY = canvas.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      if (pixels[(y * canvas.width + x) * 4 + 3] > 8) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }
  if (maxX < minX) {
    return { x: 0, y: 0, w: canvas.width, h: canvas.height, empty: true };
  }
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

async function makeFrame(src: string, name: string, duration: number): Promise<Frame> {
  const image = await loadImage(src);
  const bounds = await alphaBounds(image);
  const clean = { x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h };
  return {
    id: uid(),
    name,
    src,
    sourceWidth: image.naturalWidth,
    sourceHeight: image.naturalHeight,
    x: 0,
    y: 0,
    scale: 1,
    rotation: 0,
    duration,
    charBounds: { ...clean },
    alphaBounds: { ...clean },
  };
}

function icon(name: string) {
  const map: Record<string, string> = {
    new: "＋",
    open: "⌁",
    save: "↓",
    undo: "↶",
    redo: "↷",
    sheet: "▦",
    frames: "◇",
    previous: "|◀",
    next: "▶|",
    play: "▶",
    pause: "Ⅱ",
  };
  return map[name] || "•";
}

export default function AnimaSprite() {
  const [projectName, setProjectName] = useState("Untitled Animation");
  const [frames, setFrames] = useState<Frame[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [referenceId, setReferenceId] = useState<string | null>(null);
  const [canvasWidth, setCanvasWidth] = useState(512);
  const [canvasHeight, setCanvasHeight] = useState(512);
  const [groundRatio, setGroundRatio] = useState(0.88);
  const [fps, setFps] = useState(12);
  const [loop, setLoop] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [showGrid, setShowGrid] = useState(true);
  const [showGround, setShowGround] = useState(true);
  const [showBounds, setShowBounds] = useState(true);
  const [tool, setTool] = useState<"move" | "bounds">("move");
  const [status, setStatus] = useState("Ready");
  const [dirty, setDirty] = useState(false);
  const [toast, setToast] = useState<{ text: string; type?: string } | null>(null);
  const [sliceSource, setSliceSource] = useState<{ image: HTMLImageElement; name: string } | null>(null);
  const [slice, setSlice] = useState({ columns: 2, rows: 4, gapX: 0, gapY: 0, marginX: 0, marginY: 0 });
  const [exportOpen, setExportOpen] = useState(false);
  const [exportColumns, setExportColumns] = useState(4);
  const [exportPrefix, setExportPrefix] = useState("animation");
  const [backgroundColor, setBackgroundColor] = useState("#00ff00");
  const [tolerance, setTolerance] = useState(52);
  const [softness, setSoftness] = useState(12);
  const [history, setHistory] = useState<Snapshot[]>([]);
  const [future, setFuture] = useState<Snapshot[]>([]);
  const [dragId, setDragId] = useState<string | null>(null);

  const editorCanvas = useRef<HTMLCanvasElement>(null);
  const sliceCanvas = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const sheetInput = useRef<HTMLInputElement>(null);
  const framesInput = useRef<HTMLInputElement>(null);
  const projectInput = useRef<HTMLInputElement>(null);
  const pointerDrag = useRef<null | {
    startX: number;
    startY: number;
    frameX: number;
    frameY: number;
    originalBounds?: Bounds;
  }>(null);

  const selected = frames.find((frame) => frame.id === selectedId) || null;
  const reference = frames.find((frame) => frame.id === referenceId) || null;
  const selectedIndex = Math.max(0, frames.findIndex((frame) => frame.id === selectedId));

  const snapshot = useCallback(
    (): Snapshot => ({
      version: 1,
      projectName,
      frames: frames.map((frame) => ({
        ...frame,
        charBounds: { ...frame.charBounds },
        alphaBounds: { ...frame.alphaBounds },
      })),
      selectedId,
      referenceId,
      canvasWidth,
      canvasHeight,
      groundRatio,
      fps,
      loop,
    }),
    [projectName, frames, selectedId, referenceId, canvasWidth, canvasHeight, groundRatio, fps, loop],
  );

  const restore = useCallback((data: Snapshot) => {
    setPlaying(false);
    setProjectName(data.projectName || "Untitled Animation");
    setFrames(data.frames || []);
    setSelectedId(data.selectedId || data.frames?.[0]?.id || null);
    setReferenceId(data.referenceId || data.frames?.[0]?.id || null);
    setCanvasWidth(data.canvasWidth || 512);
    setCanvasHeight(data.canvasHeight || 512);
    setGroundRatio(data.groundRatio || 0.88);
    setFps(data.fps || 12);
    setLoop(data.loop ?? true);
    imageCache.clear();
  }, []);

  function pushHistory() {
    setHistory((items) => [...items.slice(-49), snapshot()]);
    setFuture([]);
    setDirty(true);
  }

  function showToast(text: string, type = "") {
    setToast({ text, type });
    window.setTimeout(() => setToast(null), 2500);
  }

  function undo() {
    if (!history.length) return;
    setFuture((items) => [...items, snapshot()]);
    const previous = history[history.length - 1];
    setHistory((items) => items.slice(0, -1));
    restore(previous);
  }

  function redo() {
    if (!future.length) return;
    setHistory((items) => [...items, snapshot()]);
    const next = future[future.length - 1];
    setFuture((items) => items.slice(0, -1));
    restore(next);
  }

  const getDrawRect = useCallback(
    (frame: Frame) => {
      const w = frame.sourceWidth * frame.scale;
      const h = frame.sourceHeight * frame.scale;
      return {
        x: canvasWidth / 2 - w / 2 + frame.x,
        y: canvasHeight / 2 - h / 2 + frame.y,
        w,
        h,
      };
    },
    [canvasWidth, canvasHeight],
  );

  const renderedCharacterBounds = useCallback(
    (frame: Frame) => {
      const draw = getDrawRect(frame);
      return {
        x: draw.x + frame.charBounds.x * frame.scale,
        y: draw.y + frame.charBounds.y * frame.scale,
        w: frame.charBounds.w * frame.scale,
        h: frame.charBounds.h * frame.scale,
      };
    },
    [getDrawRect],
  );

  const drawFrame = useCallback(
    async (ctx: CanvasRenderingContext2D, frame: Frame | null, overlays = false) => {
      ctx.clearRect(0, 0, canvasWidth, canvasHeight);
      if (frame) {
        const image = await loadImage(frame.src);
        const draw = getDrawRect(frame);
        ctx.save();
        ctx.translate(draw.x + draw.w / 2, draw.y + draw.h / 2);
        ctx.rotate((frame.rotation * Math.PI) / 180);
        ctx.drawImage(image, -draw.w / 2, -draw.h / 2, draw.w, draw.h);
        ctx.restore();
      }
      if (!overlays) return;
      ctx.save();
      if (showGrid) {
        ctx.strokeStyle = "rgba(255,255,255,.15)";
        ctx.setLineDash([5, 7]);
        ctx.beginPath();
        ctx.moveTo(canvasWidth / 2 + 0.5, 0);
        ctx.lineTo(canvasWidth / 2 + 0.5, canvasHeight);
        ctx.moveTo(0, canvasHeight / 2 + 0.5);
        ctx.lineTo(canvasWidth, canvasHeight / 2 + 0.5);
        ctx.stroke();
      }
      if (showGround) {
        const y = canvasHeight * groundRatio;
        ctx.setLineDash([]);
        ctx.strokeStyle = "rgba(87,217,155,.95)";
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvasWidth, y);
        ctx.stroke();
        ctx.fillStyle = "#57d99b";
        ctx.font = "11px system-ui";
        ctx.fillText("GROUND", 8, y - 7);
      }
      if (showBounds && frame) {
        const box = renderedCharacterBounds(frame);
        ctx.setLineDash([6, 4]);
        ctx.strokeStyle = "#ff984b";
        ctx.fillStyle = "rgba(255,138,61,.08)";
        ctx.lineWidth = 2;
        ctx.fillRect(box.x, box.y, box.w, box.h);
        ctx.strokeRect(box.x, box.y, box.w, box.h);
        ctx.setLineDash([]);
        for (const [x, y] of [
          [box.x, box.y],
          [box.x + box.w, box.y],
          [box.x, box.y + box.h],
          [box.x + box.w, box.y + box.h],
        ]) {
          ctx.fillStyle = "#15100e";
          ctx.strokeStyle = "#ffb06b";
          ctx.fillRect(x - 4, y - 4, 8, 8);
          ctx.strokeRect(x - 4, y - 4, 8, 8);
        }
      }
      ctx.restore();
    },
    [canvasWidth, canvasHeight, getDrawRect, groundRatio, renderedCharacterBounds, showBounds, showGrid, showGround],
  );

  useEffect(() => {
    const canvas = editorCanvas.current;
    if (!canvas) return;
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    void drawFrame(canvas.getContext("2d")!, selected, true);
  }, [canvasWidth, canvasHeight, drawFrame, selected]);

  useEffect(() => {
    if (!playing || !frames.length) return;
    const frame = selected || frames[0];
    const timer = window.setTimeout(() => {
      const index = frames.indexOf(frame);
      if (!loop && index === frames.length - 1) {
        setPlaying(false);
        return;
      }
      const next = (index + 1) % frames.length;
      setSelectedId(frames[next].id);
    }, frame.duration || Math.round(1000 / fps));
    return () => window.clearTimeout(timer);
  }, [playing, selectedId, frames, selected, loop, fps]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const typing = ["INPUT", "TEXTAREA"].includes((document.activeElement as HTMLElement)?.tagName);
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        event.shiftKey ? redo() : undo();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
        event.preventDefault();
        redo();
      } else if (!typing && event.code === "Space") {
        event.preventDefault();
        setPlaying((value) => !value);
      } else if (!typing && event.key === "ArrowRight") {
        stepFrame(1);
      } else if (!typing && event.key === "ArrowLeft") {
        stepFrame(-1);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    if (!sliceSource || !sliceCanvas.current) return;
    const canvas = sliceCanvas.current;
    const image = sliceSource.image;
    const ratio = Math.min(700 / image.naturalWidth, 420 / image.naturalHeight, 1);
    canvas.width = Math.round(image.naturalWidth * ratio);
    canvas.height = Math.round(image.naturalHeight * ratio);
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const cellW = Math.floor(
      (image.naturalWidth - slice.marginX - slice.gapX * (slice.columns - 1)) / slice.columns,
    );
    const cellH = Math.floor(
      (image.naturalHeight - slice.marginY - slice.gapY * (slice.rows - 1)) / slice.rows,
    );
    ctx.save();
    ctx.scale(ratio, ratio);
    ctx.fillStyle = "rgba(255,138,61,.08)";
    ctx.strokeStyle = "#ff984b";
    ctx.lineWidth = 2 / ratio;
    ctx.font = `${12 / ratio}px system-ui`;
    for (let row = 0; row < slice.rows; row += 1) {
      for (let col = 0; col < slice.columns; col += 1) {
        const x = slice.marginX + col * (cellW + slice.gapX);
        const y = slice.marginY + row * (cellH + slice.gapY);
        ctx.fillRect(x, y, cellW, cellH);
        ctx.strokeRect(x, y, cellW, cellH);
        ctx.fillStyle = "#ffb06b";
        ctx.fillText(String(row * slice.columns + col + 1), x + 7 / ratio, y + 16 / ratio);
        ctx.fillStyle = "rgba(255,138,61,.08)";
      }
    }
    ctx.restore();
  }, [sliceSource, slice]);

  function updateFrame(id: string, patch: Partial<Frame>) {
    setFrames((items) => items.map((frame) => (frame.id === id ? { ...frame, ...patch } : frame)));
    setDirty(true);
  }

  function updateBounds(id: string, patch: Partial<Bounds>) {
    setFrames((items) =>
      items.map((frame) =>
        frame.id === id
          ? { ...frame, charBounds: { ...frame.charBounds, ...patch } }
          : frame,
      ),
    );
    setDirty(true);
  }

  async function importSeparate(files: FileList | File[]) {
    const images = Array.from(files).filter((file) => file.type.startsWith("image/"));
    if (!images.length) return;
    pushHistory();
    setStatus(`Importing ${images.length} frames…`);
    const created: Frame[] = [];
    for (const file of images) {
      const src = await fileToDataUrl(file);
      created.push(
        await makeFrame(
          src,
          file.name.replace(/\.[^.]+$/, ""),
          Math.round(1000 / fps),
        ),
      );
    }
    setFrames((items) => [...items, ...created]);
    setSelectedId((value) => value || created[0].id);
    setReferenceId((value) => value || created[0].id);
    setStatus("Frames imported");
    showToast(`${created.length} frames imported`, "success");
  }

  async function openSlicer(file?: File) {
    if (!file) return;
    const src = await fileToDataUrl(file);
    const image = await loadImage(src);
    const ratio = image.naturalWidth / image.naturalHeight;
    const columns = ratio > 2.5 ? Math.max(1, Math.round(ratio)) : ratio < 0.45 ? 1 : 2;
    const rows = ratio < 0.45 ? Math.max(1, Math.round(1 / ratio)) : Math.max(1, Math.round((columns * image.naturalHeight) / image.naturalWidth));
    setSlice({ columns, rows, gapX: 0, gapY: 0, marginX: 0, marginY: 0 });
    setSliceSource({ image, name: file.name.replace(/\.[^.]+$/, "") });
  }

  async function confirmSlice() {
    if (!sliceSource) return;
    const image = sliceSource.image;
    const cellW = Math.floor(
      (image.naturalWidth - slice.marginX - slice.gapX * (slice.columns - 1)) / slice.columns,
    );
    const cellH = Math.floor(
      (image.naturalHeight - slice.marginY - slice.gapY * (slice.rows - 1)) / slice.rows,
    );
    if (cellW < 1 || cellH < 1) return showToast("The grid does not fit the image", "error");
    pushHistory();
    setStatus("Slicing sprite sheet…");
    const created: Frame[] = [];
    for (let row = 0; row < slice.rows; row += 1) {
      for (let col = 0; col < slice.columns; col += 1) {
        const canvas = document.createElement("canvas");
        canvas.width = cellW;
        canvas.height = cellH;
        canvas
          .getContext("2d")!
          .drawImage(
            image,
            slice.marginX + col * (cellW + slice.gapX),
            slice.marginY + row * (cellH + slice.gapY),
            cellW,
            cellH,
            0,
            0,
            cellW,
            cellH,
          );
        const src = canvas.toDataURL("image/png");
        created.push(
          await makeFrame(
            src,
            `${sliceSource.name} ${String(created.length + 1).padStart(2, "0")}`,
            Math.round(1000 / fps),
          ),
        );
      }
    }
    setFrames((items) => [...items, ...created]);
    setSelectedId((value) => value || created[0]?.id || null);
    setReferenceId((value) => value || created[0]?.id || null);
    setSliceSource(null);
    setStatus("Sprite sheet sliced");
    showToast(`${created.length} frames created`, "success");
  }

  function centerFrame(frame: Frame) {
    const box = renderedCharacterBounds(frame);
    return { x: frame.x + canvasWidth / 2 - (box.x + box.w / 2) };
  }

  function groundFrame(frame: Frame, target = canvasHeight * groundRatio) {
    const box = renderedCharacterBounds(frame);
    return { y: frame.y + target - (box.y + box.h) };
  }

  function matchFrame(frame: Frame, ref: Frame) {
    const scale = (ref.charBounds.h * ref.scale) / Math.max(1, frame.charBounds.h);
    const scaled = { ...frame, scale };
    const centered = { ...scaled, ...centerFrame(scaled) };
    const refBox = renderedCharacterBounds(ref);
    return { ...centered, ...groundFrame(centered, refBox.y + refBox.h) };
  }

  function normalizeAll() {
    if (!reference) return showToast("Choose a reference frame first", "error");
    pushHistory();
    const centeredRef = { ...reference, ...centerFrame(reference) };
    const alignedRef = { ...centeredRef, ...groundFrame(centeredRef) };
    setFrames((items) =>
      items.map((frame) =>
        frame.id === reference.id ? alignedRef : matchFrame(frame, alignedRef),
      ),
    );
    showToast(`Normalized ${frames.length} frames`, "success");
  }

  async function detectBounds() {
    if (!selected) return;
    pushHistory();
    const bounds = await alphaBounds(selected.src);
    const clean = { x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h };
    updateFrame(selected.id, { charBounds: clean, alphaBounds: clean });
    showToast("Character box detected");
  }

  async function trimSelected() {
    if (!selected) return;
    const bounds = await alphaBounds(selected.src);
    if (bounds.empty) return showToast("This frame is empty", "error");
    pushHistory();
    const image = await loadImage(selected.src);
    const canvas = document.createElement("canvas");
    canvas.width = bounds.w;
    canvas.height = bounds.h;
    canvas
      .getContext("2d")!
      .drawImage(image, bounds.x, bounds.y, bounds.w, bounds.h, 0, 0, bounds.w, bounds.h);
    const src = canvas.toDataURL("image/png");
    updateFrame(selected.id, {
      src,
      sourceWidth: bounds.w,
      sourceHeight: bounds.h,
      alphaBounds: { x: 0, y: 0, w: bounds.w, h: bounds.h },
      charBounds: {
        x: clamp(selected.charBounds.x - bounds.x, 0, bounds.w - 1),
        y: clamp(selected.charBounds.y - bounds.y, 0, bounds.h - 1),
        w: Math.min(selected.charBounds.w, bounds.w),
        h: Math.min(selected.charBounds.h, bounds.h),
      },
    });
    imageCache.clear();
    showToast("Transparent margins trimmed", "success");
  }

  function parseHex(hex: string) {
    return {
      r: parseInt(hex.slice(1, 3), 16),
      g: parseInt(hex.slice(3, 5), 16),
      b: parseInt(hex.slice(5, 7), 16),
    };
  }

  async function removeBackground(all: boolean) {
    const targets = all ? frames : selected ? [selected] : [];
    if (!targets.length) return;
    pushHistory();
    setStatus(`Removing background from ${targets.length} frame${targets.length === 1 ? "" : "s"}…`);
    const target = parseHex(backgroundColor);
    const replacements = new Map<string, Frame>();
    for (const frame of targets) {
      const image = await loadImage(frame.src);
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(image, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      for (let index = 0; index < imageData.data.length; index += 4) {
        const dr = imageData.data[index] - target.r;
        const dg = imageData.data[index + 1] - target.g;
        const db = imageData.data[index + 2] - target.b;
        const distance = Math.sqrt(dr * dr + dg * dg + db * db);
        if (distance <= tolerance) imageData.data[index + 3] = 0;
        else if (distance < tolerance + softness && softness > 0) {
          imageData.data[index + 3] = Math.round(
            imageData.data[index + 3] * ((distance - tolerance) / softness),
          );
        }
        if (
          imageData.data[index + 1] > imageData.data[index] * 1.15 &&
          imageData.data[index + 1] > imageData.data[index + 2] * 1.15 &&
          distance < tolerance + softness * 2
        ) {
          imageData.data[index + 1] = Math.max(
            imageData.data[index],
            imageData.data[index + 2],
          );
        }
      }
      ctx.putImageData(imageData, 0, 0);
      const src = canvas.toDataURL("image/png");
      const bounds = await alphaBounds(src);
      const clean = { x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h };
      replacements.set(frame.id, { ...frame, src, alphaBounds: clean, charBounds: clean });
    }
    setFrames((items) => items.map((frame) => replacements.get(frame.id) || frame));
    imageCache.clear();
    setStatus("Background removed");
    showToast("Background removed", "success");
  }

  function fitSelected() {
    if (!selected) return;
    pushHistory();
    const source = selected.alphaBounds;
    const scale = Math.min(
      (canvasWidth * 0.88) / source.w,
      (canvasHeight * 0.88) / source.h,
      1,
    );
    const temp = { ...selected, scale, x: 0, y: 0 };
    const box = renderedCharacterBounds(temp);
    updateFrame(selected.id, {
      scale,
      x: canvasWidth / 2 - (box.x + box.w / 2),
      y: canvasHeight / 2 - (box.y + box.h / 2),
    });
  }

  function stepFrame(direction: number) {
    if (!frames.length) return;
    const current = Math.max(0, frames.findIndex((frame) => frame.id === selectedId));
    const next = loop
      ? (current + direction + frames.length) % frames.length
      : clamp(current + direction, 0, frames.length - 1);
    setSelectedId(frames[next].id);
  }

  async function frameCanvas(frame: Frame) {
    const canvas = document.createElement("canvas");
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    await drawFrame(canvas.getContext("2d")!, frame, false);
    return canvas;
  }

  function safePrefix() {
    return (
      (exportPrefix || projectName || "animation")
        .trim()
        .replace(/[^\w-]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .toLowerCase() || "animation"
    );
  }

  function metadata(columns: number) {
    return {
      animation: safePrefix(),
      fps,
      loop,
      frame_width: canvasWidth,
      frame_height: canvasHeight,
      frames: frames.length,
      horizontal_frames: Math.min(columns, frames.length),
      vertical_frames: Math.ceil(frames.length / columns),
      durations_ms: frames.map((frame) => frame.duration),
      reference_frame: Math.max(0, frames.findIndex((frame) => frame.id === referenceId)),
    };
  }

  async function exportSheet() {
    if (!frames.length) return;
    const columns = clamp(exportColumns || 1, 1, frames.length);
    const rows = Math.ceil(frames.length / columns);
    const canvas = document.createElement("canvas");
    canvas.width = canvasWidth * columns;
    canvas.height = canvasHeight * rows;
    const ctx = canvas.getContext("2d")!;
    setStatus("Rendering sprite sheet…");
    for (let index = 0; index < frames.length; index += 1) {
      const cell = await frameCanvas(frames[index]);
      ctx.drawImage(
        cell,
        (index % columns) * canvasWidth,
        Math.floor(index / columns) * canvasHeight,
      );
    }
    downloadBlob(await canvasToBlob(canvas), `${safePrefix()}_${columns}x${rows}.png`);
    downloadBlob(
      new Blob([JSON.stringify(metadata(columns), null, 2)], { type: "application/json" }),
      `${safePrefix()}.json`,
    );
    setExportOpen(false);
    setStatus("Sprite sheet exported");
    showToast(`Exported ${canvas.width} × ${canvas.height} sprite sheet`, "success");
  }

  async function exportFrames() {
    if (!frames.length) return;
    const picker = (window as Window & {
      showDirectoryPicker?: (options: { mode: string }) => Promise<FileSystemDirectoryHandle>;
    }).showDirectoryPicker;
    let directory: FileSystemDirectoryHandle | null = null;
    if (picker) {
      try {
        directory = await picker({ mode: "readwrite" });
      } catch {
        return;
      }
    }
    for (let index = 0; index < frames.length; index += 1) {
      const blob = await canvasToBlob(await frameCanvas(frames[index]));
      const filename = `${safePrefix()}_${String(index + 1).padStart(3, "0")}.png`;
      if (directory) {
        const handle = await directory.getFileHandle(filename, { create: true });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
      } else {
        downloadBlob(blob, filename);
        await new Promise((resolve) => setTimeout(resolve, 80));
      }
    }
    const json = new Blob([JSON.stringify(metadata(exportColumns), null, 2)], {
      type: "application/json",
    });
    if (directory) {
      const handle = await directory.getFileHandle(`${safePrefix()}.json`, { create: true });
      const writable = await handle.createWritable();
      await writable.write(json);
      await writable.close();
    } else downloadBlob(json, `${safePrefix()}.json`);
    setExportOpen(false);
    showToast(`${frames.length} frames exported`, "success");
  }

  function saveProject() {
    const blob = new Blob([JSON.stringify(snapshot())], { type: "application/json" });
    const filename = `${projectName.replace(/[^\w-]+/g, "_").toLowerCase()}.spriteproject`;
    downloadBlob(blob, filename);
    setDirty(false);
    showToast("Project saved", "success");
  }

  async function openProject(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text()) as Snapshot;
      if (!Array.isArray(data.frames)) throw new Error("Invalid project");
      setHistory([]);
      setFuture([]);
      restore(data);
      setDirty(false);
      showToast("Project opened", "success");
    } catch {
      showToast("Could not open this project file", "error");
    }
    event.target.value = "";
  }

  function newProject() {
    if (frames.length && !window.confirm("Start a new project? Unsaved work will be cleared.")) return;
    setProjectName("Untitled Animation");
    setFrames([]);
    setSelectedId(null);
    setReferenceId(null);
    setCanvasWidth(512);
    setCanvasHeight(512);
    setGroundRatio(0.88);
    setFps(12);
    setLoop(true);
    setHistory([]);
    setFuture([]);
    setDirty(false);
  }

  function canvasPoint(event: ReactPointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvasWidth,
      y: ((event.clientY - rect.top) / rect.height) * canvasHeight,
    };
  }

  function pointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!selected) return;
    pushHistory();
    const point = canvasPoint(event);
    pointerDrag.current = {
      startX: point.x,
      startY: point.y,
      frameX: selected.x,
      frameY: selected.y,
      originalBounds: { ...selected.charBounds },
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function pointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!selected || !pointerDrag.current) return;
    const point = canvasPoint(event);
    const dx = point.x - pointerDrag.current.startX;
    const dy = point.y - pointerDrag.current.startY;
    if (tool === "move") {
      updateFrame(selected.id, {
        x: pointerDrag.current.frameX + dx,
        y: pointerDrag.current.frameY + dy,
      });
    } else {
      updateBounds(selected.id, {
        x: pointerDrag.current.originalBounds!.x + dx / selected.scale,
        y: pointerDrag.current.originalBounds!.y + dy / selected.scale,
      });
    }
  }

  function onDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    const files = Array.from(event.dataTransfer.files).filter((file) =>
      file.type.startsWith("image/"),
    );
    if (files.length === 1) void openSlicer(files[0]);
    else if (files.length > 1) void importSeparate(files);
  }

  function reorder(overId: string) {
    if (!dragId || dragId === overId) return;
    pushHistory();
    setFrames((items) => {
      const copy = [...items];
      const from = copy.findIndex((frame) => frame.id === dragId);
      const to = copy.findIndex((frame) => frame.id === overId);
      const [moved] = copy.splice(from, 1);
      copy.splice(to, 0, moved);
      return copy;
    });
    setDragId(null);
  }

  const sheetRows = Math.ceil(frames.length / Math.max(1, Math.min(exportColumns, frames.length)));
  const totalMs = useMemo(
    () => frames.slice(0, selectedIndex + 1).reduce((sum, frame) => sum + frame.duration, 0),
    [frames, selectedIndex],
  );
  const formatTime = (ms: number) =>
    `${String(Math.floor(ms / 60000)).padStart(2, "0")}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`;

  return (
    <div className="app-shell" onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark"><span /><span /><span /><span /></div>
          <div><strong>AnimaSprite</strong><small>Sprite Sheet Studio</small></div>
        </div>
        <div className="project-title">
          <input value={projectName} onChange={(event) => { setProjectName(event.target.value); setDirty(true); }} aria-label="Project name" />
          <span>{dirty ? "Unsaved changes" : "Local project"}</span>
        </div>
        <nav className="toolbar" aria-label="Project tools">
          <button onClick={newProject}>{icon("new")} New</button>
          <button onClick={() => projectInput.current?.click()}>{icon("open")} Open</button>
          <button onClick={saveProject}>{icon("save")} Save</button>
          <i />
          <button className="icon-button" onClick={undo} disabled={!history.length} aria-label="Undo">{icon("undo")}</button>
          <button className="icon-button" onClick={redo} disabled={!future.length} aria-label="Redo">{icon("redo")}</button>
          <i />
          <button className="primary" onClick={() => { setExportPrefix(projectName === "Untitled Animation" ? "animation" : projectName); setExportOpen(true); }}>Export</button>
        </nav>
      </header>

      <main className="workspace">
        <aside className="left-panel">
          <div className="panel-heading">
            <div><span className="eyebrow">ANIMATION</span><h2>Frames <b>{frames.length}</b></h2></div>
            <button className="square-button" onClick={() => framesInput.current?.click()}>＋</button>
          </div>
          <div className="import-stack">
            <button onClick={() => sheetInput.current?.click()}><span>▦</span><div><strong>Sprite Sheet</strong><small>Slice rows & columns</small></div></button>
            <button onClick={() => framesInput.current?.click()}><span>◇</span><div><strong>Separate Frames</strong><small>Add PNG images</small></div></button>
          </div>
          <div className="list-tools">
            <button onClick={() => frames[0] && setSelectedId(frames[0].id)}>First</button>
            <button onClick={() => { if (frames.length > 1) { pushHistory(); setFrames((items) => [...items].reverse()); } }}>Reverse</button>
            <button onClick={() => { if (!selected) return; pushHistory(); const copy = { ...selected, id: uid(), name: `${selected.name} copy`, charBounds: { ...selected.charBounds } }; setFrames((items) => { const index = items.findIndex((item) => item.id === selected.id); const next = [...items]; next.splice(index + 1, 0, copy); return next; }); setSelectedId(copy.id); }}>Duplicate</button>
          </div>
          <div className="frames-list">
            {frames.map((frame, index) => (
              <button
                key={frame.id}
                className={`frame-item ${selectedId === frame.id ? "selected" : ""}`}
                draggable
                onDragStart={() => setDragId(frame.id)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => reorder(frame.id)}
                onClick={() => setSelectedId(frame.id)}
              >
                <span className="drag-handle">⠿</span>
                <span className="thumb checker"><img src={frame.src} alt="" /></span>
                <span className="frame-copy">
                  <strong>{frame.name || `Frame ${index + 1}`}</strong>
                  <small>{frame.sourceWidth} × {frame.sourceHeight} · {frame.duration} ms</small>
                  <em><i />{referenceId === frame.id ? "REFERENCE" : "READY"}</em>
                </span>
                <span
                  role="button"
                  className={referenceId === frame.id ? "star active" : "star"}
                  onClick={(event) => { event.stopPropagation(); pushHistory(); setReferenceId(frame.id); setSelectedId(frame.id); }}
                >★</span>
              </button>
            ))}
          </div>
          <div className="frames-footer">
            <span>Drag to reorder</span>
            <button onClick={() => { if (!selected) return; pushHistory(); const index = frames.indexOf(selected); const next = frames.filter((frame) => frame.id !== selected.id); setFrames(next); setSelectedId(next[Math.min(index, next.length - 1)]?.id || null); if (referenceId === selected.id) setReferenceId(next[0]?.id || null); }}>Delete frame</button>
          </div>
        </aside>

        <section className="editor-area">
          <div className="editor-toolbar">
            <div className="segmented">
              <button className={tool === "move" ? "active" : ""} onClick={() => setTool("move")}>Move</button>
              <button className={tool === "bounds" ? "active" : ""} onClick={() => setTool("bounds")}>Character Box</button>
            </div>
            <div className="view-toggles">
              <button className={showGrid ? "active" : ""} onClick={() => setShowGrid((value) => !value)}>Grid</button>
              <button className={showGround ? "active" : ""} onClick={() => setShowGround((value) => !value)}>Ground</button>
              <button className={showBounds ? "active" : ""} onClick={() => setShowBounds((value) => !value)}>Bounds</button>
            </div>
            <div className="zoom-tools">
              <button onClick={() => setZoom((value) => clamp(value - 0.1, 0.1, 4))}>−</button>
              <button onClick={() => { const rect = stageRef.current?.getBoundingClientRect(); if (rect) setZoom(clamp(Math.min((rect.width - 90) / canvasWidth, (rect.height - 90) / canvasHeight), 0.1, 2)); }}>{Math.round(zoom * 100)}%</button>
              <button onClick={() => setZoom((value) => clamp(value + 0.1, 0.1, 4))}>＋</button>
            </div>
          </div>
          <div ref={stageRef} className="canvas-stage">
            {!frames.length ? (
              <div className="empty-state">
                <div className="empty-art"><div className="mini-sheet"><i /><i /><i /><i /></div><b>✦</b></div>
                <h1>Build a clean animation</h1>
                <p>Drop a sprite sheet or separate PNG frames here.</p>
                <div><button className="primary" onClick={() => sheetInput.current?.click()}>Import Sprite Sheet</button><button onClick={() => framesInput.current?.click()}>Add Frames</button></div>
                <small>PNG · transparent or solid-color background · any frame count</small>
              </div>
            ) : (
              <div className="canvas-wrap">
                <canvas
                  ref={editorCanvas}
                  className="checker"
                  style={{ width: canvasWidth * zoom, height: canvasHeight * zoom }}
                  onPointerDown={pointerDown}
                  onPointerMove={pointerMove}
                  onPointerUp={() => { pointerDrag.current = null; }}
                  aria-label="Sprite frame editor"
                />
              </div>
            )}
          </div>
          <div className="statusbar"><span><i />{status}</span><span>Canvas {canvasWidth} × {canvasHeight}</span></div>
        </section>

        <aside className="right-panel">
          <div className="panel-heading compact">
            <div><span className="eyebrow">INSPECTOR</span><h2>{selected ? `Frame ${selectedIndex + 1}` : "No frame selected"}</h2></div>
            <button disabled={!selected} onClick={() => { if (!selected) return; pushHistory(); updateFrame(selected.id, { x: 0, y: 0, scale: 1, rotation: 0, charBounds: { ...selected.alphaBounds } }); }}>Reset</button>
          </div>
          {!selected ? <div className="inspector-empty"><b>◇</b><p>Select a frame to edit position, size and character bounds.</p></div> : (
            <>
              <InspectorSection title="Transform">
                <div className="field-grid">
                  <NumberField label="Position X" value={selected.x} onCommit={(value) => { pushHistory(); updateFrame(selected.id, { x: value }); }} />
                  <NumberField label="Position Y" value={selected.y} onCommit={(value) => { pushHistory(); updateFrame(selected.id, { y: value }); }} />
                  <NumberField label="Scale" value={selected.scale} step={0.01} onCommit={(value) => { pushHistory(); updateFrame(selected.id, { scale: clamp(value, 0.05, 10) }); }} />
                  <NumberField label="Rotation" value={selected.rotation} onCommit={(value) => { pushHistory(); updateFrame(selected.id, { rotation: value }); }} />
                </div>
                <div className="button-grid">
                  <button onClick={() => { pushHistory(); updateFrame(selected.id, centerFrame(selected)); }}>Center character</button>
                  <button onClick={() => { pushHistory(); updateFrame(selected.id, groundFrame(selected)); }}>Align to ground</button>
                </div>
              </InspectorSection>
              <InspectorSection title="Character Bounds">
                <p className="helper">The orange box measures the character. Keep fire and aura outside it.</p>
                <div className="field-grid four">
                  {(["x", "y", "w", "h"] as const).map((key) => (
                    <NumberField key={key} label={key.toUpperCase()} value={selected.charBounds[key]} onCommit={(value) => { pushHistory(); updateBounds(selected.id, { [key]: key === "w" || key === "h" ? Math.max(1, value) : value }); }} />
                  ))}
                </div>
                <div className="button-grid"><button onClick={detectBounds}>Detect from alpha</button><button onClick={() => { pushHistory(); setReferenceId(selected.id); }}>Set as reference</button></div>
                <button className="wide-action" disabled={!reference || reference.id === selected.id} onClick={() => { if (!reference) return; pushHistory(); const next = matchFrame(selected, reference); updateFrame(selected.id, next); }}>Match size + ground to reference</button>
              </InspectorSection>
              <InspectorSection title="Frame">
                <NumberField label="Duration (ms)" value={selected.duration} onCommit={(value) => { pushHistory(); updateFrame(selected.id, { duration: Math.max(10, value) }); }} />
                <div className="button-grid"><button onClick={trimSelected}>Trim transparent</button><button onClick={fitSelected}>Fit safely</button></div>
              </InspectorSection>
            </>
          )}
          <InspectorSection title="Canvas">
            <div className="field-grid">
              <NumberField label="Width" value={canvasWidth} onCommit={(value) => { pushHistory(); setCanvasWidth(clamp(value, 16, 4096)); }} />
              <NumberField label="Height" value={canvasHeight} onCommit={(value) => { pushHistory(); setCanvasHeight(clamp(value, 16, 4096)); }} />
            </div>
            <label className="range-field"><span>Ground line <output>{Math.round(groundRatio * 100)}%</output></span><input type="range" min="50" max="98" value={groundRatio * 100} onChange={(event) => { setGroundRatio(Number(event.target.value) / 100); setDirty(true); }} /></label>
            <button className="wide-action accent" onClick={normalizeAll}>Normalize all to reference</button>
          </InspectorSection>
          <InspectorSection title="Background Removal">
            <div className="color-row">
              <label>Color<input type="color" value={backgroundColor} onChange={(event) => setBackgroundColor(event.target.value)} /></label>
              <NumberField label="Tolerance" value={tolerance} onCommit={(value) => setTolerance(clamp(value, 0, 255))} />
            </div>
            <label className="range-field"><span>Edge softness <output>{softness}</output></span><input type="range" min="0" max="80" value={softness} onChange={(event) => setSoftness(Number(event.target.value))} /></label>
            <button className="wide-action" onClick={() => void removeBackground(false)}>Remove from selected</button>
            <button className="wide-action subtle" onClick={() => void removeBackground(true)}>Remove from all frames</button>
          </InspectorSection>
        </aside>
      </main>

      <footer className="timeline">
        <div className="transport"><button onClick={() => stepFrame(-1)}>{icon("previous")}</button><button className="play" onClick={() => setPlaying((value) => !value)}>{icon(playing ? "pause" : "play")}</button><button onClick={() => stepFrame(1)}>{icon("next")}</button></div>
        <div className="timeline-settings"><NumberField label="FPS" value={fps} onCommit={(value) => { pushHistory(); const next = clamp(value, 1, 60); setFps(next); setFrames((items) => items.map((frame) => ({ ...frame, duration: Math.round(1000 / next) }))); }} /><button className={loop ? "active" : ""} onClick={() => setLoop((value) => !value)}>↻ Loop</button></div>
        <div className="timeline-frames">
          {frames.map((frame, index) => <button key={frame.id} className={frame.id === selectedId ? "active" : ""} onClick={() => setSelectedId(frame.id)}><img src={frame.src} alt="" /><span>{index + 1}</span></button>)}
        </div>
        <div className="timeline-readout"><strong>{frames.length ? selectedIndex + 1 : 0} / {frames.length}</strong><span>{formatTime(totalMs)}</span></div>
      </footer>

      {sliceSource && (
        <div className="modal-backdrop">
          <div className="modal large">
            <div className="modal-header"><div><span className="eyebrow">IMPORT</span><h2>Slice Sprite Sheet</h2><p>Set the grid so every cell contains one frame.</p></div><button onClick={() => setSliceSource(null)}>×</button></div>
            <div className="slice-layout">
              <div className="slice-preview"><canvas ref={sliceCanvas} /></div>
              <div>
                <div className="field-grid">
                  {([
                    ["columns", "Columns"], ["rows", "Rows"], ["gapX", "Horizontal gap"], ["gapY", "Vertical gap"], ["marginX", "Left margin"], ["marginY", "Top margin"],
                  ] as const).map(([key, label]) => <NumberField key={key} label={label} value={slice[key]} onCommit={(value) => setSlice((current) => ({ ...current, [key]: Math.max(key === "columns" || key === "rows" ? 1 : 0, value) }))} />)}
                </div>
                <div className="slice-summary"><span>Cell size</span><strong>{Math.floor((sliceSource.image.naturalWidth - slice.marginX - slice.gapX * (slice.columns - 1)) / slice.columns)} × {Math.floor((sliceSource.image.naturalHeight - slice.marginY - slice.gapY * (slice.rows - 1)) / slice.rows)} px</strong><small>{slice.columns * slice.rows} frames</small></div>
              </div>
            </div>
            <div className="modal-footer"><button onClick={() => setSliceSource(null)}>Cancel</button><button className="primary" onClick={() => void confirmSlice()}>Create frames</button></div>
          </div>
        </div>
      )}

      {exportOpen && (
        <div className="modal-backdrop">
          <div className="modal export-modal">
            <div className="modal-header"><div><span className="eyebrow">EXPORT</span><h2>Export animation</h2><p>Create a Godot-ready sheet or individual PNG frames.</p></div><button onClick={() => setExportOpen(false)}>×</button></div>
            <div className="export-preview"><b>▦</b><div><strong>{frames.length} frames · {Math.min(exportColumns, Math.max(1, frames.length))} × {sheetRows} grid</strong><small>{canvasWidth * Math.min(exportColumns, Math.max(1, frames.length))} × {canvasHeight * sheetRows} px · transparent PNG</small></div></div>
            <div className="export-fields field-grid"><NumberField label="Sheet columns" value={exportColumns} onCommit={(value) => setExportColumns(Math.max(1, value))} /><label>File prefix<input value={exportPrefix} onChange={(event) => setExportPrefix(event.target.value)} /></label></div>
            <div className="export-actions"><button className="primary" disabled={!frames.length} onClick={() => void exportSheet()}>Export Sprite Sheet</button><button disabled={!frames.length} onClick={() => void exportFrames()}>Export Separate Frames</button></div>
          </div>
        </div>
      )}

      {toast && <div className={`toast ${toast.type || ""}`}>{toast.text}</div>}
      <input ref={sheetInput} hidden type="file" accept="image/png,image/webp" onChange={(event) => { void openSlicer(event.target.files?.[0]); event.target.value = ""; }} />
      <input ref={framesInput} hidden multiple type="file" accept="image/png,image/webp" onChange={(event) => { if (event.target.files) void importSeparate(event.target.files); event.target.value = ""; }} />
      <input ref={projectInput} hidden type="file" accept=".spriteproject,.json" onChange={openProject} />
    </div>
  );
}

function InspectorSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <section className="property-section">
      <button className="section-title" onClick={() => setOpen((value) => !value)}>
        <span>{title}</span><span>{open ? "⌃" : "⌄"}</span>
      </button>
      {open && <div className="section-body">{children}</div>}
    </section>
  );
}

function NumberField({
  label,
  value,
  step = 1,
  onCommit,
}: {
  label: string;
  value: number;
  step?: number;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(Math.round(value * 1000) / 1000));
  useEffect(() => setDraft(String(Math.round(value * 1000) / 1000)), [value]);
  return (
    <label>
      {label}
      <input
        type="number"
        step={step}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          const next = Number(draft);
          if (Number.isFinite(next) && next !== value) onCommit(next);
          else setDraft(String(value));
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
    </label>
  );
}
