/**
 * Parses Machine Readable Zone (MRZ) from OCR text output.
 * Supports TD1 (ID cards, 3 lines x 30 chars) and TD3 (passports, 2 lines x 44 chars).
 */

export interface MrzData {
  documentType: string;
  documentNumber: string;
  nationality: string;
  dateOfBirth: string; // YYYY-MM-DD
  expiryDate: string;  // YYYY-MM-DD
  lastName: string;
  firstName: string;
  isExpired: boolean;
  checksumsValid: boolean;
}

/**
 * Normalize a raw OCR line to clean MRZ characters.
 * Tesseract often misreads < as L, (, [, |, etc.
 */
function normalizeMrzLine(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/\s+/g, '')           // remove all whitespace
    .replace(/[(\[{|¢]/g, '<')    // common OCR misreads of <
    .replace(/O(?=\d)/g, '0')      // letter O before digit → 0 (in numeric fields)
    .replace(/(?<=\d)O/g, '0')     // letter O after digit → 0
    .replace(/L{3,}/g, m => '<'.repeat(m.length)); // 3+ consecutive Ls → < (padding misread)
}

/** Extract MRZ lines from raw OCR text. */
export function extractMrzLines(text: string): string[] | null {
  const candidates: string[] = [];

  for (const rawLine of text.split('\n')) {
    const normalized = normalizeMrzLine(rawLine);
    // Find the longest run of valid MRZ chars within this line
    const match = normalized.match(/[A-Z0-9<]{28,}/);
    if (match) {
      candidates.push(match[0]);
    }
  }

  // TD3: 2 lines of exactly 44 chars (passport)
  const td3 = candidates
    .filter(l => l.length >= 43 && l.length <= 46)
    .map(l => l.slice(0, 44).padEnd(44, '<'));
  if (td3.length >= 2) return td3.slice(0, 2);

  // TD1: 3 lines of exactly 30 chars (ID card)
  const td1 = candidates
    .filter(l => l.length >= 29 && l.length <= 32)
    .map(l => l.slice(0, 30).padEnd(30, '<'));
  if (td1.length >= 3) return td1.slice(0, 3);

  return null;
}

export function parseMrz(mrzLines: string[]): MrzData | null {
  if (mrzLines.length === 2 && mrzLines[0]!.length === 44) {
    return parseTD3(mrzLines[0]!, mrzLines[1]!);
  }
  if (mrzLines.length === 3 && mrzLines[0]!.length === 30) {
    return parseTD1(mrzLines[0]!, mrzLines[1]!, mrzLines[2]!);
  }
  return null;
}

function parseTD3(line1: string, line2: string): MrzData {
  const documentType = line1.slice(0, 2).replace(/<+$/, '');
  const nationality = line1.slice(2, 5).replace(/<+/g, '');
  const rawName = line1.slice(5, 44);
  const { lastName, firstName } = parseName(rawName);

  const documentNumber = line2.slice(0, 9).replace(/<+$/, '');
  const dob = parseMrzDate(line2.slice(13, 19));
  const expiry = parseMrzDate(line2.slice(20, 26));
  const checksums = validateTD3Checksums(line1, line2);

  return {
    documentType,
    documentNumber,
    nationality,
    dateOfBirth: dob,
    expiryDate: expiry,
    lastName,
    firstName,
    isExpired: isExpiredDate(expiry),
    checksumsValid: checksums,
  };
}

function parseTD1(line1: string, line2: string, line3: string): MrzData {
  const documentType = line1.slice(0, 2).replace(/<+$/, '');
  const nationality = line1.slice(2, 5).replace(/<+/g, '');
  const documentNumber = line1.slice(5, 14).replace(/<+$/, '');

  const dob = parseMrzDate(line2.slice(0, 6));
  const expiry = parseMrzDate(line2.slice(8, 14));

  const { lastName, firstName } = parseName(line3);

  return {
    documentType,
    documentNumber,
    nationality,
    dateOfBirth: dob,
    expiryDate: expiry,
    lastName,
    firstName,
    isExpired: isExpiredDate(expiry),
    checksumsValid: true,
  };
}

function parseName(rawName: string): { lastName: string; firstName: string } {
  // Normalize remaining L-for-< misreads in padding area (3+ consecutive Ls)
  const normalized = rawName.replace(/L{3,}/g, m => '<'.repeat(m.length));
  const parts = normalized.split('<<');
  const lastName = (parts[0] ?? '').replace(/</g, ' ').trim();
  const firstName = (parts[1] ?? '').replace(/</g, ' ').trim();
  return { lastName, firstName };
}

function parseMrzDate(yymmdd: string): string {
  if (!/^\d{6}$/.test(yymmdd)) return '';
  const yy = parseInt(yymmdd.slice(0, 2), 10);
  const mm = yymmdd.slice(2, 4);
  const dd = yymmdd.slice(4, 6);
  const yyyy = yy < 30 ? 2000 + yy : 1900 + yy;
  return `${yyyy}-${mm}-${dd}`;
}

function isExpiredDate(dateStr: string): boolean {
  if (!dateStr) return false;
  return new Date(dateStr) < new Date();
}

function mrzCheckDigit(input: string): number {
  const weights = [7, 3, 1];
  const charValues: Record<string, number> = { '<': 0 };
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').forEach((c, i) => {
    charValues[c] = i + 10;
  });
  return (
    input.split('').reduce((sum, char, i) => {
      const val = /\d/.test(char) ? parseInt(char, 10) : (charValues[char] ?? 0);
      return sum + val * (weights[i % 3] ?? 1);
    }, 0) % 10
  );
}

function validateTD3Checksums(line1: string, line2: string): boolean {
  const docNumOk = mrzCheckDigit(line2.slice(0, 9)) === parseInt(line2[9] ?? '-1', 10);
  const dobOk = mrzCheckDigit(line2.slice(13, 19)) === parseInt(line2[19] ?? '-1', 10);
  const expiryOk = mrzCheckDigit(line2.slice(20, 26)) === parseInt(line2[26] ?? '-1', 10);
  return docNumOk && dobOk && expiryOk;
}
