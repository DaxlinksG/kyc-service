import type { ParsedAddress } from '../../types/domain.js';

/**
 * Extract structured address data from raw OCR text.
 * Supports Nigerian, UK, US and general international document formats.
 */
export function parseAddressDocument(text: string): ParsedAddress {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const fullText = lines.join('\n');

  return {
    fullName: extractName(lines),
    addressLine1: extractAddressLine1(lines),
    addressLine2: extractAddressLine2(lines),
    city: extractCity(lines, fullText),
    postcode: extractPostcode(fullText),
    issueDate: extractIssueDate(fullText),
  };
}

function extractName(lines: string[]): string | undefined {
  // 1. Explicit label: "Name:", "Account Name:", "Customer:", "Account Holder:"
  const labelPatterns = [
    /^(?:account\s+(?:name|holder)|customer(?:\s+name)?|name|client|beneficiary)[:\s]+([A-Za-z][\w\s'\-\.]{3,40})$/i,
  ];
  for (const line of lines) {
    for (const pat of labelPatterns) {
      const m = line.match(pat);
      if (m?.[1]) return m[1].trim();
    }
  }

  // 2. Title-prefixed: Mr/Mrs/Ms/Dr/Prof
  const prefixed = lines.find((l) => /^(Mr\.?|Mrs\.?|Ms\.?|Dr\.?|Prof\.?)\s+[A-Z]/i.test(l));
  if (prefixed) return prefixed.replace(/^(Mr\.?|Mrs\.?|Ms\.?|Dr\.?|Prof\.?)\s+/i, '').trim();

  // 3. Standalone name line: 2-4 capitalized words, no digits, reasonable length
  // Accept all-caps (common on bank statements) or title case
  for (const line of lines.slice(0, 20)) {
    if (line.length < 5 || line.length > 60) continue;
    if (/\d/.test(line)) continue;
    // Title case: "David Adeleke" or "DAVID ADELEKE"
    if (/^[A-Z][A-Za-z'\-]+(?:\s+[A-Z][A-Za-z'\-]+){1,3}$/.test(line)) {
      // Exclude common non-name lines
      const lower = line.toLowerCase();
      if (/(?:bank|statement|account|address|street|road|avenue|limited|ltd|plc|services|nigeria|lagos|abuja)/.test(lower)) continue;
      return line;
    }
  }

  return undefined;
}

function extractAddressLine1(lines: string[]): string | undefined {
  // 1. Explicit label
  const labeled = lines.find((l) =>
    /^(?:address|residential\s+address|billing\s+address|mailing\s+address)[:\s]+(.+)/i.test(l),
  );
  if (labeled) {
    const m = labeled.match(/^(?:address|residential\s+address|billing\s+address|mailing\s+address)[:\s]+(.+)/i);
    if (m?.[1]) return m[1].trim();
  }

  // 2. Line starting with a number (street/house number) — international format
  const numbered = lines.find((l) =>
    /^\d+[A-Za-z]?[,\s]+[A-Za-z]/.test(l) && l.length > 8,
  );
  if (numbered) return numbered;

  // 3. Nigerian format: "No. 5, Adeola Odeku Street" or "Plot 10, Block C"
  const ng = lines.find((l) =>
    /^(?:no\.?\s*\d+|plot\s+\d+|flat\s+\d+|house\s+\d+|block\s+[A-Z0-9]+)/i.test(l),
  );
  if (ng) return ng;

  return undefined;
}

function extractAddressLine2(lines: string[]): string | undefined {
  const idx = lines.findIndex((l) => {
    if (/^\d+[A-Za-z]?[,\s]+[A-Za-z]/.test(l) && l.length > 8) return true;
    if (/^(?:no\.?\s*\d+|plot\s+\d+|flat\s+\d+|house\s+\d+)/i.test(l)) return true;
    return false;
  });
  if (idx === -1 || idx + 1 >= lines.length) return undefined;
  const next = lines[idx + 1];
  if (!next) return undefined;
  if (/^\d{4,}/.test(next)) return undefined; // looks like a postcode/number
  if (next.length < 4) return undefined;
  return next;
}

function extractCity(lines: string[], fullText: string): string | undefined {
  // 1. Nigerian cities — look for known city names
  const ngCities = ['Lagos', 'Abuja', 'Kano', 'Ibadan', 'Port Harcourt', 'Benin City',
    'Kaduna', 'Enugu', 'Owerri', 'Calabar', 'Warri', 'Ilorin', 'Abeokuta', 'Onitsha', 'Victoria Island', 'Lekki'];
  for (const city of ngCities) {
    if (new RegExp(`\\b${city}\\b`, 'i').test(fullText)) return city;
  }

  // 2. Line after the address line
  const addrIdx = lines.findIndex((l) =>
    /^\d+[A-Za-z]?[,\s]+[A-Za-z]/.test(l) ||
    /^(?:no\.?\s*\d+|plot\s+\d+)/i.test(l),
  );
  if (addrIdx !== -1) {
    for (let i = addrIdx + 1; i <= addrIdx + 3 && i < lines.length; i++) {
      const l = lines[i]!;
      if (/^[A-Z][a-zA-Z\s]{3,30}$/.test(l) && !/\d/.test(l)) return l;
    }
  }

  // 3. UK city before postcode
  const ukMatch = fullText.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s*\n?\s*[A-Z]{1,2}\d/);
  if (ukMatch?.[1]) return ukMatch[1];

  return undefined;
}

function extractPostcode(text: string): string | undefined {
  // Nigerian postal code (6 digits)
  const ng = text.match(/\b(\d{6})\b/);
  if (ng) return ng[1];

  // UK postcode
  const uk = text.match(/\b([A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2})\b/i);
  if (uk) return uk[1]?.toUpperCase();

  // US ZIP
  const us = text.match(/\b(\d{5}(?:-\d{4})?)\b/);
  if (us) return us[1];

  return undefined;
}

function extractIssueDate(text: string): string | undefined {
  const patterns = [
    /(?:statement\s+date|dated|issue\s+date|billing\s+date|date\s+of\s+issue|as\s+at|date)[:\s]+(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/i,
    /(?:statement\s+date|dated|issue\s+date|billing\s+date|date\s+of\s+issue|as\s+at|date)[:\s]+(\d{1,2}\s+\w+\s+\d{4})/i,
    /(?:statement\s+date|dated|issue\s+date|billing\s+date|date\s+of\s+issue|as\s+at|date)[:\s]+(\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2})/i,
    // Standalone date near top of document (first 500 chars)
    /(?:^|\n)(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{4})(?:\n|$)/m,
    /(?:^|\n)(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+\d{4})(?:\n|$)/im,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return normalizeDate(match[1]);
  }
  return undefined;
}

function normalizeDate(raw: string): string {
  const cleaned = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) return cleaned;

  const dmy = cleaned.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
  if (dmy) {
    const [, d, m, y] = dmy;
    return `${y}-${m!.padStart(2, '0')}-${d!.padStart(2, '0')}`;
  }

  const dMonY = cleaned.match(/^(\d{1,2})\s+(\w+)\s+(\d{4})$/);
  if (dMonY) {
    const months: Record<string, string> = {
      jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
      jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
    };
    const [, d, mon, y] = dMonY;
    const m = months[mon!.toLowerCase().slice(0, 3)];
    if (m) return `${y}-${m}-${d!.padStart(2, '0')}`;
  }

  return cleaned;
}

/** Fuzzy name match score (0-1) using normalized Levenshtein distance. */
export function nameMatchScore(a: string, b: string): number {
  if (!a || !b) return 0;
  const na = a.toLowerCase().replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim();
  const nb = b.toLowerCase().replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim();
  if (na === nb) return 1;

  // Also try matching individual name tokens (handles reordered names)
  const tokensA = na.split(' ');
  const tokensB = nb.split(' ');
  const tokenOverlap = tokensA.filter(t => t.length > 1 && tokensB.includes(t)).length;
  const tokenScore = tokenOverlap / Math.max(tokensA.length, tokensB.length);
  if (tokenScore >= 0.5) return Math.max(tokenScore, 0.7);

  const dist = levenshtein(na, nb);
  const maxLen = Math.max(na.length, nb.length);
  return maxLen === 0 ? 1 : 1 - dist / maxLen;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i]![j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1]![j - 1]!
          : 1 + Math.min(dp[i - 1]![j]!, dp[i]![j - 1]!, dp[i - 1]![j - 1]!);
    }
  }
  return dp[m]![n]!;
}
