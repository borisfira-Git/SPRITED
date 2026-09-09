"use client";

import "../public/video-import.js";

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
type AlignmentMode = "body" | "rightFoot";
type BodyGeometry = { bounds: Bounds; anchorX: number; rightFootX: number; groundY: number; confidence: number; source: string };
type Frame = {
  videoSource?: { name: string; time: number };
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
  bodyBounds?: Bounds;
  bodyAnchorX?: number;
  rightFootX?: number;
  bodyGroundY?: number;
  bodyConfidence?: number;
  bodySource?: string;
  autoX?: number;
  autoY?: number;
  manualOffsetX?: number;
  manualOffsetY?: number;
  bodyAligned?: boolean;
  alignmentMode?: AlignmentMode;
  manualBodyAnchor?: boolean;
};
type ProjectData = {
  version: 1;
  workflow?: unknown;
  projectName: string;
  frames: Frame[];
  selectedId: string | null;
  selectedIds?: string[];
  selectionAnchorId?: string | null;
  referenceId: string | null;
  canvasWidth: number;
  canvasHeight: number;
  groundRatio: number;
  alignmentMode?: AlignmentMode;
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

type WritableDirectoryHandle = FileSystemDirectoryHandle & {
  queryPermission?: (options: { mode: "readwrite" }) => Promise<PermissionState>;
  requestPermission?: (options: { mode: "readwrite" }) => Promise<PermissionState>;
};

function openSettingsDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("sprited-settings", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("settings");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function loadStoredExportDirectory() {
  if (!("indexedDB" in window)) return null;
  try {
    const database = await openSettingsDatabase();
    const directory = await new Promise<WritableDirectoryHandle | null>((resolve, reject) => {
      const request = database
        .transaction("settings")
        .objectStore("settings")
        .get("default-export-directory");
      request.onsuccess = () => resolve((request.result as WritableDirectoryHandle) || null);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return directory;
  } catch {
    return null;
  }
}

async function storeExportDirectory(directory: WritableDirectoryHandle) {
  if (!("indexedDB" in window)) return;
  try {
    const database = await openSettingsDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction("settings", "readwrite");
      transaction.objectStore("settings").put(directory, "default-export-directory");
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  } catch {}
}

async function writeDirectoryFile(
  directory: FileSystemDirectoryHandle,
  filename: string,
  blob: Blob,
) {
  const handle = await directory.getFileHandle(filename, { create: true });
  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
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

function percentile(values: number[], ratio: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * ratio;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return low === high
    ? sorted[low]
    : sorted[low] + (sorted[high] - sorted[low]) * (position - low);
}

function fullAlphaBody(frame: Frame, source = "full alpha"): BodyGeometry {
  const bounds = frame.alphaBounds;
  return {
    bounds: { ...bounds },
    anchorX: bounds.x + bounds.w / 2,
    rightFootX: bounds.x + bounds.w * 0.72,
    groundY: bounds.y + bounds.h,
    confidence: 0.1,
    source,
  };
}

function detectBodyGeometry(canvas: HTMLCanvasElement): BodyGeometry | null {
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const { width, height } = canvas;
  const labels = new Int32Array(width * height);
  const queue = new Int32Array(width * height);
  const parts: Array<{ id: number; area: number; minX: number; minY: number; maxX: number; maxY: number }> = [];
  labels.fill(-1);
  let totalAlpha = 0;
  for (let start = 0; start < width * height; start += 1) {
    if (pixels[start * 4 + 3] < 20) continue;
    totalAlpha += 1;
    if (labels[start] !== -1) continue;
    const id = parts.length;
    let head = 0;
    let tail = 0;
    let area = 0;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    queue[tail++] = start;
    labels[start] = id;
    while (head < tail) {
      const pixel = queue[head++];
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      area += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      const add = (neighbor: number) => {
        if (neighbor >= 0 && neighbor < width * height && labels[neighbor] === -1 && pixels[neighbor * 4 + 3] >= 20) {
          labels[neighbor] = id;
          queue[tail++] = neighbor;
        }
      };
      if (x > 0) {
        add(pixel - 1);
        if (y > 0) add(pixel - width - 1);
        if (y < height - 1) add(pixel + width - 1);
      }
      if (x < width - 1) {
        add(pixel + 1);
        if (y > 0) add(pixel - width + 1);
        if (y < height - 1) add(pixel + width + 1);
      }
      if (y > 0) add(pixel - width);
      if (y < height - 1) add(pixel + width);
    }
    parts.push({ id, area, minX, minY, maxX, maxY });
  }
  if (!parts.length) return null;
  const score = (part: (typeof parts)[number]) => {
    const w = part.maxX - part.minX + 1;
    const h = part.maxY - part.minY + 1;
    const fill = part.area / Math.max(1, w * h);
    return part.area * (0.55 + fill * 1.8) * (0.7 + (h / Math.max(1, height)) * 0.3);
  };
  const body = parts.reduce((best, part) => (score(part) > score(best) ? part : best), parts[0]);
  const bodyHeight = body.maxY - body.minY + 1;
  const rows: number[][] = Array.from({ length: height }, () => []);
  for (let y = body.minY; y <= body.maxY; y += 1) {
    for (let x = body.minX; x <= body.maxX; x += 1) {
      if (labels[y * width + x] === body.id) rows[y].push(x);
    }
  }
  const coreRows: Array<{ y: number; mid: number; left: number; right: number }> = [];
  for (let y = Math.round(body.minY + bodyHeight * 0.16); y <= Math.round(body.minY + bodyHeight * 0.86); y += 1) {
    const xs = rows[y];
    if (xs.length < 3) continue;
    coreRows.push({ y, mid: percentile(xs, 0.5), left: percentile(xs, 0.18), right: percentile(xs, 0.82) });
  }
  if (!coreRows.length) return null;
  const pelvis = coreRows.filter((row) => row.y >= body.minY + bodyHeight * 0.48 && row.y <= body.minY + bodyHeight * 0.78);
  const anchorRows = pelvis.length >= 4 ? pelvis : coreRows;
  const anchorX = percentile(anchorRows.map((row) => row.mid), 0.5);
  const coreWidth = Math.max(4, percentile(coreRows.map((row) => row.right - row.left + 1), 0.72));
  const halfCorridor = Math.max(3, coreWidth * 0.62);
  const lowerStart = Math.round(body.minY + bodyHeight * 0.5);
  const rowCounts: number[] = [];
  for (let y = lowerStart; y <= body.maxY; y += 1) rowCounts.push(rows[y].filter((x) => Math.abs(x - anchorX) <= halfCorridor).length);
  const threshold = Math.max(2, Math.round(Math.max(1, percentile(rowCounts, 0.85)) * 0.08));
  let ground = body.maxY;
  for (let y = body.maxY; y >= lowerStart; y -= 1) {
    if (rows[y].filter((x) => Math.abs(x - anchorX) <= halfCorridor).length < threshold) continue;
    let continuous = 0;
    for (let check = y; check >= Math.max(lowerStart, y - 5); check -= 1) {
      if (rows[check].filter((x) => Math.abs(x - anchorX) <= halfCorridor).length >= threshold) continuous += 1;
    }
    if (continuous >= 3) {
      ground = y;
      break;
    }
  }
  const footTop = Math.max(lowerStart, Math.round(ground - bodyHeight * 0.2));
  const footXs: number[] = [];
  for (let y = footTop; y <= ground; y += 1) {
    for (const x of rows[y]) {
      if (x >= anchorX - coreWidth * 0.08 && x <= anchorX + coreWidth * 0.95) footXs.push(x);
    }
  }
  const rightFootX = footXs.length >= 4 ? percentile(footXs, 0.92) : anchorX + coreWidth * 0.32;
  const top = Math.round(body.minY + bodyHeight * 0.12);
  const left = clamp(Math.round(anchorX - coreWidth * 0.64), 0, width - 1);
  const right = clamp(Math.round(anchorX + coreWidth * 0.64), left + 1, width);
  const mids = anchorRows.map((row) => row.mid);
  const mad = percentile(mids.map((value) => Math.abs(value - anchorX)), 0.5);
  const componentShare = body.area / Math.max(1, totalAlpha);
  const confidence = clamp(0.38 + Math.min(0.3, componentShare * 0.35) + Math.min(0.2, anchorRows.length / 50) - Math.min(0.25, mad / Math.max(2, coreWidth)), 0, 1);
  return {
    bounds: { x: left, y: top, w: right - left, h: Math.max(1, ground + 1 - top) },
    anchorX,
    rightFootX,
    groundY: ground + 1,
    confidence,
    source: "body core",
  };
}

function detectBodyBounds(canvas: HTMLCanvasElement): Bounds {
  return detectBodyGeometry(canvas)?.bounds || { x: 0, y: 0, w: canvas.width, h: canvas.height };
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
    bodyConfidence: 0,
    bodySource: "unmeasured",
    autoX: 0,
    autoY: 0,
    manualOffsetX: 0,
    manualOffsetY: 0,
    bodyAligned: false,
    manualBodyAnchor: false,
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

export default function Sprited() {
  const [projectName, setProjectName] = useState("Untitled Animation");
  const [frames, setFrames] = useState<Frame[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectionAnchorId, setSelectionAnchorId] = useState<string | null>(null);
  const [referenceId, setReferenceId] = useState<string | null>(null);
  const [canvasWidth, setCanvasWidth] = useState(512);
  const [canvasHeight, setCanvasHeight] = useState(512);
  const [groundRatio, setGroundRatio] = useState(0.88);
  const [alignmentMode, setAlignmentMode] = useState<AlignmentMode>("body");
  const [fps, setFps] = useState(12);
  const [loop, setLoop] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [showGrid, setShowGrid] = useState(true);
  const [showGround, setShowGround] = useState(true);
  const [showBounds, setShowBounds] = useState(true);
  const [showBodyDebug, setShowBodyDebug] = useState(false);
  const [tool, setTool] = useState<"move" | "bounds">("move");
  const [status, setStatus] = useState("Ready");
  const [dirty, setDirty] = useState(false);
  const [toast, setToast] = useState<{ text: string; type?: string } | null>(null);
  const [sliceSource, setSliceSource] = useState<{ image: HTMLImageElement; name: string } | null>(null);
  const [slice, setSlice] = useState({ columns: 2, rows: 4, gapX: 0, gapY: 0, marginX: 0, marginY: 0 });
  const [exportOpen, setExportOpen] = useState(false);
  const [exportColumns, setExportColumns] = useState(4);
  const [exportPrefix, setExportPrefix] = useState("animation");
  const [alignByBody, setAlignByBody] = useState(true);
  const [exportDirectoryName, setExportDirectoryName] = useState("Not selected — exports use Downloads");
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
  const exportDirectory = useRef<WritableDirectoryHandle | null>(null);
  // Preserve the additive desktop workflow metadata when this editor saves a project.
  const characterWorkflow = useRef<unknown>(undefined);
  const keysDown = useRef(new Set<string>());
  const scaleWheelTimer = useRef<number | null>(null);
  const scaleWheelHistoryOpen = useRef(false);
  const viewportPan = useRef<null | {
    startClientX: number;
    startClientY: number;
    scrollLeft: number;
    scrollTop: number;
  }>(null);
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

  useEffect(() => {
    void loadStoredExportDirectory().then((directory) => {
      exportDirectory.current = directory;
      if (directory) setExportDirectoryName(directory.name);
    });
  }, []);

  const snapshot = useCallback(
    (): Snapshot => ({
      version: 1,
      workflow: characterWorkflow.current,
      projectName,
      frames: frames.map((frame) => ({
        ...frame,
        charBounds: { ...frame.charBounds },
        alphaBounds: { ...frame.alphaBounds },
        bodyBounds: frame.bodyBounds ? { ...frame.bodyBounds } : undefined,
      })),
      selectedId,
      selectedIds,
      selectionAnchorId,
      referenceId,
      canvasWidth,
      canvasHeight,
      groundRatio,
      alignmentMode,
      fps,
      loop,
    }),
    [projectName, frames, selectedId, selectedIds, selectionAnchorId, referenceId, canvasWidth, canvasHeight, groundRatio, alignmentMode, fps, loop],
  );

  const restore = useCallback((data: Snapshot) => {
    characterWorkflow.current = data.workflow;
    setPlaying(false);
    setProjectName(data.projectName || "Untitled Animation");
    setFrames((data.frames || []).map((frame) => ({
      ...frame,
      manualOffsetX: Number.isFinite(frame.manualOffsetX) ? frame.manualOffsetX : 0,
      manualOffsetY: Number.isFinite(frame.manualOffsetY) ? frame.manualOffsetY : 0,
      bodyAligned: Boolean(frame.bodyAligned),
      bodyBounds: frame.bodyBounds ? { ...frame.bodyBounds } : undefined,
    })));
    setSelectedId(data.selectedId || data.frames?.[0]?.id || null);
    setSelectedIds(data.selectedIds?.length ? data.selectedIds : data.selectedId ? [data.selectedId] : []);
    setSelectionAnchorId(data.selectionAnchorId || data.selectedId || null);
    setReferenceId(data.referenceId || data.frames?.[0]?.id || null);
    setCanvasWidth(data.canvasWidth || 512);
    setCanvasHeight(data.canvasHeight || 512);
    setGroundRatio(data.groundRatio || 0.88);
    setAlignmentMode(data.alignmentMode === "rightFoot" ? "rightFoot" : "body");
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

  const renderedBodyAnchor = useCallback(
    (frame: Frame) => {
      const draw = getDrawRect(frame);
      const anchorX = Number.isFinite(frame.bodyAnchorX)
        ? frame.bodyAnchorX!
        : frame.charBounds.x + frame.charBounds.w / 2;
      const groundY = Number.isFinite(frame.bodyGroundY)
        ? frame.bodyGroundY!
        : frame.charBounds.y + frame.charBounds.h;
      return { x: draw.x + anchorX * frame.scale, y: draw.y + groundY * frame.scale };
    },
    [getDrawRect],
  );

  const renderedAlignmentAnchor = useCallback(
    (frame: Frame, mode: AlignmentMode = alignmentMode) => {
      const draw = getDrawRect(frame);
      const bodyX = Number.isFinite(frame.bodyAnchorX)
        ? frame.bodyAnchorX!
        : frame.charBounds.x + frame.charBounds.w / 2;
      const anchorX = mode === "rightFoot" && Number.isFinite(frame.rightFootX)
        ? frame.rightFootX!
        : bodyX;
      const groundY = Number.isFinite(frame.bodyGroundY)
        ? frame.bodyGroundY!
        : frame.charBounds.y + frame.charBounds.h;
      return { x: draw.x + anchorX * frame.scale, y: draw.y + groundY * frame.scale };
    },
    [alignmentMode, getDrawRect],
  );

  const renderedBodyBounds = useCallback(
    (frame: Frame) => {
      const draw = getDrawRect(frame);
      const bounds = frame.bodyBounds || frame.charBounds;
      return {
        x: draw.x + bounds.x * frame.scale,
        y: draw.y + bounds.y * frame.scale,
        w: bounds.w * frame.scale,
        h: bounds.h * frame.scale,
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
        ctx.lineWidth = 7;
        ctx.strokeStyle = "#28140d";
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvasWidth, y);
        ctx.stroke();
        ctx.lineWidth = 3;
        ctx.strokeStyle = "#78f0b1";
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvasWidth, y);
        ctx.stroke();
        ctx.fillStyle = "#28140d";
        ctx.fillRect(6, y - 23, 62, 17);
        ctx.strokeStyle = "#78f0b1";
        ctx.lineWidth = 2;
        ctx.strokeRect(6, y - 23, 62, 17);
        ctx.fillStyle = "#a8ffd0";
        ctx.font = "bold 11px system-ui";
        ctx.fillText("GROUND", 12, y - 10);
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
      if (showBodyDebug && frame) {
        const anchor = renderedBodyAnchor(frame);
        const foot = renderedAlignmentAnchor(frame, "rightFoot");
        const body = renderedBodyBounds(frame);
        ctx.setLineDash([8, 5]);
        ctx.lineWidth = 5;
        ctx.strokeStyle = "#28140d";
        ctx.beginPath();
        ctx.moveTo(anchor.x, 0);
        ctx.lineTo(anchor.x, canvasHeight);
        ctx.moveTo(0, anchor.y);
        ctx.lineTo(canvasWidth, anchor.y);
        ctx.stroke();
        ctx.lineWidth = 2;
        ctx.strokeStyle = "#63d8ff";
        ctx.beginPath();
        ctx.moveTo(anchor.x, 0);
        ctx.lineTo(anchor.x, canvasHeight);
        ctx.moveTo(0, anchor.y);
        ctx.lineTo(canvasWidth, anchor.y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.lineWidth = 5;
        ctx.strokeStyle = "#28140d";
        ctx.strokeRect(body.x, body.y, body.w, body.h);
        ctx.lineWidth = 2;
        ctx.strokeStyle = "#63d8ff";
        ctx.strokeRect(body.x, body.y, body.w, body.h);
        ctx.lineWidth = 7;
        ctx.strokeStyle = "#28140d";
        ctx.beginPath();
        ctx.arc(foot.x, foot.y, 9, 0, Math.PI * 2);
        ctx.stroke();
        ctx.lineWidth = 3;
        ctx.strokeStyle = "#ff73c7";
        ctx.beginPath();
        ctx.arc(foot.x, foot.y, 9, 0, Math.PI * 2);
        ctx.moveTo(foot.x - 13, foot.y);
        ctx.lineTo(foot.x + 13, foot.y);
        ctx.moveTo(foot.x, foot.y - 13);
        ctx.lineTo(foot.x, foot.y + 13);
        ctx.stroke();
      }
      ctx.restore();
    },
    [canvasWidth, canvasHeight, getDrawRect, groundRatio, renderedAlignmentAnchor, renderedBodyAnchor, renderedBodyBounds, renderedCharacterBounds, showBodyDebug, showBounds, showGrid, showGround],
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
      if (!typing) keysDown.current.add(event.key.toLowerCase());
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        event.shiftKey ? redo() : undo();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
        event.preventDefault();
        redo();
      } else if (!typing && event.code === "Space") {
        event.preventDefault();
        setPlaying((value) => !value);
      } else if (!typing && event.altKey && event.key === "ArrowRight") {
        event.preventDefault();
        stepFrame(1);
      } else if (!typing && event.altKey && event.key === "ArrowLeft") {
        event.preventDefault();
        stepFrame(-1);
      } else if (
        !typing &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key) &&
        selectedId
      ) {
        event.preventDefault();
        if (!event.repeat) pushHistory();
        const amount = event.shiftKey ? 10 : 1;
        const movement: Record<string, { x: number; y: number }> = {
          ArrowLeft: { x: -amount, y: 0 },
          ArrowRight: { x: amount, y: 0 },
          ArrowUp: { x: 0, y: -amount },
          ArrowDown: { x: 0, y: amount },
        };
        const delta = movement[event.key];
        const ids = new Set(selectedIds.length ? selectedIds : [selectedId]);
        setFrames((items) =>
          items.map((frame) =>
            ids.has(frame.id)
              ? {
                  ...frame,
                  x: frame.x + delta.x,
                  y: frame.y + delta.y,
                  manualOffsetX: frame.bodyAligned && Number.isFinite(frame.autoX)
                    ? frame.x + delta.x - frame.autoX!
                    : frame.x + delta.x,
                  manualOffsetY: frame.bodyAligned && Number.isFinite(frame.autoY)
                    ? frame.y + delta.y - frame.autoY!
                    : frame.y + delta.y,
                }
              : frame,
          ),
        );
        setDirty(true);
        setStatus(`Moved ${ids.size === 1 ? "frame" : `${ids.size} frames`} ${amount}px`);
      } else if (!typing && event.key === "Delete") {
        event.preventDefault();
        deleteSelection();
      }
    }
    const onKeyUp = (event: KeyboardEvent) => keysDown.current.delete(event.key.toLowerCase());
    const onBlur = () => {
      keysDown.current.clear();
      scaleWheelHistoryOpen.current = false;
      if (scaleWheelTimer.current) window.clearTimeout(scaleWheelTimer.current);
    };
    const restoreEditorFocus = () => {
      if (
        document.visibilityState !== "visible" ||
        document.querySelector(".modal-backdrop")
      ) {
        return;
      }
      requestAnimationFrame(() => editorCanvas.current?.focus({ preventScroll: true }));
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", restoreEditorFocus);
    document.addEventListener("visibilitychange", restoreEditorFocus);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", restoreEditorFocus);
      document.removeEventListener("visibilitychange", restoreEditorFocus);
    };
  });

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (event: WheelEvent) => {
      if (
        keysDown.current.has("s") &&
        !event.ctrlKey &&
        !event.metaKey &&
        frames.length &&
        selectedId
      ) {
        event.preventDefault();
        if (!scaleWheelHistoryOpen.current) {
          pushHistory();
          scaleWheelHistoryOpen.current = true;
        }
        const factor = event.deltaY < 0 ? 1.05 : 1 / 1.05;
        const ids = new Set(selectedIds.length ? selectedIds : [selectedId]);
        const activeScale = clamp(
          (frames.find((frame) => frame.id === selectedId)?.scale || 1) * factor,
          0.05,
          10,
        );
        setFrames((items) =>
          items.map((frame) => {
            if (!ids.has(frame.id)) return frame;
            const scale = clamp(frame.scale * factor, 0.05, 10);
            return { ...frame, scale };
          }),
        );
        setDirty(true);
        setStatus(`Scale ${Math.round(activeScale * 100)}%`);
        if (scaleWheelTimer.current) window.clearTimeout(scaleWheelTimer.current);
        scaleWheelTimer.current = window.setTimeout(() => {
          scaleWheelHistoryOpen.current = false;
        }, 280);
        return;
      }
      if (!event.ctrlKey || !frames.length) return;
      event.preventDefault();
      const previous = zoom;
      const next = clamp(Number((previous * (event.deltaY < 0 ? 1.1 : 1 / 1.1)).toFixed(3)), 0.1, 4);
      if (next === previous) return;
      const rect = stage.getBoundingClientRect();
      const localX = event.clientX - rect.left;
      const localY = event.clientY - rect.top;
      const contentX = stage.scrollLeft + localX;
      const contentY = stage.scrollTop + localY;
      setZoom(next);
      setStatus(`Zoom ${Math.round(next * 100)}%`);
      requestAnimationFrame(() => {
        const ratio = next / previous;
        stage.scrollLeft = contentX * ratio - localX;
        stage.scrollTop = contentY * ratio - localY;
      });
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, [frames, pushHistory, selectedId, selectedIds, zoom]);

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
    setFrames((items) => items.map((frame) => {
      if (frame.id !== id) return frame;
      const next = { ...frame, ...patch };
      if (patch.x !== undefined || patch.y !== undefined) {
        next.manualOffsetX = frame.bodyAligned && Number.isFinite(frame.autoX)
          ? next.x - frame.autoX!
          : next.x;
        next.manualOffsetY = frame.bodyAligned && Number.isFinite(frame.autoY)
          ? next.y - frame.autoY!
          : next.y;
      }
      return next;
    }));
    setDirty(true);
  }

  function updateBounds(id: string, patch: Partial<Bounds>) {
    setFrames((items) =>
      items.map((frame) =>
        frame.id === id
          ? (() => {
              const charBounds = { ...frame.charBounds, ...patch };
              return {
                ...frame,
                charBounds,
                bodyBounds: { ...charBounds },
                bodyAnchorX: charBounds.x + charBounds.w / 2,
                rightFootX: charBounds.x + charBounds.w * 0.72,
                bodyGroundY: charBounds.y + charBounds.h,
                bodyConfidence: 1,
                bodySource: "manual anchor",
                bodyAligned: false,
                alignmentMode: undefined,
                manualBodyAnchor: true,
              };
            })()
          : frame,
      ),
    );
    setDirty(true);
  }

  function importVideo() {
    setPlaying(false);
    SpritedVideo.open({ onImport: async (samples, name, signal) => {
      const created: Frame[] = [];
      try {
        for (const sample of samples) {
          signal.throwIfAborted();
          const frame = await makeFrame(sample.src, `${name.replace(/\.[^.]+$/, "")} ${String(created.length + 1).padStart(3, "0")}`, sample.duration);
          frame.videoSource = { name, time: sample.time }; created.push(frame);
        }
        signal.throwIfAborted();
        pushHistory(); if(!frames.length)setFps(1000/samples[0].duration); setFrames(items => [...items, ...created]);
        setSelectedId(created[0].id); setSelectedIds(created.map(f => f.id)); setSelectionAnchorId(created[0].id);
        setReferenceId(value => value || created[0].id); setDirty(true);
        setStatus(`${created.length} video frames imported — remove background, then align and preview.`);
        showToast(`${created.length} video frames imported`, "success");
      } catch (error) { for (const sample of samples) imageCache.delete(sample.src); throw error; }
    }});
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
    if (!selectedId && created[0]) {
      setSelectedIds([created[0].id]);
      setSelectionAnchorId(created[0].id);
    }
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
    if (!selectedId && created[0]) {
      setSelectedIds([created[0].id]);
      setSelectionAnchorId(created[0].id);
    }
    setReferenceId((value) => value || created[0]?.id || null);
    setSliceSource(null);
    setStatus("Sprite sheet sliced");
    showToast(`${created.length} frames created`, "success");
  }

  function centerFrame(frame: Frame) {
    const anchor = renderedBodyAnchor(frame);
    return { x: frame.x + canvasWidth / 2 - anchor.x };
  }

  function groundFrame(frame: Frame, target = canvasHeight * groundRatio) {
    const anchor = renderedBodyAnchor(frame);
    return { y: frame.y + target - anchor.y };
  }

  function matchFrame(frame: Frame, ref: Frame) {
    const scaled = { ...frame, scale: ref.scale };
    const centered = { ...scaled, x: scaled.x + renderedBodyAnchor(ref).x - renderedBodyAnchor(scaled).x };
    return { ...centered, y: centered.y + renderedBodyAnchor(ref).y - renderedBodyAnchor(centered).y };
  }

  function manualBodyGeometry(frame: Frame): BodyGeometry | null {
    if (!frame.manualBodyAnchor) return null;
    const bounds = frame.charBounds;
    return { bounds: { ...bounds }, anchorX: bounds.x + bounds.w / 2, rightFootX: Number.isFinite(frame.rightFootX) ? frame.rightFootX! : bounds.x + bounds.w * 0.72, groundY: bounds.y + bounds.h, confidence: 1, source: "manual anchor" };
  }

  function geometryFromReference(frame: Frame, refFrame: Frame, refGeometry: BodyGeometry): BodyGeometry {
    const bounds = frame.alphaBounds;
    const referenceBounds = refFrame.alphaBounds;
    const normalizedX = (refGeometry.anchorX - referenceBounds.x) / Math.max(1, referenceBounds.w);
    const normalizedRightFoot = (refGeometry.rightFootX - referenceBounds.x) / Math.max(1, referenceBounds.w);
    const normalizedGround = (refGeometry.groundY - referenceBounds.y) / Math.max(1, referenceBounds.h);
    const normalizedWidth = refGeometry.bounds.w / Math.max(1, referenceBounds.w);
    const normalizedTop = (refGeometry.bounds.y - referenceBounds.y) / Math.max(1, referenceBounds.h);
    const normalizedHeight = refGeometry.bounds.h / Math.max(1, referenceBounds.h);
    const bodyBounds = {
      x: clamp(bounds.x + bounds.w * (normalizedX - normalizedWidth / 2), 0, frame.sourceWidth - 1),
      y: clamp(bounds.y + bounds.h * normalizedTop, 0, frame.sourceHeight - 1),
      w: Math.max(1, Math.min(frame.sourceWidth, bounds.w * normalizedWidth)),
      h: Math.max(1, Math.min(frame.sourceHeight, bounds.h * normalizedHeight)),
    };
    return { bounds: bodyBounds, anchorX: bounds.x + bounds.w * normalizedX, rightFootX: bounds.x + bounds.w * normalizedRightFoot, groundY: bounds.y + bounds.h * normalizedGround, confidence: 0.45, source: "reference frame" };
  }

  function resolveBodyGeometry(frame: Frame, detected: BodyGeometry | null, refFrame: Frame | null, refGeometry: BodyGeometry | null, isReference: boolean) {
    const manual = manualBodyGeometry(frame);
    if (manual) return manual;
    if (detected && detected.confidence >= 0.52) return detected;
    if (!isReference && refFrame && refGeometry) return geometryFromReference(frame, refFrame, refGeometry);
    if (detected) return { ...detected, source: "trimmed alpha core" };
    return fullAlphaBody(frame);
  }

  async function prepareHeadToFeetFrames(sourceFrames = frames, options: { targetFromGuides?: boolean; mode?: AlignmentMode } = {}) {
    const mode = options.mode || alignmentMode;
    const measured: Array<{ frame: Frame; detected: BodyGeometry | null }> = [];
    for (const frame of sourceFrames) {
      const image = await loadImage(frame.src);
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      canvas.getContext("2d")!.drawImage(image, 0, 0);
      measured.push({
        frame: { ...frame, alphaBounds: { ...frame.alphaBounds }, charBounds: { ...frame.charBounds } },
        detected: detectBodyGeometry(canvas),
      });
    }
    if (!measured.length) return { frames: [] as Frame[], method: mode };
    const referenceEntry = measured.find(({ frame }) => frame.id === referenceId) || measured[0];
    const rawReference = manualBodyGeometry(referenceEntry.frame)
      || (referenceEntry.detected
        ? { ...referenceEntry.detected, source: referenceEntry.detected.confidence >= 0.52 ? "body core" : "trimmed alpha core" }
        : fullAlphaBody(referenceEntry.frame));
    const resolved = measured.map((entry) => ({
      frame: entry.frame,
      geometry: resolveBodyGeometry(entry.frame, entry.detected, referenceEntry.frame, rawReference, entry === referenceEntry),
    }));
    const referenceResult = resolved.find(({ frame }) => frame.id === referenceEntry.frame.id) || resolved[0];
    const requestedHeight = canvasHeight * 0.72;
    const requestedScale = referenceResult.frame.bodyAligned && Number.isFinite(referenceResult.frame.scale)
      ? referenceResult.frame.scale
      : requestedHeight / Math.max(1, referenceResult.geometry.bounds.h);
    const safeScale = Math.min(
      ...resolved.map(({ frame }) =>
        Math.min(
          (canvasWidth * 0.9) / Math.max(1, frame.alphaBounds.w),
          (canvasHeight * 0.9) / Math.max(1, frame.alphaBounds.h),
        ),
      ),
    );
    const sharedScale = clamp(Math.min(requestedScale, safeScale), 0.05, 10);
    let targetAxis = canvasWidth / 2;
    let targetGround = canvasHeight * groundRatio;
    const referenceAnchorX = mode === "rightFoot" ? referenceResult.geometry.rightFootX : referenceResult.geometry.anchorX;
    if (!options.targetFromGuides && referenceResult.frame.bodyAligned && referenceResult.frame.alignmentMode === mode && Number.isFinite(referenceResult.frame.autoX) && Number.isFinite(referenceResult.frame.autoY)) {
      targetAxis = canvasWidth / 2 - (referenceResult.frame.sourceWidth * sharedScale) / 2 + referenceResult.frame.autoX! + referenceAnchorX * sharedScale;
      targetGround = canvasHeight / 2 - (referenceResult.frame.sourceHeight * sharedScale) / 2 + referenceResult.frame.autoY! + referenceResult.geometry.groundY * sharedScale;
    } else if (!options.targetFromGuides && mode === "rightFoot") {
      const baseX = referenceResult.frame.bodyAligned && Number.isFinite(referenceResult.frame.autoX) ? referenceResult.frame.autoX! : referenceResult.frame.x;
      const baseY = referenceResult.frame.bodyAligned && Number.isFinite(referenceResult.frame.autoY) ? referenceResult.frame.autoY! : referenceResult.frame.y;
      targetAxis = canvasWidth / 2 - (referenceResult.frame.sourceWidth * sharedScale) / 2 + baseX + referenceAnchorX * sharedScale;
      targetGround = canvasHeight / 2 - (referenceResult.frame.sourceHeight * sharedScale) / 2 + baseY + referenceResult.geometry.groundY * sharedScale;
    }
    const normalized = resolved.map(({ frame, geometry }) => {
      const manualOffsetX = Number.isFinite(frame.manualOffsetX) ? frame.manualOffsetX! : 0;
      const manualOffsetY = Number.isFinite(frame.manualOffsetY) ? frame.manualOffsetY! : 0;
      const measuredFrame: Frame = {
        ...frame,
        scale: sharedScale,
        x: 0,
        y: 0,
        charBounds: { ...geometry.bounds },
        bodyBounds: { ...geometry.bounds },
        bodyAnchorX: geometry.anchorX,
        rightFootX: geometry.rightFootX,
        bodyGroundY: geometry.groundY,
        bodyConfidence: geometry.confidence,
        bodySource: geometry.source,
      };
      const autoX = measuredFrame.x + targetAxis - renderedAlignmentAnchor(measuredFrame, mode).x;
      const groundedFrame = { ...measuredFrame, x: autoX };
      const autoY = groundedFrame.y + targetGround - renderedBodyAnchor(groundedFrame).y;
      return { ...measuredFrame, autoX, autoY, manualOffsetX, manualOffsetY, x: autoX + manualOffsetX, y: autoY + manualOffsetY, bodyAligned: true, alignmentMode: mode };
    });
    return { frames: normalized, method: mode, referenceId: referenceResult.frame.id };
  }

  async function normalizeAll(mode: AlignmentMode = alignmentMode) {
    if (!frames.length) return;
    pushHistory();
    setAlignmentMode(mode);
    setStatus(mode === "rightFoot" ? "Detecting the right foot in every frame…" : "Detecting body anchors in every frame…");
    const result = await prepareHeadToFeetFrames(frames, { mode });
    setFrames(result.frames);
    setStatus(mode === "rightFoot" ? "Frames aligned by right foot" : "Frames aligned by body");
    showToast(mode === "rightFoot" ? `Aligned ${result.frames.length} frames to the reference right foot` : `Aligned ${result.frames.length} frames to the reference body`, "success");
  }

  async function detectBounds() {
    if (!selected) return;
    pushHistory();
    const bounds = await alphaBounds(selected.src);
    const clean = { x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h };
    updateFrame(selected.id, { charBounds: clean, alphaBounds: clean, bodyBounds: undefined, bodyAnchorX: undefined, rightFootX: undefined, bodyGroundY: undefined, bodyAligned: false, alignmentMode: undefined, manualBodyAnchor: false });
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
      bodyBounds: undefined,
      bodyAnchorX: undefined,
      rightFootX: undefined,
      bodyGroundY: undefined,
      bodyAligned: false,
      alignmentMode: undefined,
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
      replacements.set(frame.id, { ...frame, src, alphaBounds: clean, charBounds: clean, bodyBounds: undefined, bodyAnchorX: undefined, rightFootX: undefined, bodyGroundY: undefined, bodyAligned: false, alignmentMode: undefined, manualBodyAnchor: false });
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
      bodyAligned: false,
      alignmentMode: undefined,
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

  function metadata(columns: number, exportFrames = frames) {
    return {
      animation: safePrefix(),
      fps,
      loop,
      frame_width: canvasWidth,
      frame_height: canvasHeight,
      frames: exportFrames.length,
      horizontal_frames: Math.min(columns, exportFrames.length),
      vertical_frames: Math.ceil(exportFrames.length / columns),
      durations_ms: exportFrames.map((frame) => frame.duration),
      reference_frame: Math.max(0, exportFrames.findIndex((frame) => frame.id === referenceId)),
      alignment: alignByBody ? alignmentMode : "manual",
      alignment_mode: alignmentMode,
      body_alignment: exportFrames.map((frame) => ({
        body_anchor_x: frame.bodyAnchorX ?? null,
        right_foot_x: frame.rightFootX ?? null,
        ground_y: frame.bodyGroundY ?? null,
        manual_offset_x: frame.manualOffsetX || 0,
        manual_offset_y: frame.manualOffsetY || 0,
      })),
    };
  }

  async function framesForExport() {
    if (!alignByBody) return frames;
    if (frames.every((frame) => frame.bodyAligned && frame.alignmentMode === alignmentMode && Number.isFinite(frame.bodyAnchorX) && Number.isFinite(frame.rightFootX) && Number.isFinite(frame.bodyGroundY))) return frames;
    return (await prepareHeadToFeetFrames(frames, { mode: alignmentMode })).frames;
  }

  async function chooseExportDirectory() {
    const picker = (window as Window & {
      showDirectoryPicker?: (options: { mode: "readwrite" }) => Promise<WritableDirectoryHandle>;
    }).showDirectoryPicker;
    if (!picker) {
      setExportDirectoryName("Folder selection is not supported on this system");
      showToast("Folder selection is not supported on this system", "error");
      return null;
    }
    try {
      const directory = await picker({ mode: "readwrite" });
      exportDirectory.current = directory;
      setExportDirectoryName(directory.name);
      await storeExportDirectory(directory);
      showToast(`Default export folder: ${directory.name}`, "success");
      return directory;
    } catch {
      return null;
    }
  }

  async function writableExportDirectory() {
    const directory = exportDirectory.current;
    if (!directory) return null;
    try {
      if (!directory.queryPermission || (await directory.queryPermission({ mode: "readwrite" })) === "granted") {
        return directory;
      }
      if (directory.requestPermission && (await directory.requestPermission({ mode: "readwrite" })) === "granted") {
        return directory;
      }
    } catch {}
    showToast("Please choose the export folder again", "error");
    return null;
  }

  async function exportSheet() {
    if (!frames.length) return;
    const framesToExport = await framesForExport();
    const columns = clamp(exportColumns || 1, 1, frames.length);
    const rows = Math.ceil(frames.length / columns);
    const canvas = document.createElement("canvas");
    canvas.width = canvasWidth * columns;
    canvas.height = canvasHeight * rows;
    const ctx = canvas.getContext("2d")!;
    setStatus("Rendering sprite sheet…");
    for (let index = 0; index < framesToExport.length; index += 1) {
      const cell = await frameCanvas(framesToExport[index]);
      ctx.drawImage(
        cell,
        (index % columns) * canvasWidth,
        Math.floor(index / columns) * canvasHeight,
      );
    }
    const sheetBlob = await canvasToBlob(canvas);
    const sheetName = `${safePrefix()}_${columns}x${rows}.png`;
    const jsonBlob = new Blob([JSON.stringify(metadata(columns, framesToExport), null, 2)], {
      type: "application/json",
    });
    const jsonName = `${safePrefix()}.json`;
    const directory = await writableExportDirectory();
    if (directory) {
      await writeDirectoryFile(directory, sheetName, sheetBlob);
      await writeDirectoryFile(directory, jsonName, jsonBlob);
    } else {
      downloadBlob(sheetBlob, sheetName);
      downloadBlob(jsonBlob, jsonName);
    }
    setExportOpen(false);
    setStatus("Sprite sheet exported");
    showToast(`Exported ${canvas.width} × ${canvas.height} sprite sheet`, "success");
  }

  async function exportFrames() {
    if (!frames.length) return;
    const framesToExport = await framesForExport();
    const pickerSupported = Boolean((window as Window & { showDirectoryPicker?: unknown }).showDirectoryPicker);
    let directory = await writableExportDirectory();
    if (!directory && pickerSupported) directory = await chooseExportDirectory();
    if (pickerSupported && !directory) return;
    for (let index = 0; index < framesToExport.length; index += 1) {
      const blob = await canvasToBlob(await frameCanvas(framesToExport[index]));
      const filename = `${safePrefix()}_${String(index + 1).padStart(3, "0")}.png`;
      if (directory) {
        await writeDirectoryFile(directory, filename, blob);
      } else {
        downloadBlob(blob, filename);
        await new Promise((resolve) => setTimeout(resolve, 80));
      }
    }
    const json = new Blob([JSON.stringify(metadata(exportColumns, framesToExport), null, 2)], {
      type: "application/json",
    });
    if (directory) {
      await writeDirectoryFile(directory, `${safePrefix()}.json`, json);
    } else downloadBlob(json, `${safePrefix()}.json`);
    setExportOpen(false);
    showToast(`${framesToExport.length} frames exported`, "success");
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
    characterWorkflow.current = undefined;
    setFrames([]);
    setSelectedId(null);
    setSelectedIds([]);
    setSelectionAnchorId(null);
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

  function deleteSelection() {
    const ids = selectedIds.length
      ? selectedIds
      : selectedId
        ? [selectedId]
        : [];
    if (!ids.length) return;
    pushHistory();
    const selectedSet = new Set(ids);
    const firstIndex = Math.max(
      0,
      frames.findIndex((frame) => selectedSet.has(frame.id)),
    );
    const remaining = frames.filter((frame) => !selectedSet.has(frame.id));
    const next = remaining[Math.min(firstIndex, remaining.length - 1)] || null;
    setFrames(remaining);
    if (referenceId && selectedSet.has(referenceId)) {
      setReferenceId(remaining[0]?.id || null);
    }
    setSelectedId(next?.id || null);
    setSelectedIds(next ? [next.id] : []);
    setSelectionAnchorId(next?.id || null);
    showToast(`${ids.length} frame${ids.length === 1 ? "" : "s"} deleted`, "success");
  }

  function canvasPoint(event: ReactPointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvasWidth,
      y: ((event.clientY - rect.top) / rect.height) * canvasHeight,
    };
  }

  function pointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    event.currentTarget.focus({ preventScroll: true });
    if (event.button === 1) {
      event.preventDefault();
      const stage = stageRef.current;
      if (!stage) return;
      viewportPan.current = {
        startClientX: event.clientX,
        startClientY: event.clientY,
        scrollLeft: stage.scrollLeft,
        scrollTop: stage.scrollTop,
      };
      stage.classList.add("panning");
      event.currentTarget.setPointerCapture(event.pointerId);
      setStatus("Panning view");
      return;
    }
    if (event.button !== 0) return;
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
    if (viewportPan.current) {
      const stage = stageRef.current;
      if (!stage) return;
      stage.scrollLeft =
        viewportPan.current.scrollLeft - (event.clientX - viewportPan.current.startClientX);
      stage.scrollTop =
        viewportPan.current.scrollTop - (event.clientY - viewportPan.current.startClientY);
      return;
    }
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

  function pointerEnd() {
    if (viewportPan.current) setStatus("View moved");
    viewportPan.current = null;
    pointerDrag.current = null;
    stageRef.current?.classList.remove("panning");
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
          <div className="brand-copy"><strong>SPRITED</strong><small>Sprite Sheet Studio</small></div>
          <span className="version-badge">VER.0.7.0</span>
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
            <button onClick={importVideo}><span>▷</span><div><strong>Animation Video</strong><small>Extract frames from a local clip</small></div></button>
          </div>
          <div className="list-tools">
            <button onClick={() => { if (frames[0]) { setSelectedId(frames[0].id); setSelectedIds([frames[0].id]); setSelectionAnchorId(frames[0].id); } }}>First</button>
            <button onClick={() => { if (frames.length > 1) { pushHistory(); setFrames((items) => [...items].reverse()); } }}>Reverse</button>
            <button onClick={() => { if (!selected) return; pushHistory(); const copy = { ...selected, id: uid(), name: `${selected.name} copy`, charBounds: { ...selected.charBounds }, alphaBounds: { ...selected.alphaBounds }, bodyBounds: selected.bodyBounds ? { ...selected.bodyBounds } : undefined }; setFrames((items) => { const index = items.findIndex((item) => item.id === selected.id); const next = [...items]; next.splice(index + 1, 0, copy); return next; }); setSelectedId(copy.id); }}>Duplicate</button>
          </div>
          <div className="frames-list">
            {frames.map((frame, index) => (
              <button
                key={frame.id}
                className={`frame-item ${selectedIds.includes(frame.id) ? "selected" : ""} ${selectedId === frame.id ? "active-frame" : ""}`}
                draggable
                onDragStart={() => setDragId(frame.id)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => reorder(frame.id)}
                onClick={(event) => {
                  if (event.shiftKey) {
                    const anchorId = selectionAnchorId || selectedId || frame.id;
                    const anchorIndex = Math.max(0, frames.findIndex((item) => item.id === anchorId));
                    const clickedIndex = frames.findIndex((item) => item.id === frame.id);
                    const start = Math.min(anchorIndex, clickedIndex);
                    const end = Math.max(anchorIndex, clickedIndex);
                    setSelectedIds(frames.slice(start, end + 1).map((item) => item.id));
                    setSelectedId(frame.id);
                  } else if (event.ctrlKey || event.metaKey) {
                    const next = selectedIds.includes(frame.id)
                      ? selectedIds.filter((id) => id !== frame.id)
                      : [...selectedIds, frame.id];
                    setSelectedIds(next);
                    setSelectedId(next.includes(frame.id) ? frame.id : next[next.length - 1] || null);
                    setSelectionAnchorId(frame.id);
                  } else {
                    setSelectedId(frame.id);
                    setSelectedIds([frame.id]);
                    setSelectionAnchorId(frame.id);
                  }
                }}
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
                  onClick={(event) => { event.stopPropagation(); pushHistory(); setReferenceId(frame.id); setSelectedId(frame.id); setSelectedIds([frame.id]); setSelectionAnchorId(frame.id); }}
                >★</span>
              </button>
            ))}
          </div>
          <div className="frames-footer">
            <span>Drag to reorder</span>
            <button onClick={deleteSelection}>{selectedIds.length > 1 ? `Delete ${selectedIds.length} frames` : "Delete frame"}</button>
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
              <button className={showBodyDebug ? "active" : ""} onClick={() => setShowBodyDebug((value) => !value)}>Body Debug</button>
            </div>
            <div className="zoom-tools">
              <button onClick={() => setZoom((value) => clamp(value - 0.1, 0.1, 4))}>−</button>
              <button onClick={() => { const rect = stageRef.current?.getBoundingClientRect(); if (rect) setZoom(clamp(Math.min((rect.width - 90) / canvasWidth, (rect.height - 90) / canvasHeight), 0.1, 2)); }}>{Math.round(zoom * 100)}%</button>
              <button onClick={() => setZoom((value) => clamp(value + 0.1, 0.1, 4))}>＋</button>
            </div>
          </div>
          <div ref={stageRef} className="canvas-stage" title="Middle mouse drag: pan view · Ctrl + wheel: zoom · S + wheel: scale sprite · Arrows: move">
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
                  onPointerUp={pointerEnd}
                  onPointerCancel={pointerEnd}
                  onAuxClick={(event) => { if (event.button === 1) event.preventDefault(); }}
                  tabIndex={0}
                  aria-label="Sprite frame editor"
                />
              </div>
            )}
          </div>
          <div className="statusbar"><span><i />{status}</span><span>Canvas {canvasWidth} × {canvasHeight}</span></div>
        </section>

        <aside className="right-panel">
          <div className="panel-heading compact">
            <div><span className="eyebrow">INSPECTOR</span><h2>{selected ? `Frame ${selectedIndex + 1}${selectedIds.length > 1 ? ` · ${selectedIds.length} selected` : ""}` : "No frame selected"}</h2></div>
            <button disabled={!selected} onClick={() => { if (!selected) return; pushHistory(); updateFrame(selected.id, { x: 0, y: 0, scale: 1, rotation: 0, charBounds: { ...selected.alphaBounds }, bodyBounds: undefined, bodyAnchorX: undefined, rightFootX: undefined, bodyGroundY: undefined, autoX: 0, autoY: 0, manualOffsetX: 0, manualOffsetY: 0, bodyAligned: false, alignmentMode: undefined, manualBodyAnchor: false }); }}>Reset</button>
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
                <p className="helper">Hold S and use the mouse wheel to enlarge or reduce the sprite. Drag with the middle mouse button to move the view without moving the sprite.</p>
                <div className="button-grid">
                  <button onClick={() => { pushHistory(); updateFrame(selected.id, centerFrame(selected)); }}>Center character</button>
                  <button onClick={() => { pushHistory(); updateFrame(selected.id, groundFrame(selected)); }}>Align to ground</button>
                </div>
              </InspectorSection>
              <InspectorSection title="Character Bounds">
                <p className="helper">The orange box measures the character. Keep fire and aura outside it.</p>
                <p className="helper">{Number.isFinite(selected.bodyAnchorX) ? `Body anchor X ${Math.round(selected.bodyAnchorX!)} · Right foot X ${Math.round(selected.rightFootX ?? selected.bodyAnchorX!)} · Ground Y ${Math.round(selected.bodyGroundY!)} · ${Math.round((selected.bodyConfidence || 0) * 100)}% · ${selected.bodySource || "body"}` : "Body anchor has not been measured."}</p>
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
            <label>Alignment point<select value={alignmentMode} onChange={(event) => { pushHistory(); setAlignmentMode(event.target.value === "rightFoot" ? "rightFoot" : "body"); }}><option value="body">Body center</option><option value="rightFoot">Right foot end</option></select></label>
            <button className="wide-action accent" onClick={() => void normalizeAll("body")}>Align All Frames to Body</button>
            <button className="wide-action accent" onClick={() => void normalizeAll("rightFoot")}>Align All Frames to Right Foot</button>
            <p className="helper">Body keeps the pelvis axis fixed. Right Foot keeps the end of the character&apos;s right foot fixed on both X and the ground line. One shared Scale is used for the whole animation.</p>
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
          {frames.map((frame, index) => <button key={frame.id} className={frame.id === selectedId ? "active" : ""} onClick={() => { setSelectedId(frame.id); setSelectedIds([frame.id]); setSelectionAnchorId(frame.id); }}><img src={frame.src} alt="" /><span>{index + 1}</span></button>)}
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
            <label className="export-option"><input type="checkbox" checked={alignByBody} onChange={(event) => setAlignByBody(event.target.checked)} /><span><strong>Align by Body</strong><small>Uses the selected Body or Right Foot alignment stored in the editor and preserves every manual X/Y correction during export.</small></span></label>
            <div className="export-folder"><div><strong>Default export folder</strong><small>{exportDirectoryName}</small></div><button onClick={() => void chooseExportDirectory()}>Choose folder</button></div>
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
