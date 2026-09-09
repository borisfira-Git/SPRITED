/* Shared by the portable classic-script app and the React bundle. No network calls. */
(() => {
  "use strict";
  function plan(duration, width, height, options) {
    const { start, end, count, maxSize } = options;
    if (![duration, width, height, start, end, count, maxSize].every(Number.isFinite) ||
        duration <= 0 || width <= 0 || height <= 0 || start < 0 || end > duration || end <= start ||
        !Number.isInteger(count) || count < 1 || count > 120 || maxSize < 64 || maxSize > 1024) {
      throw new Error("Choose a valid time range, 1–120 frames, and a size from 64–1024 px.");
    }
    const ratio = Math.min(1, maxSize / Math.max(width, height));
    const w = Math.max(1, Math.round(width * ratio)), h = Math.max(1, Math.round(height * ratio));
    if (w * h * count > 32 * 1024 * 1024) throw new Error("Too many pixels. Reduce frame count or output size.");
    const step = (end - start) / count;
    return { width: w, height: h, duration: step * 1000,
      times: Array.from({ length: count }, (_, i) => start + i * step) };
  }
  function waitFor(video, event, signal, action) {
    return new Promise((resolve, reject) => {
      let timer;
      const finish = (error) => {
        clearTimeout(timer); video.removeEventListener(event, ready);
        video.removeEventListener("error", failed); signal.removeEventListener("abort", aborted);
        error ? reject(error) : resolve();
      };
      const ready = () => finish();
      const failed = () => finish(new Error("This video cannot be decoded. Try an MP4 (H.264) or WebM file."));
      const aborted = () => finish(new DOMException("Import cancelled", "AbortError"));
      if (signal.aborted) return aborted();
      video.addEventListener(event, ready, { once: true });
      video.addEventListener("error", failed, { once: true });
      signal.addEventListener("abort", aborted, { once: true });
      timer = setTimeout(() => finish(new Error("Video decoding timed out. Try a shorter clip.")), 15000);
      try { action?.(); } catch (error) { finish(error); }
    });
  }
  async function extract(video, options, signal, progress) {
    const p = plan(video.duration, video.videoWidth, video.videoHeight, options);
    const canvas = document.createElement("canvas"); canvas.width = p.width; canvas.height = p.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas is unavailable.");
    const frames = [];
    for (const time of p.times) {
      signal.throwIfAborted();
      // Seek even at t=0: loadeddata alone can precede a drawable first frame in headless Edge.
      await waitFor(video, "seeked", signal, () => { video.currentTime = time; });
      ctx.clearRect(0, 0, p.width, p.height);
      ctx.drawImage(video, 0, 0, p.width, p.height);
      frames.push({ src: canvas.toDataURL("image/png"), time, duration: p.duration });
      progress(frames.length, p.times.length);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    signal.throwIfAborted();
    return frames;
  }
  function open({ onImport }) {
    const dialog = document.createElement("dialog"); dialog.className = "video-import-dialog";
    dialog.setAttribute("aria-labelledby", "video-import-title");
    dialog.innerHTML = `<h2 id="video-import-title">Import animation video</h2>
      <p>Choose a local clip of your animated character. Frames are added to this project. No upload is needed.</p>
      <label>Video file<input name="file" type="file" accept="video/mp4,video/webm,video/quicktime"></label>
      <video controls muted playsinline style="width:100%;max-height:220px;background:#171210"></video>
      <fieldset disabled><div class="field-grid">
      <label>Start (seconds)<input name="start" type="number" min="0" step="0.01" value="0"></label>
      <label>End (seconds)<input name="end" type="number" min="0" step="0.01"></label>
      <label>Number of frames<input name="count" type="number" min="1" max="120" value="24"></label>
      <label>Maximum size (px)<input name="maxSize" type="number" min="64" max="1024" value="512"></label>
      </div></fieldset>
      <p>After import: remove a solid background with Background Removal, then align and preview before exporting. The end time is excluded for loop sampling.</p>
      <p role="status" aria-live="polite">Choose a video to begin.</p>
      <div class="button-grid"><button name="cancel">Cancel</button><button name="import" class="primary" disabled>Extract frames</button></div>`;
    const q = (s) => dialog.querySelector(s), video = q("video"), message = q('[role="status"]');
    let url, controller = new AbortController(), busy = false, closed = false;
    const close = () => {
      closed = true; controller.abort(); video.pause(); video.removeAttribute("src"); video.load();
      if (url) URL.revokeObjectURL(url); dialog.close(); dialog.remove();
    };
    dialog.addEventListener("cancel", (e) => { e.preventDefault(); close(); });
    // Do not let editor shortcuts alter the project while the modal is open.
    dialog.addEventListener("keydown", (e) => e.stopPropagation());
    q('[name="cancel"]').onclick = close;
    q('[name="file"]').onchange = async (e) => {
      controller.abort(); controller = new AbortController(); const signal = controller.signal;
      q("fieldset").disabled = true; q('[name="import"]').disabled = true;
      video.pause(); if (url) URL.revokeObjectURL(url);
      const file = e.target.files[0]; if (!file) return;
      if (file.size > 250 * 1024 * 1024) { message.textContent = "Choose a video smaller than 250 MB."; return; }
      url = URL.createObjectURL(file); message.textContent = "Reading video…";
      try {
        await waitFor(video, "loadeddata", signal, () => { video.src = url; video.load(); });
        if (!Number.isFinite(video.duration) || video.duration <= 0) throw new Error("A finite video duration is required.");
        q('[name="start"]').value = "0"; q('[name="end"]').value = String(video.duration);
        q("fieldset").disabled = false; q('[name="import"]').disabled = false;
        message.textContent = `${video.videoWidth} × ${video.videoHeight} · ${video.duration.toFixed(2)} seconds`;
      } catch (error) { if (!signal.aborted) message.textContent = error.message; }
    };
    q('[name="import"]').onclick = async () => {
      if (busy) return; busy = true; const signal = controller.signal;
      q("fieldset").disabled = true; q('[name="file"]').disabled = true; q('[name="import"]').disabled = true;
      video.pause(); video.controls = false;
      try {
        const options = Object.fromEntries(["start", "end", "count", "maxSize"].map((key) => [key, Number(q(`[name="${key}"]`).value)]));
        const frames = await extract(video, options, signal, (n, total) => { message.textContent = `Extracting ${n} / ${total}…`; });
        await onImport(frames, q('[name="file"]').files[0].name, signal);
        close();
      } catch (error) { if (!signal.aborted) message.textContent = error.message; }
      finally {
        busy = false;
        if (!closed) { q("fieldset").disabled = false; q('[name="file"]').disabled = false; q('[name="import"]').disabled = false; video.controls = true; }
      }
    };
    document.body.append(dialog); dialog.showModal();
  }
  globalThis.SpritedVideo = { plan, extract, open, waitFor };
})();
