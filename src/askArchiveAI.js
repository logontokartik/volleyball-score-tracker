/**
 * Client for the /api/ask-archive Vercel Function.
 *
 * No API key lives here — the browser only posts the question and the club id. The
 * spreadsheet is resolved from the club document server-side, so this client cannot
 * point the function at a sheet the club does not own. If the endpoint is unavailable
 * (running `npm start` without `vercel dev`, missing key, network failure), callers
 * fall back to the local pattern matcher in archiveInsights.js.
 */

import { answerArchiveQuestion } from './archiveInsights';

export const ASK_ENDPOINT = '/api/ask-archive';

/** Thrown when the endpoint responds with an error we want surfaced verbatim. */
export class ArchiveAskError extends Error {
  constructor(message, { status, fallbackAvailable = true } = {}) {
    super(message);
    this.name = 'ArchiveAskError';
    this.status = status;
    this.fallbackAvailable = fallbackAvailable;
  }
}

/**
 * Ask Claude a question about a club's archive.
 *
 * @param {string} question
 * @param {{ clubId: string, signal?: AbortSignal }} options
 * @returns {Promise<{ title: string, body: string, source: 'ai' }>}
 */
export async function askArchiveAI(question, { clubId, signal } = {}) {
  if (!clubId) {
    throw new ArchiveAskError('No club in scope for this question.', { fallbackAvailable: false });
  }

  const res = await fetch(ASK_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ question, clubId }),
    signal,
  });

  // Anything that isn't a deployed function serves the SPA's index.html for /api/*,
  // so HTML here means the request never reached the function — either the CRA dev
  // server is handling it, or the function is missing from this deployment.
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new ArchiveAskError(
      `/api/ask-archive returned ${res.status} ${contentType || 'no content-type'} instead of JSON — ` +
        'the function is not running here. Locally use `vercel dev`; on Vercel check that it ' +
        'is listed under the deployment\'s Functions.',
      { status: res.status }
    );
  }

  const data = await res.json();

  if (!res.ok) {
    throw new ArchiveAskError(data.error || 'The archive assistant could not answer that.', {
      status: res.status,
    });
  }

  return { title: data.title, body: data.body, source: 'ai', usage: data.usage };
}

/**
 * Ask Claude, falling back to the local pattern matcher on any failure so the panel
 * usually produces something. The returned `source` says which path answered, and
 * `notice` carries the reason the AI path was skipped (if any).
 *
 * `archiveData` must be the calling club's own data — the caller passes null when all
 * it has is another club's bundled snapshot, and then the failure is surfaced instead
 * of answered from the wrong history.
 */
export async function askArchive(question, { clubId, archiveData, stats, signal } = {}) {
  try {
    return await askArchiveAI(question, { clubId, signal });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    if (!archiveData) throw err;

    const local = answerArchiveQuestion(question, archiveData, stats);
    return {
      ...local,
      source: 'local',
      notice: `${err.message} Showing an offline answer from the bundled snapshot instead.`,
    };
  }
}
