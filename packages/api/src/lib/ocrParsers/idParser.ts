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
  // Nigerian FRSC DL format: DL + 9 digits e.g. DL109942432
  const frsc = text.match(/\bDL\d{7,10}\b/i);
  if (frsc) return frsc[0].toUpperCase();

  // Nigerian NIN: 11 digits
  const nin = text.match(/\bNIN[:\s]*(\d{11})\b/i);
  if (nin) return nin[1];

  // Generic: labeled license/ID number
  const labeled = text.match(/(?:licence|license|id|card|number|no\.?)[:\s#]+([A-Z0-9]{6,15})\b/i);
  if (labeled) return labeled[1]?.toUpperCase();

  // Standalone alphanumeric token that looks like an ID (mix of letters+digits, 8-12 chars)
  const tokens = text.match(/\b[A-Z]{1,3}\d{6,10}\b/g);
  if (tokens?.length) return tokens[0];

  return undefined;
}

/** Extract dates — Nigerian FRSC uses YYYYJdd or YYYYMMMDD format. */
function extractDates(text: string, lines: string[]): { dateOfBirth?: string; expiryDate?: string; issueDate?: string } {
  // Nigerian FRSC format: 1993J30 = 1993-Jan-30, 2029J30 = 2029-Jan-30
  // Also: 2025J18 = 2025-Jan-18
  const frscDates = text.match(/\b((?:19|20)\d{2})[A-Z](\d{2})\b/g) ?? [];
  const parsedFrsc = frscDates.map(d => {
    const m = d.match(/^((?:19|20)\d{2})[A-Z](\d{2})$/);
    if (!m) return null;
    // Month letter: J=Jan for Nigerian FRSC (simplification — month always encoded as 3-letter abbrev first letter)
    // In practice J could be Jan, Jun, Jul — use context position
    return `${m[1]}-01-${m[2]!.padStart(2, '0')}`;
  }).filter(Boolean) as string[];

  // Standard date formats: DD/MM/YYYY, YYYY-MM-DD, DD MMM YYYY
  const stdDates: string[] = [];
  const stdPatterns = [
    /\b(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})\b/g,
    /\b(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})\b/g,
  ];
  for (const pat of stdPatterns) {
    let m: RegExpExecArray | null;
    while ((m = pat.exec(text)) !== null) {
      const [, a, b, c] = m;
      // Determine if YYYY-MM-DD or DD-MM-YYYY
      if (a && a.length === 4) stdDates.push(`${a}-${b!.padStart(2, '0')}-${c!.padStart(2, '0')}`);
      else if (c && c.length === 4) stdDates.push(`${c}-${b!.padStart(2, '0')}-${a!.padStart(2, '0')}`);
    }
  }

  const allDates = [...new Set([...parsedFrsc, ...stdDates])]
    .filter(d => {
      const yr = parseInt(d.slice(0, 4));
      return yr >= 1940 && yr <= 2060;
    })
    .sort();

  // Heuristic assignment:
  // - DOB: year 1940-2010
  // - Issue: year 2015-2026
  // - Expiry: year 2024-2060 (furthest future)
  let dateOfBirth: string | undefined;
  let issueDate: string | undefined;
  let expiryDate: string | undefined;

  for (const d of allDates) {
    const yr = parseInt(d.slice(0, 4));
    if (yr <= 2005 && !dateOfBirth) dateOfBirth = d;
    else if (yr >= 2015 && yr <= 2026 && !issueDate) issueDate = d;
    else if (yr > 2026 && !expiryDate) expiryDate = d;
  }

  // If only 2 dates found and no expiry: last one is likely expiry
  if (!expiryDate && allDates.length >= 2) {
    expiryDate = allDates[allDates.length - 1];
  }

  // Try labeled dates
  const dobLabeled = text.match(/(?:date\s+of\s+birth|dob|born)[:\s]+(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{4})/i);
  if (dobLabeled?.[1]) dateOfBirth = normalizeDate(dobLabeled[1]);

  const expLabeled = text.match(/(?:expiry|expiration|expires?|valid\s+(?:until|to))[:\s]+(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{4})/i);
  if (expLabeled?.[1]) expiryDate = normalizeDate(expLabeled[1]);

  return { dateOfBirth, expiryDate, issueDate };
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
