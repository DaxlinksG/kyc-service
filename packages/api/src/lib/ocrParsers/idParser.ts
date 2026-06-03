/**
 * Parse structured data from OCR text of non-MRZ identity documents:
 * Driver's licenses, National IDs, etc.
 * Handles Nigerian FRSC driver's licenses and general formats.
 */

export interface ParsedIdDocument {
  fullName?: string;
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string;
  documentNumber?: string;
  expiryDate?: string;
  issueDate?: string;
  isExpired?: boolean;
}

export function parseIdDocument(rawText: string): ParsedIdDocument {
  const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);
  const fullText = lines.join('\n');

  const documentNumber = extractDocumentNumber(fullText);
  const { dateOfBirth, expiryDate, issueDate } = extractDates(fullText, lines);
  const { fullName, firstName, lastName } = extractName(lines, fullText);

  const isExpired = expiryDate ? new Date(expiryDate) < new Date() : undefined;

  return { fullName, firstName, lastName, dateOfBirth, documentNumber, expiryDate, issueDate, isExpired };
}

/** Extract document/license number — alphanumeric, 6-15 chars. */
function extractDocumentNumber(text: string): string | undefined {
  // Labeled: "DL: 00942432", "DL:00942432", "Driver Licence No:", "License No:", "Licence #"
  const labeled = text.match(/(?:d\.?l\.?|driver'?s?\s+licen[cs]e?|licen[cs]e?|id|card)\s*[:\s#]+([A-Z0-9]{5,15})\b/i);
  if (labeled) return labeled[1]?.toUpperCase();

  // Nigerian FRSC DL format: DL + 9 digits e.g. DL109942432
  const frsc = text.match(/\bDL\d{7,10}\b/i);
  if (frsc) return frsc[0].toUpperCase();

  // Nigerian NIN: 11 digits
  const nin = text.match(/\bNIN[:\s]*(\d{11})\b/i);
  if (nin) return nin[1];

  // Standalone alphanumeric token that looks like an ID (mix of letters+digits, 7-12 chars)
  const tokens = text.match(/\b[A-Z]{1,3}\d{6,10}\b/g);
  if (tokens?.length) return tokens[0];

  return undefined;
}

const MONTH_MAP: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

/** Parse YYYYMMMDD or YYYY-Mon-DD or YYYY/Mon/DD where Mon is 3-letter month name (possibly truncated by OCR). */
function parseYearMonthDay(raw: string): string | null {
  // Full 3-letter month: 1993JUL30, 2029JAN18, 2025SEP05
  const full = raw.match(/^((?:19|20)\d{2})(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(\d{2})$/i);
  if (full) {
    const mon = MONTH_MAP[full[2]!.toLowerCase().slice(0, 3)];
    if (mon) return `${full[1]}-${mon}-${full[3]}`;
  }
  // Truncated by OCR to single letter: 1993J30 — ambiguous, assume month = position in document
  const single = raw.match(/^((?:19|20)\d{2})([A-Z])(\d{2})$/);
  if (single) {
    // Map single letter to likely month: J→Jul(7), F→Feb, M→Mar, A→Apr, S→Sep, O→Oct, N→Nov, D→Dec
    const singleMap: Record<string, string> = {
      J: '07', F: '02', M: '03', A: '04', S: '09', O: '10', N: '11', D: '12',
    };
    const mon = singleMap[single[2]!] ?? '01';
    return `${single[1]}-${mon}-${single[3]}`;
  }
  return null;
}

/** Extract dates — handles BC/Canadian YYYYMMMDD, Nigerian FRSC, and standard formats. */
function extractDates(text: string, lines: string[]): { dateOfBirth?: string; expiryDate?: string; issueDate?: string } {
  const allDates: string[] = [];

  // 1. Labeled dates (highest priority)
  let dateOfBirth: string | undefined;
  let issueDate: string | undefined;
  let expiryDate: string | undefined;

  const labeledPatterns: [RegExp, 'dob' | 'issue' | 'expiry'][] = [
    [/(?:date\s+of\s+birth|dob|born|birth\s+date)[:\s]+([A-Z0-9\-\/\.]{6,12})/i, 'dob'],
    [/(?:expiry|expiration|expires?|valid\s+(?:until|thru|to)|exp\.?)[:\s]+([A-Z0-9\-\/\.]{6,12})/i, 'expiry'],
    [/(?:issued?|issue\s+date|iss\.?)[:\s]+([A-Z0-9\-\/\.]{6,12})/i, 'issue'],
  ];
  for (const [pat, type] of labeledPatterns) {
    const m = text.match(pat);
    if (m?.[1]) {
      const parsed = parseDateString(m[1]);
      if (parsed) {
        if (type === 'dob') dateOfBirth = parsed;
        else if (type === 'expiry') expiryDate = parsed;
        else issueDate = parsed;
      }
    }
  }

  // 2. YYYYMMMDD pattern (BC/Canadian, Nigerian FRSC): 1993JUL30, 2025JAN18, 1993J30
  const ymdTokens = text.match(/\b((?:19|20)\d{2})[A-Z]{1,3}\d{2}\b/g) ?? [];
  for (const token of ymdTokens) {
    const parsed = parseYearMonthDay(token);
    if (parsed) allDates.push(parsed);
  }

  // 3. Standard date formats: DD/MM/YYYY, YYYY-MM-DD, MM/DD/YYYY
  const stdPatterns = [
    /\b(\d{4})[\/\-\.](\d{2})[\/\-\.](\d{2})\b/g,   // YYYY-MM-DD
    /\b(\d{2})[\/\-\.](\d{2})[\/\-\.](\d{4})\b/g,   // DD/MM/YYYY or MM/DD/YYYY
  ];
  for (const pat of stdPatterns) {
    let m: RegExpExecArray | null;
    while ((m = pat.exec(text)) !== null) {
      const [, a, b, c] = m;
      if (a && a.length === 4) allDates.push(`${a}-${b!.padStart(2, '0')}-${c!.padStart(2, '0')}`);
      else if (c && c.length === 4) allDates.push(`${c}-${b!.padStart(2, '0')}-${a!.padStart(2, '0')}`);
    }
  }

  // 4. DD Mon YYYY: "30 Jul 1993", "18 Jan 2025"
  const dMonY = text.matchAll(/\b(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+(\d{4})\b/gi);
  for (const m of dMonY) {
    const mon = MONTH_MAP[m[2]!.toLowerCase().slice(0, 3)];
    if (mon) allDates.push(`${m[3]}-${mon}-${m[1]!.padStart(2, '0')}`);
  }

  // Filter valid years
  const validDates = [...new Set(allDates)].filter(d => {
    const yr = parseInt(d.slice(0, 4));
    return yr >= 1940 && yr <= 2060;
  }).sort();

  // Assign by year heuristic if not already labeled
  for (const d of validDates) {
    const yr = parseInt(d.slice(0, 4));
    if (!dateOfBirth && yr <= 2005) dateOfBirth = d;
    else if (!issueDate && yr >= 2010 && yr <= 2026) issueDate = d;
    else if (!expiryDate && yr > 2026) expiryDate = d;
  }

  // If still no expiry, take the latest date
  if (!expiryDate && validDates.length >= 2) {
    expiryDate = validDates[validDates.length - 1];
  }

  return { dateOfBirth, expiryDate, issueDate };
}

function parseDateString(raw: string): string | null {
  const s = raw.trim();
  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // DD/MM/YYYY
  const dmy = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2]!.padStart(2,'0')}-${dmy[1]!.padStart(2,'0')}`;
  // YYYYMMMDD
  return parseYearMonthDay(s);
}

/** Extract name from OCR lines. */
function extractName(lines: string[], fullText: string): { fullName?: string; firstName?: string; lastName?: string } {
  // Labeled: "Name:", "Surname:", "Last Name:"
  const surnameLine = lines.find(l => /^(?:surname|last\s*name|family\s*name)[:\s]+(.+)/i.test(l));
  const firstLine = lines.find(l => /^(?:first\s*name|given\s*name|forename|other\s*names?)[:\s]+(.+)/i.test(l));

  if (surnameLine || firstLine) {
    const lastName = surnameLine?.match(/^(?:surname|last\s*name|family\s*name)[:\s]+(.+)/i)?.[1]?.trim();
    const firstName = firstLine?.match(/^(?:first\s*name|given\s*name|forename|other\s*names?)[:\s]+(.+)/i)?.[1]?.trim();
    const fullName = [lastName, firstName].filter(Boolean).join(' ') || undefined;
    return { fullName, firstName, lastName };
  }

  // Nigerian FRSC: name split across two lines — surname line then other names
  // Look for 2-3 consecutive lines of ALL-CAPS or Title Case words with no digits
  const nameLines: string[] = [];
  for (const line of lines) {
    if (line.length < 3 || line.length > 50) continue;
    if (/\d/.test(line)) continue;
    if (/^[A-Z][A-Z\s'\-]+$/.test(line) || /^[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*$/.test(line)) {
      // Exclude common non-name words
      if (/(?:NIGERIA|FEDERAL|REPUBLIC|DRIVER|LICENSE|LICENCE|ROAD|SAFETY|COMMISSION|FRSC|VALID|ISSUED|EXPIRE|CLASS|VEHICLE|STATE)/i.test(line)) continue;
      nameLines.push(line);
      if (nameLines.length === 2) break;
    }
  }

  if (nameLines.length >= 1) {
    const fullName = nameLines.join(' ').trim();
    const parts = fullName.split(/\s+/);
    const lastName = parts[0];
    const firstName = parts.slice(1).join(' ') || undefined;
    return { fullName, firstName, lastName };
  }

  return {};
}

function normalizeDate(raw: string): string {
  const dmy = raw.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2]!.padStart(2, '0')}-${dmy[1]!.padStart(2, '0')}`;
  return raw;
}
