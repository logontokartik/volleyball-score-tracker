// src/SuperAdminPage.js
//
// The operator console: every club on the installation, and the one-off migration that
// lifts the old single-club data under a club.
//
// The gate below is UI only. It decides what this page OFFERS; `superAdmins()` in
// firestore.rules is what actually stops anything, and it would reject every read and
// write on this page for a non-super-admin regardless of what React renders. The gate
// exists so that typing /super gets a plain "not available" instead of a console full
// of permission errors — the route used to render the page to anyone who knew the URL,
// since SiteNav only hid the link.
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getDocs } from 'firebase/firestore';
import { db } from './firebase';
import { clubsCol, membersCol } from './clubPaths';
import { useAuth } from './AuthContext';
import { isSuperAdmin } from './roles';
import {
  DEFAULT_CLUB_ID,
  DEFAULT_CLUB_SLUG,
  inspectMigration,
  runMigration,
  summarizeReport,
} from './migrateToClubs';

const cardClass = 'rounded-2xl border border-slate-700/70 bg-slate-900/70 p-4 sm:p-5 shadow';
const primaryButtonClass =
  'min-h-[48px] px-5 rounded-xl bg-amber-500 text-slate-900 font-bold hover:bg-amber-400 disabled:opacity-50';
const secondaryButtonClass =
  'min-h-[44px] px-4 rounded-xl border border-slate-600 bg-slate-800 text-white font-semibold hover:bg-slate-700 disabled:opacity-50';
const inputClass =
  'w-full min-h-[48px] rounded-xl border border-slate-600 bg-slate-800 px-3 font-mono text-white placeholder-slate-500';

// Member counts are one read per club. Fine for a handful of clubs, silly for a
// directory — past this many the page lists clubs without counts rather than firing N
// queries on every visit.
const COUNT_CLUB_LIMIT = 25;

function Shell({ title, children }) {
  return (
    <div className="max-w-3xl mx-auto px-4 py-16 text-center text-slate-300">
      <h1 className="text-2xl font-black text-white">{title}</h1>
      <div className="mt-3 text-sm">{children}</div>
    </div>
  );
}

export default function SuperAdminPage() {
  const { user, loading: authLoading, signIn } = useAuth();

  if (authLoading) return <Shell title="Super admin">Loading…</Shell>;

  if (!user) {
    return (
      <Shell title="Super admin">
        <p>Sign in to continue.</p>
        <button type="button" onClick={signIn} className={`${primaryButtonClass} mt-4`}>
          Sign in with Google
        </button>
      </Shell>
    );
  }

  if (!isSuperAdmin(user)) {
    return (
      <Shell title="Not available">
        This page is for installation operators. You are signed in as{' '}
        <span className="font-mono text-amber-300">{user.email}</span>. Browse the{' '}
        <Link to="/" className="text-amber-300 underline">
          club list
        </Link>{' '}
        instead.
      </Shell>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-3 sm:px-4 py-6 sm:py-10 grid gap-6">
      <h1 className="text-2xl sm:text-3xl font-black text-white">Super admin</h1>
      <ClubList />
      <MigrationPanel user={user} />
    </div>
  );
}

function ClubList() {
  const [state, setState] = useState({ loading: true, error: '', clubs: [], counted: false });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      // clubs/{clubId} is world-readable, so the listing itself is one query.
      const snap = await getDocs(clubsCol());
      const clubs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      clubs.sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)));

      let counted = false;
      if (clubs.length <= COUNT_CLUB_LIMIT) {
        counted = true;
        // Members are not public, but a super admin may read them (firestore.rules).
        const counts = await Promise.all(
          clubs.map((c) =>
            getDocs(membersCol(c.id))
              .then((s) => s.size)
              .catch(() => null)
          )
        );
        clubs.forEach((c, i) => {
          c.memberCount = counts[i];
        });
      }
      setState({ loading: false, error: '', clubs, counted });
    } catch (err) {
      setState({ loading: false, error: 'Could not list clubs. Reload and try again.', clubs: [], counted: false });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <section className={cardClass}>
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 className="text-lg font-bold text-white">Clubs</h2>
        <button type="button" onClick={load} disabled={state.loading} className={secondaryButtonClass}>
          {state.loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {state.error && <p className="text-sm text-red-300">{state.error}</p>}

      {!state.loading && !state.error && state.clubs.length === 0 && (
        <p className="text-sm text-slate-300">No clubs yet.</p>
      )}

      {state.clubs.length > 0 && (
        <>
          <ul className="grid gap-2">
            {state.clubs.map((club) => (
              <li key={club.id}>
                <Link
                  to={club.slug ? `/c/${club.slug}` : '#'}
                  className="flex items-center justify-between gap-3 min-h-[48px] rounded-xl border border-slate-700 bg-slate-800/70 px-4 py-2 hover:bg-slate-700"
                >
                  <span className="min-w-0">
                    <span className="block font-semibold text-white truncate">{club.name || club.id}</span>
                    <span className="block text-xs text-slate-400 font-mono truncate">
                      /c/{club.slug || '—'} · id {club.id}
                    </span>
                  </span>
                  {state.counted && (
                    <span className="shrink-0 text-xs font-bold uppercase tracking-wide text-amber-300">
                      {club.memberCount == null ? '— members' : `${club.memberCount} member${club.memberCount === 1 ? '' : 's'}`}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
          {!state.counted && (
            <p className="mt-3 text-xs text-slate-400">
              Member counts hidden: more than {COUNT_CLUB_LIMIT} clubs would mean one query per club on
              every page load.
            </p>
          )}
        </>
      )}
    </section>
  );
}

function MigrationPanel({ user }) {
  const [clubId, setClubId] = useState(DEFAULT_CLUB_ID);
  const [slug, setSlug] = useState(DEFAULT_CLUB_SLUG);
  const [name, setName] = useState('Greenville Volleyball League');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [plan, setPlan] = useState(null);
  const [report, setReport] = useState(null);
  // Off by default, and reset by every dry run: overwriting is the destructive mode, so
  // it must be chosen for the run in front of the operator, not left ticked from an
  // earlier one.
  const [overwriteExisting, setOverwriteExisting] = useState(false);

  const preview = async () => {
    setError('');
    setReport(null);
    setOverwriteExisting(false);
    setBusy('preview');
    try {
      setPlan(await inspectMigration(db, { clubId: clubId.trim(), slug: slug.trim(), uid: user.uid }));
    } catch (err) {
      setPlan(null);
      setError(
        err?.code === 'permission-denied'
          ? 'Firestore refused to read the legacy documents. Only a super admin can, and only while the legacy block is still in firestore.rules.'
          : `Could not read the legacy data: ${err?.message || err}`
      );
    } finally {
      setBusy('');
    }
  };

  const perform = async () => {
    setError('');
    setBusy('run');
    try {
      const result = await runMigration(db, {
        clubId: clubId.trim(),
        slug: slug.trim(),
        name: name.trim(),
        user,
        overwriteExisting,
      });
      setReport(result);
      // Re-survey so the panel shows the world as it now is, not as it was before, and
      // un-tick overwrite so a second click cannot inherit the destructive choice.
      setOverwriteExisting(false);
      setPlan(await inspectMigration(db, { clubId: clubId.trim(), slug: slug.trim(), uid: user.uid }));
    } catch (err) {
      setError(`The migration stopped: ${err?.message || err}`);
    } finally {
      setBusy('');
    }
  };

  return (
    <section className={cardClass}>
      <h2 className="text-lg font-bold text-white mb-1">Migrate the legacy league into a club</h2>
      <p className="text-sm text-slate-300 mb-4">
        Copies the old top-level <span className="font-mono">tournaments/</span> collection and{' '}
        <span className="font-mono">settings/</span> documents under a club, keeping every document id.{' '}
        <span className="font-semibold text-amber-300">It copies — nothing is deleted or changed at the
        old paths</span>. Safe to run again: a tournament that is already under the club is skipped, so a
        run that finishes a half-done copy cannot wipe out games scored in the meantime.
      </p>

      <div className="grid gap-3 sm:grid-cols-3 mb-4">
        <label className="block text-sm text-slate-300">
          Club id
          <input className={`${inputClass} mt-1`} value={clubId} onChange={(e) => setClubId(e.target.value)} />
        </label>
        <label className="block text-sm text-slate-300">
          Address (/c/…)
          <input className={`${inputClass} mt-1`} value={slug} onChange={(e) => setSlug(e.target.value)} />
        </label>
        <label className="block text-sm text-slate-300">
          Club name
          <input
            className={`${inputClass} mt-1 font-sans`}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
      </div>

      {/* The overwrite choice is only offered when there is actually something to
          overwrite, and it names the consequence rather than the mechanism — the
          operator's question is "will I lose scores", not "does this call setDoc". */}
      {plan && plan.blockers.length === 0 && plan.willOverwrite.length > 0 && (
        <label className="flex items-start gap-3 min-h-[48px] rounded-xl border border-slate-700 bg-slate-950/60 px-4 py-3 mb-3 cursor-pointer">
          <input
            type="checkbox"
            checked={overwriteExisting}
            onChange={(e) => setOverwriteExisting(e.target.checked)}
            className="mt-1 h-5 w-5 shrink-0 accent-amber-500"
          />
          <span className="text-sm text-slate-200">
            <span className="font-semibold text-white">
              Overwrite the {plan.willOverwrite.length} tournament
              {plan.willOverwrite.length === 1 ? '' : 's'} already under this club
            </span>
            <span className="block text-xs text-red-300 mt-0.5">
              Destructive. Anything scored in them since the last run is replaced by the legacy
              copy and cannot be recovered. Leave this off to finish an interrupted migration.
            </span>
          </span>
        </label>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={preview} disabled={Boolean(busy)} className={secondaryButtonClass}>
          {busy === 'preview' ? 'Checking…' : 'Dry run'}
        </button>
        {/* The perform button only appears once a dry run has been read, and never while
            something in the plan makes the run unsafe. Its label states the mode, so the
            destructive one is never a click the operator has to infer. */}
        {plan && plan.blockers.length === 0 && (
          <button
            type="button"
            onClick={perform}
            disabled={Boolean(busy)}
            className={
              overwriteExisting && plan.willOverwrite.length > 0
                ? 'min-h-[48px] px-5 rounded-xl bg-red-600 text-white font-bold hover:bg-red-500 disabled:opacity-50'
                : primaryButtonClass
            }
          >
            {busy === 'run'
              ? 'Migrating…'
              : !plan.clubExists
                ? 'Create the club and copy'
                : overwriteExisting && plan.willOverwrite.length > 0
                  ? `Overwrite ${plan.willOverwrite.length} and copy ${plan.willCopy.length}`
                  : `Copy ${plan.willCopy.length} missing tournament${plan.willCopy.length === 1 ? '' : 's'}`}
          </button>
        )}
      </div>

      {error && (
        <div className="mt-4 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}

      {plan && <PlanView plan={plan} overwriteExisting={overwriteExisting} />}
      {report && <ReportView report={report} />}
    </section>
  );
}

function Row({ label, children }) {
  return (
    <div className="flex flex-wrap justify-between gap-2 border-b border-slate-800 py-1.5 last:border-0">
      <span className="text-slate-400">{label}</span>
      <span className="text-white text-right">{children}</span>
    </div>
  );
}

function PlanView({ plan, overwriteExisting }) {
  const overwriting = overwriteExisting && plan.willOverwrite.length > 0;
  return (
    <div className="mt-4 rounded-xl border border-slate-700 bg-slate-950/60 p-4 text-sm">
      <h3 className="font-bold text-white mb-2">What is there now</h3>
      <Row label="Legacy tournaments">{plan.legacyTournamentCount}</Row>
      <Row label="Active tournament pointer">
        {plan.activeTournamentId ? (
          <span className="font-mono">
            {plan.activeTournamentId}
            {plan.activeTournamentResolves ? '' : ' (missing!)'}
          </span>
        ) : (
          'none'
        )}
      </Row>
      <Row label="Legacy archive snapshot">{plan.archiveSnapshotExists ? 'present' : 'none'}</Row>
      <Row label={`Club "${plan.clubId}"`}>{plan.clubExists ? 'already exists' : 'will be created'}</Row>
      <Row label={`Address /c/${plan.slug}`}>
        {plan.slugExists ? `points at "${plan.slugClubId}"` : 'free'}
      </Row>

      <h3 className="font-bold text-white mt-4 mb-2">What this run would write</h3>
      {plan.blockers.length > 0 ? (
        <ul className="list-disc pl-5 text-red-200">
          {plan.blockers.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      ) : (
        <ul className="list-disc pl-5 text-slate-200">
          {plan.willCreateClub ? (
            <li>
              Create <span className="font-mono">clubs/{plan.clubId}</span>,{' '}
              <span className="font-mono">slugs/{plan.slug}</span> and your founding admin member
              document, in one batch.
            </li>
          ) : (
            <li>Leave the existing club document alone (only genuinely missing fields are filled in).</li>
          )}
          {plan.willRepairSlug && (
            <li className="text-amber-200">
              Create the missing <span className="font-mono">slugs/{plan.slug}</span> — without it{' '}
              <span className="font-mono">/c/{plan.slug}</span> does not resolve at all.
            </li>
          )}
          <li>
            Copy {plan.willCopy.length} new tournament{plan.willCopy.length === 1 ? '' : 's'} at their
            original ids.
          </li>
          <li className={overwriting ? 'text-red-200 font-semibold' : undefined}>
            {plan.willOverwrite.length === 0
              ? 'Nothing is already under this club, so nothing is at risk of being overwritten.'
              : overwriting
                ? `OVERWRITE the ${plan.willOverwrite.length} tournament${plan.willOverwrite.length === 1 ? '' : 's'} already there, discarding anything scored in them since.`
                : `Skip the ${plan.willOverwrite.length} tournament${plan.willOverwrite.length === 1 ? '' : 's'} already there, leaving live scores intact.`}
          </li>
          <li>
            {!plan.archiveSnapshotExists
              ? 'No archive snapshot to copy.'
              : plan.archiveAlreadyCopied && !overwriting
                ? `Leave clubs/${plan.clubId}/archive/snapshot alone — it is already there and may have been refreshed since.`
                : `Write clubs/${plan.clubId}/archive/snapshot${plan.archiveAlreadyCopied ? ' (replacing the one already there)' : ''}.`}
          </li>
          <li>Delete nothing.</li>
        </ul>
      )}
      {plan.memberError && <p className="mt-2 text-red-200">Member check failed: {plan.memberError}</p>}
    </div>
  );
}

function ReportView({ report }) {
  const good = report.ok;
  return (
    <div
      className={`mt-4 rounded-xl border p-4 text-sm ${
        good ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-red-500/40 bg-red-500/10'
      }`}
    >
      <h3 className="font-bold text-white mb-2">{good ? 'Migration finished' : 'Migration finished with problems'}</h3>
      <p className={good ? 'text-emerald-100' : 'text-red-100'}>{summarizeReport(report)}</p>

      {report.failed.length > 0 && (
        <>
          <h4 className="font-semibold text-white mt-3">Failed documents</h4>
          <ul className="list-disc pl-5 text-red-100">
            {report.failed.map((f) => (
              <li key={f.id}>
                <span className="font-mono">{f.id}</span> — {f.error}
              </li>
            ))}
          </ul>
        </>
      )}

      {report.notes.length > 0 && (
        <ul className="list-disc pl-5 mt-3 text-slate-200">
          {report.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}

      {report.copied.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-slate-300">
            {report.copied.length} document{report.copied.length === 1 ? '' : 's'} copied
          </summary>
          <p className="mt-2 font-mono text-xs break-all text-slate-400">{report.copied.join(', ')}</p>
        </details>
      )}

      {report.skipped.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-slate-300">
            {report.skipped.length} document{report.skipped.length === 1 ? '' : 's'} already under the club,
            left untouched
          </summary>
          <p className="mt-2 font-mono text-xs break-all text-slate-400">{report.skipped.join(', ')}</p>
        </details>
      )}
    </div>
  );
}
