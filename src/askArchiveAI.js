/**
 * Client for the /api/ask-archive Vercel Function.
 *
 * No API key lives here — the browser only posts the question string. If the endpoint
 * is unavailable (running `npm start` without `vercel dev`, missing key, network
 * failure), callers fall back to the local pattern matcher in archiveInsights.js.
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
 * Ask Claude a question about the archive.
 *
 * @param {string} question
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<{ title: string, body: string, source: 'ai' }>}
 */
export async function askArchiveAI(question, { signal } = {}) {
  const res = await fetch(ASK_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ question }),
    signal,
  });

  // A CRA dev server with no function runtime returns index.html for /api/*.
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new ArchiveAskError('The archive assistant is not running on this environment.', {
      status: res.status,
    });
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
 * always produces something. The returned `source` says which path answered, and
 * `notice` carries the reason the AI path was skipped (if any).
 */
export async function askArchive(question, archiveData, stats, { signal } = {}) {
  try {
    return await askArchiveAI(question, { signal });
  } catch (err) {
    if (err.name === 'AbortError') throw err;

    const local = answerArchiveQuestion(question, archiveData, stats);
    return {
      ...local,
      source: 'local',
      notice: `${err.message} Showing an offline answer from the bundled snapshot instead.`,
    };
  }
}
