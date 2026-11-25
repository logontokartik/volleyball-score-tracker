// Pickup / drop-in events for New England discovery.

import { NE_STATE_CODES, SKILL_LEVEL_IDS, stateLabel, skillLabel } from './profileUtils';

export { stateLabel, skillLabel };

export const EVENT_FORMATS = [
  { id: 'indoor', label: 'Indoor' },
  { id: 'outdoor', label: 'Outdoor' },
  { id: 'grass', label: 'Grass' },
  { id: 'beach', label: 'Beach' },
];

export const EVENT_FORMAT_IDS = EVENT_FORMATS.map((f) => f.id);

export const EVENT_STATUSES = ['scheduled', 'cancelled', 'ended'];

const text = (value) => String(value ?? '').trim();

export function formatLabel(id) {
  return EVENT_FORMATS.find((f) => f.id === id)?.label || id || '';
}

export function toDateInputValue(date) {
  if (!date) return '';
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function toTimeInputValue(date) {
  if (!date) return '';
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Combine local date + time strings into a Date in the browser's local zone. */
export function combineLocalDateTime(dateStr, timeStr) {
  if (!dateStr || !timeStr) return null;
  const d = new Date(`${dateStr}T${timeStr}`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatEventWhen(startsAt, endsAt) {
  if (!startsAt) return '';
  const start = startsAt instanceof Date ? startsAt : startsAt.toDate?.() || new Date(startsAt);
  if (Number.isNaN(start.getTime())) return '';
  const datePart = start.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
  const timePart = start.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
  let endPart = '';
  if (endsAt) {
    const end = endsAt instanceof Date ? endsAt : endsAt.toDate?.() || new Date(endsAt);
    if (!Number.isNaN(end.getTime())) {
      endPart = ` – ${end.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
    }
  }
  return `${datePart} · ${timePart}${endPart}`;
}

export function normalizeEventInput(input) {
  const title = text(input?.title).slice(0, 120);
  const description = text(input?.description).slice(0, 2000);
  const venueName = text(input?.venueName).slice(0, 120);
  const address = text(input?.address).slice(0, 200);
  const city = text(input?.city).slice(0, 80);
  const state = NE_STATE_CODES.includes(input?.state) ? input.state : '';
  const format = EVENT_FORMAT_IDS.includes(input?.format) ? input.format : 'indoor';
  const skillLevel = SKILL_LEVEL_IDS.includes(input?.skillLevel) ? input.skillLevel : 'open';
  const cost = text(input?.cost).slice(0, 80);
  const sourceUrl = text(input?.sourceUrl).slice(0, 500);
  const capacityRaw = Number(input?.capacity);
  const capacity = Number.isFinite(capacityRaw) && capacityRaw > 0 ? Math.floor(capacityRaw) : null;

  return {
    title,
    description,
    venueName,
    address,
    city,
    state,
    format,
    skillLevel,
    cost,
    capacity,
    sourceUrl: sourceUrl || null,
    timezone: 'America/New_York',
    status: EVENT_STATUSES.includes(input?.status) ? input.status : 'scheduled',
  };
}

export function validateEventInput(input, { startsAt, endsAt } = {}) {
  if (!text(input?.title)) return 'Give the session a title.';
  if (!NE_STATE_CODES.includes(input?.state)) return 'Pick a New England state.';
  if (!text(input?.city)) return 'Add a city.';
  if (!text(input?.venueName)) return 'Add a venue or court name.';
  if (!startsAt || Number.isNaN(startsAt.getTime?.() ?? +startsAt)) {
    return 'Pick a start date and time.';
  }
  if (endsAt && endsAt <= startsAt) return 'End time must be after the start.';
  if (input?.sourceUrl) {
    try {
      const u = new URL(input.sourceUrl);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'Link must be http(s).';
    } catch {
      return 'Link looks invalid.';
    }
  }
  return '';
}

export function eventLocationLine(event) {
  const bits = [event?.venueName, event?.city, event?.state].filter(Boolean);
  return bits.join(' · ');
}
