import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { db } from './firebase';
import { useAuth } from './AuthContext';
import { useProfile } from './ProfileContext';
import {
  eventLocationLine,
  formatEventWhen,
  formatLabel,
  skillLabel,
} from './eventUtils';
import {
  cardQuiet,
  chipClass,
  ghostButtonClass,
  heroTitle,
  pageGlow,
  pageInner,
  pageShell,
  primaryButtonClass,
  secondaryButtonClass,
  sectionLabel,
} from './communityUi';

export default function EventDetailPage() {
  const { eventId } = useParams();
  const { user, signIn } = useAuth();
  const { profile, needsOnboarding, openOnboarding } = useProfile();

  const [event, setEvent] = useState(null);
  const [rsvps, setRsvps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const snap = await getDoc(doc(db, 'events', eventId));
        if (cancelled) return;
        if (!snap.exists()) {
          setEvent(null);
          setError('notfound');
        } else {
          setEvent({ id: snap.id, ...snap.data() });
        }
      } catch (err) {
        console.error(err);
        if (!cancelled) setError('load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'events', eventId, 'rsvps'), (snap) => {
      setRsvps(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return unsub;
  }, [eventId]);

  const myRsvp = useMemo(
    () => (user ? rsvps.find((r) => r.id === user.uid) : null),
    [rsvps, user]
  );

  const going = useMemo(() => rsvps.filter((r) => r.status === 'going'), [rsvps]);
  const maybe = useMemo(() => rsvps.filter((r) => r.status === 'maybe'), [rsvps]);

  const setRsvp = useCallback(
    async (status) => {
      if (!user) {
        signIn();
        return;
      }
      if (needsOnboarding) {
        openOnboarding();
        return;
      }
      setBusy(true);
      try {
        const ref = doc(db, 'events', eventId, 'rsvps', user.uid);
        if (myRsvp?.status === status) {
          await deleteDoc(ref);
        } else {
          await setDoc(ref, {
            status,
            displayName: profile?.displayName || user.displayName || 'Player',
            updatedAt: serverTimestamp(),
            createdAt: myRsvp?.createdAt || serverTimestamp(),
          });
        }
      } catch (err) {
        console.error(err);
        setError('rsvp');
      } finally {
        setBusy(false);
      }
    },
    [user, signIn, needsOnboarding, openOnboarding, eventId, myRsvp, profile]
  );

  const cancelEvent = async () => {
    if (!event || !user || event.hostUid !== user.uid) return;
    if (!window.confirm('Cancel this session for everyone?')) return;
    setBusy(true);
    try {
      await updateDoc(doc(db, 'events', eventId), {
        status: 'cancelled',
        updatedAt: serverTimestamp(),
      });
      setEvent((e) => (e ? { ...e, status: 'cancelled' } : e));
    } catch (err) {
      console.error(err);
    } finally {
      setBusy(false);
    }
  };

  const share = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: event?.title || 'Pickup', url });
      } else {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      try {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        /* ignore */
      }
    }
  };

  const isHost = user && event && event.hostUid === user.uid;

  return (
    <div className={pageShell}>
      <div className={pageGlow} aria-hidden="true" />
      <div className={`${pageInner} max-w-2xl`}>
        <Link to="/play" className={`${ghostButtonClass} -ml-3 mb-4`}>
          ‹ Play
        </Link>

        {loading ? (
          <div className="h-64 rounded-2xl border border-slate-800 bg-slate-900/40 animate-pulse" />
        ) : error === 'notfound' || !event ? (
          <div className="text-center py-16">
            <h1 className="font-display text-2xl text-white">Session not found</h1>
            <Link to="/play" className={`${primaryButtonClass} mt-6`}>
              Back to Play
            </Link>
          </div>
        ) : (
          <article className="animate-fade-up">
            <p className={sectionLabel}>
              {formatLabel(event.format)}
              {event.skillLevel ? ` · ${skillLabel(event.skillLevel)}` : ''}
            </p>
            <h1 className={`${heroTitle} mt-2`}>{event.title}</h1>
            {event.status === 'cancelled' && (
              <p className="mt-3 inline-flex text-sm font-bold uppercase tracking-wide px-2.5 py-1 rounded-lg bg-red-500/15 text-red-300 border border-red-400/30">
                Cancelled
              </p>
            )}
            <p className="mt-4 text-lg text-amber-200/90 font-semibold">
              {formatEventWhen(event.startsAt, event.endsAt)}
            </p>
            <p className="mt-1 text-slate-300">{eventLocationLine(event)}</p>
            {event.address && (
              <p className="mt-0.5 text-sm text-slate-500">{event.address}</p>
            )}

            <div className="mt-6 flex flex-wrap gap-2">
              {event.cost && <span className={chipClass}>{event.cost}</span>}
              {event.capacity && (
                <span className={chipClass}>
                  Cap {event.capacity} · {going.length} going
                </span>
              )}
              {event.source === 'ingest' && <span className={chipClass}>From public calendar</span>}
              {event.hostName && <span className={chipClass}>Host · {event.hostName}</span>}
            </div>

            {event.description && (
              <div className={`${cardQuiet} mt-6`}>
                <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Details
                </h2>
                <p className="mt-2 text-slate-200 whitespace-pre-wrap leading-relaxed">
                  {event.description}
                </p>
              </div>
            )}

            {event.sourceUrl && (
              <a
                href={event.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 inline-block text-sm text-amber-300 hover:underline"
              >
                Original listing ↗
              </a>
            )}

            {event.status !== 'cancelled' && (
              <div className="mt-8 flex flex-wrap gap-3">
                <button
                  type="button"
                  className={
                    myRsvp?.status === 'going' ? primaryButtonClass : secondaryButtonClass
                  }
                  disabled={busy}
                  onClick={() => setRsvp('going')}
                >
                  {myRsvp?.status === 'going' ? 'Going ✓' : 'I’m going'}
                </button>
                <button
                  type="button"
                  className={
                    myRsvp?.status === 'maybe' ? primaryButtonClass : secondaryButtonClass
                  }
                  disabled={busy}
                  onClick={() => setRsvp('maybe')}
                >
                  {myRsvp?.status === 'maybe' ? 'Maybe ✓' : 'Maybe'}
                </button>
                <button type="button" className={ghostButtonClass} onClick={share}>
                  {copied ? 'Link copied' : 'Share'}
                </button>
                {isHost && (
                  <button
                    type="button"
                    className={`${ghostButtonClass} text-red-300`}
                    disabled={busy}
                    onClick={cancelEvent}
                  >
                    Cancel session
                  </button>
                )}
              </div>
            )}

            {error === 'rsvp' && (
              <p className="mt-3 text-sm text-red-300">Could not update RSVP. Try again.</p>
            )}

            <div className={`${cardQuiet} mt-8`}>
              <h2 className="font-display font-semibold text-white">
                Who’s in · {going.length} going
                {maybe.length ? ` · ${maybe.length} maybe` : ''}
              </h2>
              {rsvps.length === 0 ? (
                <p className="mt-3 text-sm text-slate-500">No RSVPs yet — be the first.</p>
              ) : (
                <ul className="mt-4 space-y-2">
                  {[...going, ...maybe].map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-3 text-sm">
                      <Link
                        to={`/players/${r.id}`}
                        className="text-slate-200 hover:text-amber-300 truncate"
                      >
                        {r.displayName || 'Player'}
                      </Link>
                      <span className="text-xs uppercase tracking-wide text-slate-500 shrink-0">
                        {r.status}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </article>
        )}
      </div>
    </div>
  );
}
