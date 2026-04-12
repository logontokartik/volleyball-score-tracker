/**
 * Reads the GVBL signup workbook and writes src/data/archiveData.json
 * Usage: node scripts/import-archive.mjs [path/to/file.xlsx]
 */
import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const xlsxPath = process.argv[2] || process.env.ARCHIVE_XLSX;
if (!xlsxPath) {
  console.error('Usage: node scripts/import-archive.mjs <path-to-workbook.xlsx>');
  console.error('   or: ARCHIVE_XLSX=/path/to/file.xlsx node scripts/import-archive.mjs');
  process.exit(1);
}

function trim(s) {
  return String(s ?? '').trim();
}

function cleanName(s) {
  const t = trim(s);
  if (!t || t === '#N/A' || t === '#REF!' || t === '#VALUE!') return '';
  return t;
}

function rowHasAny(row, startCol = 0) {
  if (!row) return false;
  return row.slice(startCol).some((c) => trim(c));
}

const wb = XLSX.readFile(xlsxPath, { cellDates: true });

/* --- Master List --- */
const masterRows = XLSX.utils.sheet_to_json(wb.Sheets['Master List'], {
  header: 1,
  defval: '',
});
const masterHeader = masterRows[0] || [];
const masterList = [];
for (let i = 1; i < masterRows.length; i++) {
  const row = masterRows[i];
  const name = trim(row[0]);
  if (!name) break;
  masterList.push({
    name,
    tournamentsPlayed: Number(row[1]) || 0,
    tournamentsWon: Number(row[2]) || 0,
    runnersUp: Number(row[3]) || 0,
    firstName: trim(row[4]),
    lastName: trim(row[5]),
    speciality: trim(row[6]),
    position: trim(row[7]),
    yankeeRating: trim(row[9]),
    gvwRating: trim(row[10]),
    height: trim(row[11]),
  });
}

/* --- All Tournaments (signups grid) --- */
const allT = XLSX.utils.sheet_to_json(wb.Sheets['All Tournaments'], {
  header: 1,
  defval: '',
});
const tournamentNames = (allT[0] || []).map((t) => trim(t)).filter(Boolean);
const tournamentSignups = tournamentNames.map((name, colIdx) => {
  const signups = [];
  for (let r = 1; r < allT.length; r++) {
    const cell = cleanName(allT[r]?.[colIdx]);
    if (cell) signups.push(cell);
  }
  return { name, signups };
});

/* --- VLookups --- */
const vl = XLSX.utils.sheet_to_json(wb.Sheets['VLookups'], {
  header: 1,
  defval: '',
});
const vlHeader = vl[0] || [];
const tStart = 3;
const vlTournamentNames = vlHeader.slice(tStart).map((t) => trim(t)).filter(Boolean);

const winIdx = vl.findIndex((row) => trim(row?.[0]) === 'WINNERS');
const runIdx = vl.findIndex((row) => trim(row?.[0]) === 'RUNNERS');
const directoryEnd = winIdx >= 0 ? winIdx : vl.length;

const directory = [];
for (let i = 1; i < directoryEnd; i++) {
  const row = vl[i];
  if (!rowHasAny(row, tStart) && !trim(row[0]) && !trim(row[1])) continue;
  const raw = trim(row[0]);
  const canonical = trim(row[1]) || raw;
  if (!canonical && !raw) continue;
  const tournamentsPlayed = Number(row[2]) || 0;
  const byTournament = {};
  vlTournamentNames.forEach((tn, j) => {
    const v = cleanName(row[tStart + j]);
    if (v) byTournament[tn] = v;
  });
  directory.push({
    rawName: raw || canonical,
    canonicalName: canonical,
    tournamentsPlayed,
    appearances: byTournament,
  });
}

function collectChampions(startRow, endRow) {
  const byTournament = {};
  vlTournamentNames.forEach((tn) => {
    byTournament[tn] = [];
  });
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
    winIdx >= 0 && runIdx > winIdx
      ? collectChampions(winIdx + 1, runIdx)
      : {},
  runnersUp:
    runIdx >= 0
      ? collectChampions(runIdx + 1, Math.min(runIdx + 15, vl.length))
      : {},
};

/* --- Master Rules --- */
let rules = [];
if (wb.SheetNames.includes('Master Rules')) {
  const mr = XLSX.utils.sheet_to_json(wb.Sheets['Master Rules'], {
    header: 1,
    defval: '',
  });
  rules = mr
    .filter((row) => trim(row[1]) || trim(row[0]))
    .map((row) => ({
      ref: trim(row[0]),
      text: trim(row[1]),
    }));
}

const out = {
  generatedAt: new Date().toISOString(),
  sourceFile: path.basename(xlsxPath),
  masterList,
  tournamentSignups,
  directory,
  tournamentNames: vlTournamentNames,
  champions,
  rules,
};

const outDir = path.join(root, 'src', 'data');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'archiveData.json');
fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
console.log('Wrote', outPath, {
  masterPlayers: masterList.length,
  tournaments: tournamentSignups.length,
  directoryRows: directory.length,
});
