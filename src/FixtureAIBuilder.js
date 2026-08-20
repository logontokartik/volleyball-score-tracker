// src/FixtureAIBuilder.js
//
// The create-tournament form's AI panel: describe the tournament in words, get back the
// FIXTURES — which teams play which.
//
// Separate from ScheduleAIBuilder, which converts an existing game list into time slots
// and courts. This one runs a step earlier and answers a question the format dropdown
// cannot: anything the three built-in rules do not express had no way to be built at all.
//
// Nothing here writes to Firestore. The fixtures are handed to the create form, previewed
// there, and only stored when Create is pressed — so a draw that came back wrong costs a
// click to discard, not a tournament to delete.
import React, { useState } from 'react';
import { useAuth } from './AuthContext';

const ENDPOINT = '/api/build-fixtures';

// The whole round trip. Working out a draw is slower than reading one off a screenshot,
// and the function itself runs against Vercel's hard timeout.
const REQUEST_TIMEOUT_MS = 290_000;

export default function FixtureAIBuilder({
  clubId,
  teams,
  courtCount,
  setsPerMatch,
  meetingsPerPair,
  pools,
  fixtures,
  warnings,
  onFixtures,
  onDiscard,
}) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const generate = async () => {
    if (!prompt.trim()) {
      setError('Describe the tournament first.');
      return;
    }
    if (teams.length < 2) {
      setError('Add at least two teams above first.');
      return;
    }
    if (!user) {
      setError('Sign in again and retry.');
      return;
    }
    setError('');
    setBusy(true);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      // The endpoint authorises on this token, not on anything in the body.
      const token = await user.getIdToken();
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        signal: controller.signal,
        body: JSON.stringify({
          clubId,
          prompt: prompt.trim(),
          teams,
          courtCount,
          setsPerMatch,
          meetingsPerPair,
          pools: pools || [],
        }),
      });

      const contentType = res.headers.get('content-type') || '';

      // A 504 comes from Vercel rather than the function, so it carries no JSON body.
      if (res.status === 504) {
        throw new Error(
          'The fixture builder timed out. Try a shorter description, or set ' +
            'ANTHROPIC_FIXTURES_EFFORT=low in the Vercel environment variables.'
        );
      }

      // Anything that is not a deployed function serves the SPA's index.html for /api/*,
      // so HTML here means the request never reached the function at all.
      if (!contentType.includes('application/json')) {
        throw new Error(
          `${ENDPOINT} returned ${res.status} ${contentType || 'no content-type'} instead of JSON — ` +
            'the function is not running here. Locally use `vercel dev`; on Vercel check that it ' +
            "is listed under the deployment's Functions."
        );
      }

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not build the fixtures.');

      onFixtures(data.fixtures || [], data.warnings || []);
    } catch (e) {
      setError(
        e.name === 'AbortError'
          ? 'The fixture builder took too long and was cancelled. Try a shorter description.'
          : e.message
      );
    } finally {
      clearTimeout(timer);
      setBusy(false);
    }
  };

  if (!open && !fixtures.length) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-sm bg-violet-100 border border-violet-300 px-3 py-2 rounded-lg min-h-[44px]"
      >
        ✨ Describe the fixtures instead
      </button>
    );
  }

  return (
    <div className="w-full rounded-xl border-2 border-violet-200 bg-violet-50/60 p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h5 className="font-bold text-gray-900">Describe the fixtures</h5>
          <p className="text-xs text-gray-600 mt-0.5">
            Say in words which teams should play which, and Claude works out the fixture list.
            Use this when none of the formats above fits. Nothing is saved until you press
            Create.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          disabled={fixtures.length > 0}
          className="text-sm text-gray-600 min-h-[44px] px-3 shrink-0 disabled:opacity-40"
          title={fixtures.length ? 'Discard the fixtures below to close this' : undefined}
        >
          Close
        </button>
      </div>

      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        rows={4}
        placeholder={
          'e.g. Every team plays every other team once, except Red and Blue who play twice ' +
          'because they share a coach. Put the two strongest teams (Black, Green) in the last game.'
        }
        className="w-full rounded-lg border border-gray-300 px-3 py-3 text-base min-h-[110px] resize-y"
      />

      <p className="text-xs text-gray-600">
        Claude is told the {teams.length} team{teams.length === 1 ? '' : 's'} above, {courtCount}{' '}
        court{courtCount === 1 ? '' : 's'}, {setsPerMatch} set{setsPerMatch === 1 ? '' : 's'} per
        match and {meetingsPerPair} meeting{meetingsPerPair === 1 ? '' : 's'} per pair
        {pools?.length ? `, and the ${pools.length}-pool draw` : ''}.
      </p>

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

      {fixtures.length > 0 && (
        <div className="rounded-lg border border-violet-300 bg-white p-3">
          <p className="text-sm font-semibold text-gray-900 mb-2">
            {fixtures.length} fixture{fixtures.length === 1 ? '' : 's'} — this is what Create will
            save
          </p>
          <ol className="text-sm text-gray-800 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0.5 max-h-64 overflow-y-auto">
            {fixtures.map((f) => (
              <li key={f.game}>
                <span className="text-gray-400 font-mono text-xs mr-1">{f.game}</span>
                {f.team1} vs {f.team2}
                {f.pool && <span className="text-gray-500"> · Pool {f.pool}</span>}
              </li>
            ))}
          </ol>
          <button
            type="button"
            onClick={() => {
              onDiscard();
              setError('');
            }}
            className="mt-3 text-sm text-red-700 border border-red-300 bg-white px-3 py-2 rounded-lg min-h-[44px]"
          >
            Discard and use the format above
          </button>
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
            Working out the fixtures…
          </>
        ) : fixtures.length ? (
          'Try again with a different description'
        ) : (
          'Generate fixtures'
        )}
      </button>
    </div>
  );
}
