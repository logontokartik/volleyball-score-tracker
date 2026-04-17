import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import archiveData from './data/archiveData.json';
import {
  GOOGLE_SHEETS_ARCHIVE_URL,
  computeArchiveStats,
  answerArchiveQuestion,
} from './archiveInsights';
import {
  CHAMPION_PHOTOS_BY_TOURNAMENT,
  GVW_EMBEDDED_VIDEO_IFRAME_SRC,
  GVW_MEDIA_GALLERIES,
} from './archiveGvwMedia';

const TABS = [
  { id: 'master', label: 'Master stats' },
  { id: 'signups', label: 'Signups by tournament' },
  { id: 'directory', label: 'Player directory' },
  { id: 'champions', label: 'Winners & runners' },
  { id: 'media', label: 'Photos & video' },
];

const EXAMPLE_QUESTIONS = [
  'Which pairs won together on a championship team?',
  'Who has the most tournament wins?',
  'Who played the most tournaments?',
  'Who has the most runner-up finishes?',
  'How many unique players are in the archive?',
];

function TabButton({ id, label, active, onClick }) {
  return (
    <button
      type="button"
      onClick={() => onClick(id)}
      className={`px-3 py-2.5 sm:px-4 rounded-xl text-xs sm:text-sm font-semibold whitespace-nowrap min-h-[44px] transition-colors ${
        active
          ? 'bg-amber-500 text-slate-900 shadow'
          : 'bg-slate-800 text-slate-200 hover:bg-slate-700 border border-slate-600'
      }`}
    >
      {label}
    </button>
  );
}

function parseBoldLine(line) {
  const parts = String(line).split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={i} className="text-white font-semibold">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

function RichAnswerBody({ text }) {
  return (
    <div className="text-slate-300 text-sm leading-relaxed space-y-2 whitespace-pre-line">
      {text.split('\n').map((line, i) => (
        <p key={i} className="mb-0">
          {parseBoldLine(line)}
        </p>
      ))}
    </div>
  );
}

function ChampionPhotoStrip({ urls, label }) {
  if (!urls?.length) return null;
  return (
    <div className="mb-4">
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">{label}</p>
      <div className="flex flex-wrap gap-2">
        {urls.map((src, i) => (
          <img
            key={`${src}-${i}`}
            src={src}
            alt={`${label} — photo ${i + 1}`}
            className="rounded-lg border border-slate-600/80 max-h-36 sm:max-h-44 w-auto object-cover bg-slate-900"
            loading="lazy"
          />
        ))}
      </div>
    </div>
  );
}

function StatCard({ label, value, sub, accent }) {
  const accents = {
    amber: 'from-amber-500/25 to-orange-600/10 border-amber-500/40',
    emerald: 'from-emerald-500/20 to-teal-600/10 border-emerald-500/35',
    sky: 'from-sky-500/20 to-blue-600/10 border-sky-500/35',
    violet: 'from-violet-500/20 to-purple-600/10 border-violet-500/35',
    rose: 'from-rose-500/20 to-pink-600/10 border-rose-500/35',
  };
  return (
    <div
      className={`rounded-2xl border bg-gradient-to-br p-4 sm:p-5 shadow-lg ${
        accents[accent] || accents.amber
      }`}
    >
      <div className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">{label}</div>
      <div className="text-2xl sm:text-3xl font-black text-white tabular-nums">{value}</div>
      {sub && <div className="text-xs text-slate-400 mt-2 leading-snug">{sub}</div>}
    </div>
  );
}

export default function ArchiveHub() {
  const [tab, setTab] = useState('master');
  const [search, setSearch] = useState('');
  const [signupPick, setSignupPick] = useState(0);
  const [sortKey, setSortKey] = useState('tournamentsWon');
  const [sortDir, setSortDir] = useState('desc');
  const [askInput, setAskInput] = useState('');
  const [askResult, setAskResult] = useState(null);

  const { masterList, tournamentSignups, directory, champions, tournamentNames, generatedAt } =
    archiveData;

  const stats = useMemo(() => computeArchiveStats(archiveData), []);

  const filteredMaster = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = !q
      ? masterList
      : masterList.filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            (p.speciality && p.speciality.toLowerCase().includes(q))
        );
    rows = [...rows].sort((a, b) => {
      const va = a[sortKey];
      const vb = b[sortKey];
      const numA = typeof va === 'number' ? va : String(va).toLowerCase();
      const numB = typeof vb === 'number' ? vb : String(vb).toLowerCase();
      let c = 0;
      if (typeof numA === 'number' && typeof numB === 'number') c = numA - numB;
      else c = String(numA).localeCompare(String(numB));
      return sortDir === 'desc' ? -c : c;
    });
    return rows;
  }, [masterList, search, sortKey, sortDir]);

  const filteredDirectory = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return directory;
    return directory.filter(
      (d) =>
        d.canonicalName.toLowerCase().includes(q) ||
        d.rawName.toLowerCase().includes(q)
    );
  }, [directory, search]);

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const selectedSignup = tournamentSignups[signupPick] || tournamentSignups[0];

  const runAsk = () => {
    setAskResult(answerArchiveQuestion(askInput, archiveData, stats));
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-gradient-to-b from-slate-900 via-slate-900 to-slate-950 text-slate-100 pb-12">
      <div className="max-w-6xl mx-auto px-3 sm:px-4 pt-6 sm:pt-10">
        <div className="rounded-3xl bg-gradient-to-br from-amber-500/20 via-orange-500/10 to-transparent border border-amber-500/30 p-6 sm:p-10 mb-8 text-center sm:text-left">
          <p className="text-amber-400/90 text-sm font-semibold uppercase tracking-widest mb-2">
            Historical records
          </p>
          <h1 className="text-3xl sm:text-4xl font-black text-white tracking-tight mb-3">
            GVBL tournament archive
          </h1>
          <p className="text-slate-300 max-w-2xl text-sm sm:text-base leading-relaxed">
            Career stats, every signup roster, normalized player names, and champions across all
            seasons — synced from the club spreadsheet.
          </p>
          <p className="text-slate-500 text-xs mt-4">
            Snapshot generated {new Date(generatedAt).toLocaleString()} ·{' '}
            <a
              href={GOOGLE_SHEETS_ARCHIVE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-amber-400 hover:text-amber-300 font-medium underline underline-offset-2"
            >
              View &amp; edit live data in Google Sheets
            </a>
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              to="/"
              className="inline-flex items-center justify-center min-h-[48px] px-6 rounded-xl bg-white text-slate-900 font-bold text-sm hover:bg-amber-100 transition-colors"
            >
              ← Open live score tracker
            </Link>
            <a
              href={GOOGLE_SHEETS_ARCHIVE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center min-h-[48px] px-6 rounded-xl border-2 border-amber-400/60 text-amber-300 font-bold text-sm hover:bg-amber-500/10 transition-colors"
            >
              Open Google Sheet ↗
            </a>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mb-6 overflow-x-auto pb-1">
          {TABS.map((t) => (
            <TabButton key={t.id} {...t} active={tab === t.id} onClick={setTab} />
          ))}
        </div>

        {(tab === 'master' || tab === 'directory') && (
          <div className="mb-4">
            <label className="sr-only" htmlFor="archive-search">
              Search
            </label>
            <input
              id="archive-search"
              type="search"
              placeholder={
                tab === 'master' ? 'Search players or role…' : 'Search canonical or raw name…'
              }
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full max-w-md rounded-xl border border-slate-600 bg-slate-800 px-4 py-3 text-base text-white placeholder:text-slate-500 min-h-[48px]"
            />
          </div>
        )}

        {tab === 'master' && (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
              <StatCard
                accent="amber"
                label="Unique players"
                value={stats.uniqueCanonicalPlayers}
                sub="Canonical names (VLookups directory)"
              />
              <StatCard
                accent="emerald"
                label="Tournament seasons"
                value={stats.totalTournaments}
                sub={`${stats.seasonsWithResults} seasons with winner data`}
              />
              <StatCard
                accent="sky"
                label="Signup entries"
                value={stats.totalSignupSlots}
                sub="Total roster slots across all columns"
              />
              <StatCard
                accent="violet"
                label="Titles in data"
                value={stats.championSlots}
                sub={`${stats.totalWins} master-list wins · ${stats.totalRunnerUps} runner-ups`}
              />
            </div>

            <div className="grid md:grid-cols-3 gap-4 mb-8">
              <div className="rounded-2xl border border-slate-700 bg-slate-800/50 p-4">
                <h3 className="text-xs font-bold uppercase text-emerald-400 mb-3">Most wins</h3>
                <ol className="space-y-2 text-sm">
                  {stats.topWon.slice(0, 7).map((p, i) => (
                    <li key={p.name} className="flex justify-between gap-2">
                      <span className="text-slate-300 truncate">
                        {i + 1}. {p.name}
                      </span>
                      <span className="text-amber-400 font-bold tabular-nums shrink-0">{p.tournamentsWon}</span>
                    </li>
                  ))}
                </ol>
              </div>
              <div className="rounded-2xl border border-slate-700 bg-slate-800/50 p-4">
                <h3 className="text-xs font-bold uppercase text-sky-400 mb-3">Most played</h3>
                <ol className="space-y-2 text-sm">
                  {stats.topPlayed.slice(0, 7).map((p, i) => (
                    <li key={p.name} className="flex justify-between gap-2">
                      <span className="text-slate-300 truncate">
                        {i + 1}. {p.name}
                      </span>
                      <span className="text-sky-300 font-bold tabular-nums shrink-0">
                        {p.tournamentsPlayed}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
              <div className="rounded-2xl border border-slate-700 bg-slate-800/50 p-4">
                <h3 className="text-xs font-bold uppercase text-rose-400 mb-3">Top pairs (same winning team)</h3>
                <p className="text-[11px] text-slate-500 mb-2">
                  Most often on the same tournament winner list (championship roster)
                </p>
                <ol className="space-y-2 text-sm">
                  {stats.topPairs.slice(0, 5).map((p, i) => (
                    <li key={`${p.a}-${p.b}`} className="text-slate-300">
                      <span className="text-slate-500">{i + 1}.</span> {p.a} &amp; {p.b}{' '}
                      <span className="text-amber-400/90 tabular-nums">({p.titlesTogether}×)</span>
                    </li>
                  ))}
                </ol>
              </div>
            </div>

            <div className="rounded-2xl border border-amber-500/30 bg-slate-800/60 p-4 sm:p-6 mb-8">
              <h2 className="text-lg font-bold text-white mb-1">Ask the archive</h2>
              <p className="text-xs text-slate-400 mb-4">
                Free-form questions are answered from this snapshot only (patterns + stats — not a
                live AI). Great for &ldquo;who won most&rdquo;, &ldquo;most played&rdquo;, or
                &ldquo;which pairs won on the same team&rdquo;.
              </p>
              <div className="flex flex-col sm:flex-row gap-2 mb-3">
                <textarea
                  value={askInput}
                  onChange={(e) => setAskInput(e.target.value)}
                  placeholder="e.g. Which pairs won together on a championship team?"
                  rows={2}
                  className="flex-1 rounded-xl border border-slate-600 bg-slate-900 px-4 py-3 text-base text-white placeholder:text-slate-500 min-h-[88px] resize-y"
                />
                <button
                  type="button"
                  onClick={runAsk}
                  className="shrink-0 min-h-[48px] px-6 rounded-xl bg-amber-500 text-slate-900 font-bold text-sm hover:bg-amber-400"
                >
                  Get answer
                </button>
              </div>
              <div className="flex flex-wrap gap-2 mb-4">
                {EXAMPLE_QUESTIONS.map((ex) => (
                  <button
                    key={ex}
                    type="button"
                    onClick={() => {
                      setAskInput(ex);
                      setAskResult(answerArchiveQuestion(ex, archiveData, stats));
                    }}
                    className="text-xs px-3 py-2 rounded-lg bg-slate-700/80 text-slate-200 hover:bg-slate-600 border border-slate-600 text-left max-w-full"
                  >
                    {ex}
                  </button>
                ))}
              </div>
              {askResult && (
                <div className="rounded-xl border border-slate-600 bg-slate-900/80 p-4">
                  <h3 className="text-amber-400 font-bold text-sm mb-2">{askResult.title}</h3>
                  <RichAnswerBody text={askResult.body} />
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-slate-700 bg-slate-800/40 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[640px]">
                  <thead>
                    <tr className="bg-slate-800 text-left text-slate-300">
                      <th className="p-3 font-semibold">#</th>
                      <th className="p-3 font-semibold">
                        <button
                          type="button"
                          className="underline-offset-2 hover:underline"
                          onClick={() => toggleSort('name')}
                        >
                          Player
                        </button>
                      </th>
                      <th className="p-3 font-semibold text-right">
                        <button
                          type="button"
                          className="underline-offset-2 hover:underline"
                          onClick={() => toggleSort('tournamentsPlayed')}
                        >
                          Played
                        </button>
                      </th>
                      <th className="p-3 font-semibold text-right">
                        <button
                          type="button"
                          className="underline-offset-2 hover:underline"
                          onClick={() => toggleSort('tournamentsWon')}
                        >
                          Won
                        </button>
                      </th>
                      <th className="p-3 font-semibold text-right">
                        <button
                          type="button"
                          className="underline-offset-2 hover:underline"
                          onClick={() => toggleSort('runnersUp')}
                        >
                          Runner-up
                        </button>
                      </th>
                      <th className="p-3 font-semibold hidden md:table-cell">Role</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredMaster.map((p, i) => (
                      <tr
                        key={p.name}
                        className={i % 2 === 0 ? 'bg-slate-900/50' : 'bg-slate-900/30'}
                      >
                        <td className="p-3 text-slate-500 tabular-nums">{i + 1}</td>
                        <td className="p-3 font-medium text-white">{p.name}</td>
                        <td className="p-3 text-right tabular-nums">{p.tournamentsPlayed}</td>
                        <td className="p-3 text-right tabular-nums text-amber-400 font-semibold">
                          {p.tournamentsWon}
                        </td>
                        <td className="p-3 text-right tabular-nums">{p.runnersUp}</td>
                        <td
                          className="p-3 text-slate-400 hidden md:table-cell text-xs max-w-[12rem] truncate"
                          title={p.speciality}
                        >
                          {p.speciality || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {tab === 'signups' && (
          <div className="grid gap-4">
            <p className="text-xs text-slate-500">
              Source:{' '}
              <a
                href={GOOGLE_SHEETS_ARCHIVE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-amber-400 underline"
              >
                All Tournaments tab
              </a>{' '}
              in Google Sheets.
            </p>
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <label className="text-sm font-medium text-slate-400">Tournament</label>
              <select
                value={signupPick}
                onChange={(e) => setSignupPick(Number(e.target.value))}
                className="rounded-xl border border-slate-600 bg-slate-800 text-white px-4 py-3 min-h-[48px] max-w-full sm:max-w-xl"
              >
                {tournamentSignups.map((t, i) => (
                  <option key={t.name} value={i}>
                    {t.name} ({t.signups.length} players)
                  </option>
                ))}
              </select>
            </div>
            <div className="rounded-2xl border border-slate-700 bg-slate-800/40 p-4 sm:p-6">
              <h3 className="text-lg font-bold text-white mb-4">{selectedSignup?.name}</h3>
              <ol className="grid grid-cols-1 sm:grid-cols-2 gap-2 list-decimal list-inside text-slate-200">
                {selectedSignup?.signups.map((name, idx) => (
                  <li key={`${name}-${idx}`} className="pl-1 py-1 rounded-lg hover:bg-slate-700/50">
                    {name}
                  </li>
                ))}
              </ol>
            </div>
          </div>
        )}

        {tab === 'directory' && (
          <>
            <p className="text-xs text-slate-500 mb-3">
              Normalized names from the{' '}
              <a
                href={GOOGLE_SHEETS_ARCHIVE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-amber-400 underline"
              >
                VLookups tab
              </a>
              .
            </p>
            <div className="rounded-2xl border border-slate-700 bg-slate-800/40 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[720px]">
                  <thead>
                    <tr className="bg-slate-800 text-slate-300 text-left">
                      <th className="p-3 font-semibold">Canonical name</th>
                      <th className="p-3 font-semibold">Also signed up as</th>
                      <th className="p-3 font-semibold text-right">Tournaments</th>
                      <th className="p-3 font-semibold hidden lg:table-cell">Appearances</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredDirectory.map((d, i) => (
                      <tr
                        key={`${d.canonicalName}-${i}`}
                        className={i % 2 === 0 ? 'bg-slate-900/50' : 'bg-slate-900/30'}
                      >
                        <td className="p-3 font-medium text-white">{d.canonicalName}</td>
                        <td className="p-3 text-slate-400 text-xs">
                          {d.rawName !== d.canonicalName ? d.rawName : '—'}
                        </td>
                        <td className="p-3 text-right tabular-nums">{d.tournamentsPlayed}</td>
                        <td className="p-3 text-xs text-slate-500 hidden lg:table-cell max-w-md">
                          {Object.entries(d.appearances)
                            .slice(0, 4)
                            .map(([tn, nm]) => `${tn}: ${nm}`)
                            .join(' · ')}
                          {Object.keys(d.appearances).length > 4 ? ' …' : ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {tab === 'champions' && (
          <div className="grid gap-6">
            <p className="text-xs text-slate-500">
              Winner / runner rows from{' '}
              <a
                href={GOOGLE_SHEETS_ARCHIVE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-amber-400 underline"
              >
                VLookups
              </a>{' '}
              (spreadsheet).
            </p>
            {[...tournamentNames].reverse().map((tn) => {
              const w = champions.winners[tn] || [];
              const r = champions.runnersUp[tn] || [];
              if (!w.length && !r.length) return null;
              const pics = CHAMPION_PHOTOS_BY_TOURNAMENT[tn];
              return (
                <div
                  key={tn}
                  className="rounded-2xl border border-slate-700 bg-slate-800/40 overflow-hidden"
                >
                  <div className="bg-slate-800 px-4 py-3 font-bold text-amber-400 text-lg border-b border-slate-700">
                    {tn}
                  </div>
                  <div className="grid md:grid-cols-2 gap-4 p-4 sm:p-6">
                    <div>
                      <ChampionPhotoStrip urls={pics?.winners} label="Winner photos" />
                      <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-400 mb-3">
                        Winners
                      </h4>
                      <ul className="space-y-1.5 text-slate-200">
                        {w.map((name, idx) => (
                          <li key={idx} className="flex gap-2">
                            <span className="text-slate-500 w-6">{idx + 1}.</span>
                            <span>{name}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <ChampionPhotoStrip urls={pics?.runnersUp} label="Runner-up photos" />
                      <h4 className="text-xs font-bold uppercase tracking-wider text-sky-400 mb-3">
                        Runners-up
                      </h4>
                      <ul className="space-y-1.5 text-slate-200">
                        {r.length ? (
                          r.map((name, idx) => (
                            <li key={idx} className="flex gap-2">
                              <span className="text-slate-500 w-6">{idx + 1}.</span>
                              <span>{name}</span>
                            </li>
                          ))
                        ) : (
                          <li className="text-slate-500">—</li>
                        )}
                      </ul>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {tab === 'media' && (
          <div className="max-w-5xl">
            <h2 className="text-2xl font-black text-white mb-2">Photos &amp; video</h2>
            <p className="text-sm text-slate-400 leading-relaxed mb-8">
              Tournament galleries play in the app. More seasons can be added alongside new photo sets.
            </p>

            {GVW_EMBEDDED_VIDEO_IFRAME_SRC ? (
              <div className="mb-10 rounded-2xl border border-slate-700 overflow-hidden bg-black shadow-lg">
                <div className="aspect-video w-full max-h-[min(70vh,520px)]">
                  <iframe
                    title="GVW volleyball video"
                    src={GVW_EMBEDDED_VIDEO_IFRAME_SRC}
                    className="w-full h-full border-0"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
                    allowFullScreen
                  />
                </div>
              </div>
            ) : null}

            <div className="grid gap-12">
              {GVW_MEDIA_GALLERIES.map((g) => (
                <section key={g.id} className="rounded-2xl border border-slate-700 bg-slate-800/40 p-4 sm:p-6">
                  <h3 className="text-lg font-bold text-white mb-1">{g.title}</h3>
                  <p className="text-xs text-slate-500 mb-5">{g.caption}</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {g.images.map((src, i) => {
                      const label = g.labels?.[i];
                      return (
                        <figure
                          key={`${g.id}-${i}`}
                          className="rounded-xl overflow-hidden border border-slate-600/80 bg-slate-900"
                        >
                          <div className="aspect-[4/3] w-full">
                            <img
                              src={src}
                              alt={label ? `${label} — winner photo` : `${g.title} — ${i + 1}`}
                              className="w-full h-full object-cover"
                              loading="lazy"
                                              />
                          </div>
                          {label ? (
                            <figcaption className="px-2 py-2 text-center text-[11px] font-semibold text-slate-400">
                              {label}
                            </figcaption>
                          ) : null}
                        </figure>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
