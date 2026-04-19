/**
 * Fetches the GVBL archive spreadsheet tabs directly from Google Sheets
 * and returns an archiveData-shaped object ready to save to Firestore.
 *
 * The sheet must be shared as "Anyone with the link can view".
 * Google's gviz/tq endpoint supports CORS for publicly shared sheets.
 */

const SHEET_ID = '19YcFZs8Q-FleLOjePIgHEFFJKnWstb0xBx8zsVpC-OE';

function csvUrl(sheetName) {
  return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;
}

/** Minimal but correct RFC-4180 CSV parser. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuote = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];
    if (inQuote) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; } // escaped quote
        inQuote = false;
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuote = true;
      } else if (ch === ',') {
        row.push(field); field = '';
      } else if (ch === '\r' && text[i + 1] === '\n') {
        row.push(field); field = ''; rows.push(row); row = []; i += 2; continue;
      } else if (ch === '\n' || ch === '\r') {
        row.push(field); field = ''; rows.push(row); row = [];
      } else {
        field += ch;
      }
    }
    i++;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

async function fetchSheet(sheetName) {
  const res = await fetch(csvUrl(sheetName));
  if (!res.ok) throw new Error(`Could not fetch sheet "${sheetName}" (${res.status}). Make sure the spreadsheet is shared as "Anyone with the link can view".`);
  const text = await res.text();
  return parseCsv(text);
}

function trim(s) { return String(s ?? '').trim(); }

function cleanName(s) {
  const t = trim(s);
  if (!t || t === '#N/A' || t === '#REF!' || t === '#VALUE!') return '';
  return t;
}

function rowHasAny(row, startCol = 0) {
  return row ? row.slice(startCol).some((c) => trim(c)) : false;
}

/**
 * Fetch all tabs from Google Sheets and parse into archiveData shape.
 * @returns {Promise<object>} archiveData-shaped object
 */
export async function fetchArchiveFromSheets() {
  // Fetch all tabs in parallel
  const [masterRows, allT, vl, mr] = await Promise.all([
    fetchSheet('Master List'),
    fetchSheet('All Tournaments'),
    fetchSheet('VLookups'),
    fetchSheet('Master Rules').catch(() => []), // optional tab
  ]);

  /* ---------- Master List ---------- */
  const masterList = [];
  for (let i = 1; i < masterRows.length; i++) {
    const row = masterRows[i];
    const name = trim(row[0]);
    if (!name) break;
    masterList.push({
      name,
      tournamentsPlayed: Number(row[1]) || 0,
      tournamentsWon:    Number(row[2]) || 0,
      runnersUp:         Number(row[3]) || 0,
      firstName:         trim(row[4]),
      lastName:          trim(row[5]),
      speciality:        trim(row[6]),
      position:          trim(row[7]),
      yankeeRating:      trim(row[9]),
      gvwRating:         trim(row[10]),
      height:            trim(row[11]),
    });
  }

  /* ---------- All Tournaments ---------- */
  const tournamentNamesFromAllT = (allT[0] || []).map((t) => trim(t)).filter(Boolean);
  const tournamentSignups = tournamentNamesFromAllT.map((name, colIdx) => {
    const signups = [];
    for (let r = 1; r < allT.length; r++) {
      const cell = cleanName(allT[r]?.[colIdx]);
      if (cell) signups.push(cell);
    }
    return { name, signups };
  });

  /* ---------- VLookups ---------- */
  const vlHeader = vl[0] || [];
  const tStart = 3;
  const vlTournamentNames = vlHeader.slice(tStart).map((t) => trim(t)).filter(Boolean);

  const winIdx = vl.findIndex((row) => trim(row?.[0]) === 'WINNERS');
  const runIdx = vl.findIndex((row) => trim(row?.[0]) === 'RUNNERS');
  const directoryEnd = winIdx >= 0 ? winIdx : vl.length;

  const directory = [];
  for (let i = 1; i < directoryEnd; i++) {
    const row = vl[i];
    if (!rowHasAny(row, tStart) && !trim(row?.[0]) && !trim(row?.[1])) continue;
    const raw       = trim(row[0]);
    const canonical = trim(row[1]) || raw;
    if (!canonical && !raw) continue;
    const tournamentsPlayed = Number(row[2]) || 0;
    const byTournament = {};
    vlTournamentNames.forEach((tn, j) => {
      const v = cleanName(row[tStart + j]);
      if (v) byTournament[tn] = v;
    });
    directory.push({ rawName: raw || canonical, canonicalName: canonical, tournamentsPlayed, appearances: byTournament });
  }

  function collectChampions(startRow, endRow) {
    const byTournament = {};
    vlTournamentNames.forEach((tn) => { byTournament[tn] = []; });
    for (let i = startRow; i < endRow; i++) {
      const row = vl[i];
      if (!row) continue;
      vlTournamentNames.forEach((tn, j) => {
        const v = cleanName(row[tStart + j]);
        if (v) byTournament[tn].push(v);
      });
    }
    return byTournament;
  }

  const champions = {
    winners:
      winIdx >= 0 && runIdx > winIdx ? collectChampions(winIdx + 1, runIdx) : {},
    runnersUp:
      runIdx >= 0 ? collectChampions(runIdx + 1, Math.min(runIdx + 15, vl.length)) : {},
  };

  /* ---------- Master Rules (optional) ---------- */
  const rules = mr
    .filter((row) => trim(row[1]) || trim(row[0]))
    .map((row) => ({ ref: trim(row[0]), text: trim(row[1]) }));

  return {
    generatedAt:     new Date().toISOString(),
    sourceFile:      'Google Sheets (live)',
    masterList,
    tournamentSignups,
    directory,
    tournamentNames: vlTournamentNames,
    champions,
    rules,
  };
}
