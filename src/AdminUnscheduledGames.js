import React, { useMemo, useState } from 'react';
import { setDoc } from 'firebase/firestore';
import { tournamentDoc } from './clubPaths';
import { useClub } from './ClubContext';
import { unscheduledMatches } from './tournamentUtils';

/**
 * Games in the match list that sit on no schedule row.
 *
 * These surface on the public Scores tab as tiles for games nobody is playing — the
 * appended tail of `orderScoresBySchedule`. They appear when the match list and the
 * schedule fall out of step: switching a tournament from a nine-game format to a
 * fifteen-game round robin grows the match list, while the schedule keeps the rows it
 * had. Deleting a schedule row does the same thing from the other direction.
 *
 * Removal writes `scores` on its own, immediately, and never touches `scheduleSlots`.
 * That is deliberate: this panel lives inside the schedule editor, which holds a whole
 * grid of unsaved row edits in local state. Bundling the removal into that pending save
 * would either discard those edits or make this one look like it had not persisted.
 * Nothing being removed is referenced by a row, so the rows stay valid either way.
 */
export default function AdminUnscheduledGames({ tournament, slots }) {
  const { clubId, isClubAdmin } = useClub();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);

  const scores = useMemo(() => tournament?.scores || [], [tournament?.scores]);
  // Read against the rows as they are SAVED, not the unsaved grid: offering to delete a
  // game because it was just dragged off a row that has not been saved yet would be a
  // trap, and re-adding it would be impossible once the game is gone.
  const { removable, played } = useMemo(
    () => unscheduledMatches(scores, tournament?.scheduleSlots || slots),
    [scores, tournament?.scheduleSlots, slots]
  );

  if (!removable.length && !played.length) return null;

  const remove = async () => {
    if (!isClubAdmin) {
      setError('Only a club admin can remove games.');
      return;
    }
    setError('');
    setBusy(true);
    try {
      const doomed = new Set(removable.map((m) => m.game));
      // Filtered from the stored list rather than from anything this component holds,
      // so a score entered while this panel was open cannot be written back over.
      const next = (tournament?.scores || []).filter((m) => !doomed.has(m.game));
      await setDoc(tournamentDoc(clubId, tournament.id), { scores: next }, { merge: true });
      setConfirming(false);
    } catch (e) {
      setError(e?.message || 'Could not remove those games.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-4 rounded-xl border-2 border-amber-300 bg-amber-50/70 p-3">
      <h4 className="text-sm font-bold text-amber-900">
        {removable.length + played.length} game
        {removable.length + played.length === 1 ? '' : 's'} not on the schedule
      </h4>
      <p className="mt-1 text-xs text-amber-900">
        These are in the match list but sit on no row, so they show up on the Scores tab as
        games nobody is playing.
      </p>

      {removable.length > 0 && (
        <>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {removable.map((m) => (
              <li
                key={m.game}
                className="rounded-lg border border-amber-300 bg-white px-2 py-1 text-[11px] text-gray-700"
              >
                <span className="font-semibold text-gray-500">{m.game}</span> {m.team1} v{' '}
                {m.team2}
              </li>
            ))}
          </ul>

          {confirming ? (
            <div className="mt-3 rounded-lg border border-red-300 bg-white p-3">
              <p className="text-xs text-gray-800">
                Remove {removable.length} unplayed game{removable.length === 1 ? '' : 's'} from
                this tournament? Scores already entered are not affected, and this does not
                change the schedule rows.
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={remove}
                  disabled={busy}
                  className="min-h-[44px] flex-1 rounded-lg bg-red-600 px-3 text-xs font-bold text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {busy ? 'Removing…' : `Yes, remove ${removable.length}`}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  className="min-h-[44px] flex-1 rounded-lg border border-gray-300 bg-white px-3 text-xs font-semibold text-gray-700"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              disabled={!isClubAdmin}
              className="mt-3 min-h-[44px] w-full rounded-lg border border-amber-400 bg-white px-3 text-xs font-bold text-amber-900 hover:bg-amber-100 disabled:opacity-50"
            >
              Remove {removable.length} unplayed game{removable.length === 1 ? '' : 's'}
            </button>
          )}
        </>
      )}

      {/* Never offered for removal, and said out loud rather than silently skipped —
          otherwise the count in the heading would not match the button and it would look
          like a bug. */}
      {played.length > 0 && (
        <p className="mt-3 rounded-lg border border-gray-300 bg-white px-2 py-2 text-[11px] text-gray-700">
          <strong>{played.length}</strong> of them{' '}
          {played.length === 1 ? 'has a result' : 'have results'} and{' '}
          {played.length === 1 ? 'is' : 'are'} left alone:{' '}
          {played.map((m) => `${m.game} ${m.team1} v ${m.team2}`).join(', ')}. Put{' '}
          {played.length === 1 ? 'it' : 'them'} on a row below, or remove{' '}
          {played.length === 1 ? 'it' : 'them'} under{' '}
          <strong>Teams &amp; format</strong>, which knows what a lost result costs.
        </p>
      )}

      {/* The removal is not permanent in the way people assume, and finding that out by
          surprise a week later is worse than a sentence here. AdminTeamsEditor rebuilds
          the whole match list from the schedule format on every save, so a format that
          still generates these pairings will generate them again. */}
      {removable.length > 0 && (
        <p className="mt-3 text-[11px] text-amber-900">
          Saving <strong>Teams &amp; format</strong> later rebuilds the match list from the
          format, which brings these back if the format still produces them. If that keeps
          happening, the format is generating more games than the schedule has room for —
          change it there rather than removing them again.
        </p>
      )}

      {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
    </div>
  );
}
