import { describe, it, expect } from 'vitest';
import { parseMrz, extractMrzLines } from '../../src/lib/ocrParsers/mrzParser.js';

describe('MRZ Parser', () => {
  it('parses a valid TD3 (passport) MRZ', () => {
    // Sample TD3 MRZ for a fictional passport
    const line1 = 'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<';
    const line2 = 'L898902C36UTO7408122F1204159ZE184226B<<<<<10';

    const result = parseMrz([line1, line2]);
    expect(result).not.toBeNull();
    expect(result!.lastName).toBe('ERIKSSON');
    expect(result!.firstName).toBe('ANNA MARIA');
    expect(result!.documentNumber).toBe('L898902C3');
    expect(result!.nationality).toBe('UTO');
    expect(result!.dateOfBirth).toBe('1974-08-12');
  });

  it('detects MRZ lines from OCR text', () => {
    const ocrText = `
      REPUBLIC OF NOWHERE
      PASSPORT
      P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<
      L898902C36UTO7408122F1204159ZE184226B<<<<<10
    `;
    const lines = extractMrzLines(ocrText);
    expect(lines).not.toBeNull();
    expect(lines!.length).toBe(2);
  });

  it('returns null for text without MRZ', () => {
    const lines = extractMrzLines('Hello world\nThis is not an MRZ');
    expect(lines).toBeNull();
  });
});
