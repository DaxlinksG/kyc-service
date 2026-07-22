/**
 * Parses AAMVA-standard PDF417 barcode data from North American driver's licenses
 * and provincial/state ID cards.
 *
 * The barcode is decoded client-side (in the widget, via zxing-wasm) and the raw
 * decoded string is POSTed to the API. This module is the single source of truth
 * for turning that raw string into structured, checksum-free identity fields.
 *
 * Reference: AAMVA DL/ID Card Design Standard (2020), Annex D "Mandatory PDF417 Bar Code".
 * Every Canadian province/territory and US state issues DLs and ID cards carrying this
 * barcode on the back, so a single parser covers all jurisdictions.
 */

export interface AamvaData {
  firstName: string;
  middleName?: string;
  lastName: string;
  fullName: string;
  dateOfBirth: string; // YYYY-MM-DD
  expiryDate: string; // YYYY-MM-DD
  issueDate?: string; // YYYY-MM-DD
  documentNumber: string;
  country: string; // 'CAN' | 'USA'
  province?: string; // jurisdiction code, e.g. 'ON', 'BC', 'QC', 'NY'
  addressLine1?: string;
  city?: string;
  postalCode?: string;
  isExpired: boolean;
  valid: boolean; // true when the string parsed as a plausible AAMVA record
}

// AAMVA data element identifiers we consume. Each element occupies its own
// LF-separated line inside a subfile (see parseElements below).
const KNOWN_CODES = new Set([
  'DCS', 'DAB', // family / last name (DAB is the legacy code)
  'DAC', 'DCT', // first / given name(s)
  'DAD', // middle name(s)
  'DAA', // full name (older, comma-delimited "LAST,FIRST,MID")
  'DBB', // date of birth
  'DBA', // expiry
  'DBD', // issue date
  'DAQ', // customer id / licence number
  'DCG', // country
  'DAJ', // jurisdiction (state / province) code
  'DAG', // street address 1
  'DAH', // street address 2
  'DAI', // city
  'DAK', // postal code
]);

const CANADIAN_PROVINCES = new Set([
  'AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT',
]);

/**
 * Split the raw barcode into AAMVA data elements.
 *
 * Elements are separated by the LF (0x0A) data-element separator; subfiles by the
 * RS (0x1E) record separator and CR (0x0D) segment terminator, giving one element
 * per segment. The exception is the first element of a subfile, which is glued to
 * the header/subfile-designator block (e.g. "ANSI...DLDAQ12345"). To recover it we
 * scan each segment for the first known 3-char element code and take the remainder
 * as its value. None of the codes we consume collide with the header text, so this
 * safely ignores the "ANSI", IIN and subfile-designator noise. First code wins.
 */
function parseElements(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  const segments = raw
    .split(/[\n\r\x1e\x1c\x1d]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  for (const seg of segments) {
    // Normal case: a data element occupies its own segment and begins at offset 0
    // with its 3-char code. Anchoring here avoids mistaking an arbitrary substring
    // of a field VALUE (e.g. an address containing the letters "DAI") for a code.
    const code0 = seg.slice(0, 3);
    if (KNOWN_CODES.has(code0)) {
      if (!(code0 in out)) out[code0] = seg.slice(3).trim();
      continue;
    }
    // Exception: the first element of a subfile is glued to the header/subfile
    // designator block (e.g. "ANSI...DLDAQ12345"). Only for that header segment do
    // we scan for the first embedded known code and take the remainder as its value.
    if (/ANSI/.test(seg)) {
      for (let i = 0; i + 3 <= seg.length; i++) {
        const code = seg.slice(i, i + 3);
        if (KNOWN_CODES.has(code)) {
          if (!(code in out)) out[code] = seg.slice(i + 3).trim();
          break;
        }
      }
    }
  }
  return out;
}

/**
 * Parse an 8-digit AAMVA date. US jurisdictions encode MMDDCCYY; Canadian
 * jurisdictions encode CCYYMMDD. We try the country's expected order first and
 * fall back to the other if the result isn't a plausible calendar date.
 */
function parseAamvaDate(raw: string | undefined, country: string): string {
  if (!raw) return '';
  const d = raw.replace(/\D/g, '');
  if (d.length !== 8) return '';

  const orders: ('MDY' | 'YMD')[] = country === 'USA' ? ['MDY', 'YMD'] : ['YMD', 'MDY'];
  for (const order of orders) {
    let yyyy: string, mm: string, dd: string;
    if (order === 'MDY') {
      mm = d.slice(0, 2);
      dd = d.slice(2, 4);
      yyyy = d.slice(4, 8);
    } else {
      yyyy = d.slice(0, 4);
      mm = d.slice(4, 6);
      dd = d.slice(6, 8);
    }
    const mi = parseInt(mm, 10);
    const di = parseInt(dd, 10);
    const yi = parseInt(yyyy, 10);
    if (mi >= 1 && mi <= 12 && di >= 1 && di <= 31 && yi >= 1900 && yi <= 2100) {
      return `${yyyy}-${mm}-${dd}`;
    }
  }
  return '';
}

function normalizePostal(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  // Canadian postal codes are 6 alphanumerics; AAMVA often pads to a fixed width.
  const compact = raw.replace(/\s+/g, '').toUpperCase();
  const ca = compact.match(/^([A-Z]\d[A-Z]\d[A-Z]\d)/);
  if (ca) return `${ca[1]!.slice(0, 3)} ${ca[1]!.slice(3)}`;
  const us = compact.match(/^(\d{5})(\d{4})?/);
  if (us) return us[2] ? `${us[1]}-${us[2]}` : us[1]!;
  return compact || undefined;
}

/** True when the raw string carries the AAMVA header signature. */
export function looksLikeAamva(raw: string): boolean {
  return /ANSI\s?\d/.test(raw) || raw.trimStart().startsWith('@');
}

export function parseAamva(raw: string): AamvaData | null {
  if (!raw || !looksLikeAamva(raw)) return null;

  const el = parseElements(raw);

  // Country: explicit DCG, else infer from jurisdiction, else default to USA.
  const province = (el['DAJ'] || '').toUpperCase() || undefined;
  let country = (el['DCG'] || '').toUpperCase();
  if (country !== 'CAN' && country !== 'USA') {
    country = province && CANADIAN_PROVINCES.has(province) ? 'CAN' : 'USA';
  }

  // Name: prefer discrete fields, fall back to the legacy comma-delimited DAA.
  let lastName = el['DCS'] || el['DAB'] || '';
  let firstName = el['DAC'] || el['DCT'] || '';
  let middleName = el['DAD'] || '';
  if ((!lastName || !firstName) && el['DAA']) {
    const parts = el['DAA'].split(',').map((p) => p.trim());
    lastName = lastName || parts[0] || '';
    firstName = firstName || parts[1] || '';
    middleName = middleName || parts[2] || '';
  }
  // "NONE" is the AAMVA sentinel for an absent middle name.
  if (/^none$/i.test(middleName)) middleName = '';

  lastName = lastName.replace(/\s+/g, ' ').trim();
  firstName = firstName.replace(/\s+/g, ' ').trim();
  middleName = middleName.replace(/\s+/g, ' ').trim();

  // fullName intentionally excludes the middle name so it matches the "first last"
  // shape the MRZ pipeline produces — keeping identity matching/hashing consistent
  // across barcode and MRZ documents. middleName is still exposed as its own field.
  const fullName = [firstName, lastName].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();

  const dateOfBirth = parseAamvaDate(el['DBB'], country);
  const expiryDate = parseAamvaDate(el['DBA'], country);
  const issueDate = parseAamvaDate(el['DBD'], country);
  const documentNumber = (el['DAQ'] || '').trim();

  // Compare date-only strings (YYYY-MM-DD) to avoid the timezone skew that
  // `new Date('YYYY-MM-DD')` (parsed as UTC midnight) introduces near the boundary.
  const isExpired = expiryDate ? expiryDate < new Date().toISOString().slice(0, 10) : false;

  // Valid = we recovered a real identity: surname, given name, and date of birth.
  // Requiring all three rejects header/garbage strings that happen to yield a stray
  // field, so only a genuine AAMVA record earns the high-confidence path.
  const valid = !!(lastName && firstName && dateOfBirth);

  const data: AamvaData = {
    firstName,
    lastName,
    fullName,
    dateOfBirth,
    expiryDate,
    documentNumber,
    country,
    isExpired,
    valid,
  };
  if (middleName) data.middleName = middleName;
  if (issueDate) data.issueDate = issueDate;
  if (province) data.province = province;
  if (el['DAG']) data.addressLine1 = el['DAG'].trim();
  if (el['DAI']) data.city = el['DAI'].trim();
  const postal = normalizePostal(el['DAK']);
  if (postal) data.postalCode = postal;

  return data;
}
