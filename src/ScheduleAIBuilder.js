import React, { useRef, useState } from 'react';
import { blankSlot } from './tournamentUtils';

const ENDPOINT = '/api/build-schedule';
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** File/Blob → { mediaType, data } with base64 payload, no data-URL prefix. */
function readImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that image.'));
    reader.onload = () => {
      const result = String(reader.result || '');
      const comma = result.indexOf(',');
      if (comma < 0) {
        reject(new Error('Could not read that image.'));
        return;
      }
      resolve({
        mediaType: file.type,
        data: result.slice(comma + 1),
        preview: result,
      });
    };
    reader.readAsDataURL(file);
  });
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
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
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
      if (!contentType.includes('application/json')) {
        throw new Error(
          'The schedule builder is not running on this environment. It needs `vercel dev` locally.'
        );
      }

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not build the schedule.');

      // Server returns plain rows; give them ids so they behave like hand-made rows.
      onSlots(data.slots.map((slot) => blankSlot(slot)));
      setWarnings(data.warnings || []);
    } catch (e) {
      setError(e.message);
    } finally {
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
