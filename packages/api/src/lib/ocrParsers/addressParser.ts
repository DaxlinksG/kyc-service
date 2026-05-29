import type { ParsedAddress } from '../../types/domain.js';

/**
 * Extract structured address data from raw OCR text.
 * Uses heuristic regex patterns for common document formats.
 */
export function parseAddressDocument(text: string): ParsedAddress {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const fullText = lines.join('\n');

  return {
    fullName: extractName(lines),
    addressLine1: extractAddressLine1(lines),
    addressLine2: extractAddressLine2(lines),
    city: extractCity(fullText),
    postcode: extractPostcode(fullText),
    issueDate: extractIssueDate(fullText),
  };
}

function extractName(lines: string[]): string | undefined {
  // Look for lines that match a name pattern (2-3 capitalized words, no numbers)
  for (const line of lines.slice(0, 10)) {
    if (/^[A-Z][a-z]+ [A-Z][a-z]+( [A-Z][a-z]+)?$/.test(line)) {
      return line;
    }
  }
  // Mr/Mrs/Ms prefix
  const prefixed = lines.find((l) => /^(Mr|Mrs|Ms|Dr|Prof)\.\s+[A-Z]/i.test(l));
  return prefixed?.replace(/^(Mr|Mrs|Ms|Dr|Prof)\.\s+/i, '');
}

function extractAddressLine1(lines: string[]): string | undefined {
  // Look for lines with a street number + street name
  return lines.find((l) =>
    /^\d+[a-z]?\s+[A-Za-z\s]+(Street|St|Road|Rd|Avenue|Ave|Lane|Ln|Drive|Dr|Way|Close|Cl|Court|Ct)\b/i.test(l),
  );
}

function extractAddressLine2(lines: string[]): string | undefined {
  const idx = lines.findIndex((l) =>
    /^\d+[a-z]?\s+[A-Za-z\s]+(Street|St|Road|Rd|Avenue|Ave|Lane|Ln|Drive|Dr|Way|Close|Cl|Court|Ct)\b/i.test(l),
  );
  if (idx === -1 || idx + 1 >= lines.length) return undefined;
  const next = lines[idx + 1];
  // Skip if next line looks like a postcode or city-only
  if (next && !/^\d/.test(next) && next.length > 3 && !/[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}/.test(next)) {
    return next;
  }
  return undefined;
}

function extractCity(text: string): string | undefined {
  // UK format: look for a word preceding a postcode
  const match = text.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s*\n?\s*[A-Z]{1,2}\d/);
  return match?.[1];
}

function extractPostcode(text: string): string | undefined {
  // UK postcode
  const uk = text.match(/\b([A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2})\b/i);
  if (uk) return uk[1]?.toUpperCase().replace(/\s/, ' ');

  // US ZIP
  const us = text.match(/\b(\d{5}(?:-\d{4})?)\b/);
  return us?.[1];
}

function extractIssueDate(text: string): string | undefined {
  // Patterns: "Statement Date: 01 Jan 2024", "Dated: 2024-01-15", "Issue Date 15/01/2024"
  const patterns = [
    /(?:statement\s+date|dated|issue\s+date|billing\s+date)[:\s]+(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/i,
    /(?:statement\s+date|dated|issue\s+date|billing\s+date)[:\s]+(\d{1,2}\s+\w+\s+\d{4})/i,
    /(?:statement\s+date|dated|issue\s+date|billing\s+date)[:\s]+(\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2})/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return normalizeDate(match[1]);
    }
  }
  return undefined;
}

function normalizeDate(raw: string): string {
  // Try to parse various date formats into YYYY-MM-DD
  const cleaned = raw.trim();

  // ISO format already
  if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) return cleaned;

  // DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY
  const dmy = cleaned.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
  if (dmy) {
    const [, d, m, y] = dmy;
    return `${y}-${m!.padStart(2, '0')}-${d!.padStart(2, '0')}`;
  }

  // DD Mon YYYY
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
