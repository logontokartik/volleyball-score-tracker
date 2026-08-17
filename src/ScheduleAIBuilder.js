import React, { useRef, useState } from 'react';
import { blankSlot } from './tournamentUtils';

const ENDPOINT = '/api/build-schedule';
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

// Long edge to downscale to before upload. A full-resolution screenshot costs several
// times the vision tokens — and therefore the latency — of one this size, and the
// function runs against a hard timeout. A schedule table stays legible at this width.
const MAX_IMAGE_EDGE = 1568;

// The whole round trip: reading the image, the model call, and the response.
const REQUEST_TIMEOUT_MS = 290_000;

const readAsDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that image.'));
    reader.onload = () => resolve(String(reader.result || ''));
    reader.readAsDataURL(file);
  });

const splitDataUrl = (dataUrl) => {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) throw new Error('Could not read that image.');
  const mediaType = dataUrl.slice(5, dataUrl.indexOf(';'));
  return { mediaType, data: dataUrl.slice(comma + 1), preview: dataUrl };
};

/**
 * File/Blob → { mediaType, data, preview }, downscaled when oversized.
 *
 * Falls back to the original bytes if anything about the canvas path fails, so an
 * unusual image format costs accuracy at worst rather than blocking the feature.
 */
async function readImage(file) {
  const original = splitDataUrl(await readAsDataUrl(file));

  try {
    const bitmap = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('decode failed'));
      img.src = original.preview;
    });

    const longEdge = Math.max(bitmap.width, bitmap.height);
    if (longEdge <= MAX_IMAGE_EDGE) return original;

    const scale = MAX_IMAGE_EDGE / longEdge;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    // JPEG at high quality: a screenshot this size stays readable and the payload is a
    // fraction of the equivalent PNG.
    const resized = canvas.toDataURL('image/jpeg', 0.92);
    return splitDataUrl(resized);
  } catch {
    return original;
  }
}

export default function ScheduleAIBuilder({ tournament, scores, onSlots }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [image, setImage] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [warnings, setWarnings] = useState([]);
  const fileRef = useRef(null);

  const acceptFile = async (file) => {
    setError('');
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('That file is not an image.');
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError('That image is too large — keep it under 5 MB.');
      return;
    }
    try {
      setImage(await readImage(file));
    } catch (e) {
      setError(e.message);
    }
  };

  const handlePaste = (e) => {
    const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
    if (!item) return;
    e.preventDefault();
    acceptFile(item.getAsFile());
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const file = [...(e.dataTransfer?.files || [])][0];
    if (file) acceptFile(file);
  };

  const generate = async () => {
    if (!text.trim() && !image) {
      setError('Paste a screenshot or describe the schedule first.');
      return;
    }
    setError('');
    setWarnings([]);
    setBusy(true);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          text: text.trim(),
          image: image ? { mediaType: image.mediaType, data: image.data } : null,
          teams: tournament.teams || [],
          games: (scores || []).map((m) => ({
            game: m.game,
            team1: m.team1,
            team2: m.team2,
          })),
        }),
      });

      const contentType = res.headers.get('content-type') || '';

      // A 504 comes from Vercel, not the function, so it has no JSON body to read.
      if (res.status === 504) {
        throw new Error(
          'The schedule builder timed out. Try a tighter screenshot of just the schedule table, ' +
            'or type the rows instead. If it keeps happening, set ANTHROPIC_SCHEDULE_EFFORT=low ' +
            'or ANTHROPIC_MODEL=claude-sonnet-5 in the Vercel environment variables.'
        );
      }

      // Anything that isn't a deployed function serves the SPA's index.html for /api/*,
      // so HTML here means the request never reached the function.
      if (!contentType.includes('application/json')) {
        throw new Error(
          `${ENDPOINT} returned ${res.status} ${contentType || 'no content-type'} instead of JSON — ` +
            'the function is not running here. Locally use `vercel dev`; on Vercel check that it ' +
            "is listed under the deployment's Functions."
        );
      }

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not build the schedule.');

      // Server returns plain rows; give them ids so they behave like hand-made rows.
      onSlots(data.slots.map((slot) => blankSlot(slot)));
      setWarnings(data.warnings || []);
    } catch (e) {
      setError(
        e.name === 'AbortError'
          ? 'The schedule builder took too long and was cancelled. Try a tighter screenshot, or type the rows instead.'
          : e.message
      );
    } finally {
      clearTimeout(timer);
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-sm bg-violet-100 border border-violet-300 px-3 py-2 rounded-lg min-h-[44px]"
      >
        ✨ Build with AI
      </button>
    );
  }

  return (
    <div className="w-full rounded-xl border-2 border-violet-200 bg-violet-50/60 p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h5 className="font-bold text-gray-900">Build the schedule with AI</h5>
          <p className="text-xs text-gray-600 mt-0.5">
            Paste a screenshot of the schedule, or describe it, and Claude will fill in the rows
            below. Nothing is saved until you press Save schedule.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-sm text-gray-600 min-h-[44px] px-3 shrink-0"
        >
          Close
        </button>
      </div>

      <div
        onPaste={handlePaste}
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        className="rounded-lg border-2 border-dashed border-violet-300 bg-white p-3"
      >
        {image ? (
          <div className="flex items-start gap-3">
            <img
              src={image.preview}
              alt="Schedule to convert"
              className="max-h-40 w-auto rounded border border-gray-200"
            />
            <button
              type="button"
              onClick={() => setImage(null)}
              className="text-sm text-red-600 min-h-[44px] px-2"
            >
              Remove
            </button>
          </div>
        ) : (
          <div className="text-center py-2">
            <p className="text-sm text-gray-600">
              Paste a screenshot here (⌘V / Ctrl+V), or drop an image
            </p>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="mt-2 text-sm text-violet-700 underline min-h-[44px] px-2"
            >
              choose a file
            </button>
          </div>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          className="hidden"
          onChange={(e) => acceptFile(e.target.files?.[0])}
        />
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onPaste={handlePaste}
        rows={4}
        placeholder={
          'Or type it, e.g.\n8am — Court 1: Black v Yellow (umpire Green) | Court 2: Blue v White (umpire Red)\n9am — Court 1: Green v White (umpire Yellow) | Court 2: Black v Red (umpire Blue)'
        }
        className="w-full rounded-lg border border-gray-300 px-3 py-3 text-base min-h-[110px] resize-y"
      />

      {error && <p className="text-sm text-red-600">{error}</p>}

      {warnings.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
          <p className="text-xs font-bold uppercase tracking-wide text-amber-800 mb-1">
            Check these
          </p>
          <ul className="text-sm text-amber-900 list-disc list-inside space-y-0.5">
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      <button
        type="button"
        onClick={generate}
        disabled={busy}
        className="w-full bg-violet-600 text-white px-4 py-3 rounded-lg font-semibold disabled:opacity-50 min-h-[48px] flex items-center justify-center gap-2"
      >
        {busy ? (
          <>
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 100 16v-4l-3 3 3 3v-4a8 8 0 01-8-8z" />
            </svg>
            Reading the schedule…
          </>
        ) : (
          'Generate schedule rows'
        )}
      </button>
    </div>
  );
}
