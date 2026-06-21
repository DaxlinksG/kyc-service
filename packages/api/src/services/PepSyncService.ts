/**
 * PepSyncService — downloads and indexes free public sanctions/PEP lists.
 *
 * Sources:
 *   OFAC SDN (US Treasury) — https://www.treasury.gov/ofac/downloads/sdn.xml
 *   UN Consolidated Sanctions — https://scsanctions.un.org/resources/xml/en/consolidated.xml
 *
 * Both are public domain, no API key needed.
 * Sync should be scheduled weekly (SYNC_PEP_LISTS job).
 */

import { parseStringPromise } from 'xml2js';
import { getDb } from '../db/client.js';

const OFAC_SDN_URL = 'https://www.treasury.gov/ofac/downloads/sdn.xml';
const UN_CONSOLIDATED_URL = 'https://scsanctions.un.org/resources/xml/en/consolidated.xml';

interface PepEntry {
  entry_id: string;
  list_source: string;
  entry_type: string;
  full_name: string;
  aliases: string;
  date_of_birth: string;
  nationality: string;
  program: string;
  is_sanctions: number;
}

export class PepSyncService {
  async syncAll(): Promise<{ ofac: number; un: number }> {
    const [ofacCount, unCount] = await Promise.all([
      this.syncOfac(),
      this.syncUn(),
    ]);
    return { ofac: ofacCount, un: unCount };
  }

  private async syncOfac(): Promise<number> {
    const db = getDb();
    let entries: PepEntry[] = [];

    try {
      const res = await fetch(OFAC_SDN_URL, { signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error(`OFAC fetch failed: ${res.status}`);
      const xml = await res.text();
      const parsed = await parseStringPromise(xml, { explicitArray: true });

      const sdnEntries = parsed?.sdnList?.sdnEntry ?? [];
      for (const entry of sdnEntries) {
        const uid = entry.uid?.[0] ?? '';
        const type = (entry.sdnType?.[0] ?? '').toLowerCase();
        if (type !== 'individual') continue; // skip entities for PEP screening

        const firstName = entry.firstName?.[0] ?? '';
        const lastName = entry.lastName?.[0] ?? '';
        const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();
        if (!fullName) continue;

        // Aliases
        const aliasNames: string[] = [];
        for (const aka of entry.akaList?.[0]?.aka ?? []) {
          const akFirst = aka.firstName?.[0] ?? '';
          const akLast = aka.lastName?.[0] ?? '';
          const akName = [akFirst, akLast].filter(Boolean).join(' ').trim();
          if (akName && akName !== fullName) aliasNames.push(akName);
        }

        // Date of birth
        let dob = '';
        for (const dobEntry of entry.dateOfBirthList?.[0]?.dateOfBirthItem ?? []) {
          dob = dobEntry.dateOfBirth?.[0] ?? '';
          if (dob) break;
        }

        // Nationality
        let nationality = '';
        for (const natEntry of entry.placeOfBirthList?.[0]?.placeOfBirthItem ?? []) {
          nationality = natEntry.country?.[0] ?? '';
          if (nationality) break;
        }

        // Programs
        const programs: string[] = [];
        for (const prog of entry.programList?.[0]?.program ?? []) {
          if (typeof prog === 'string') programs.push(prog);
        }

        entries.push({
          entry_id: `OFAC_${uid}`,
          list_source: 'OFAC_SDN',
          entry_type: 'individual',
          full_name: fullName,
          aliases: aliasNames.join('|'),
          date_of_birth: dob,
          nationality,
          program: programs.join(', '),
          is_sanctions: 1,
        });
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      db.prepare('INSERT INTO pep_sync_log (list_source, entries_loaded, error) VALUES (?, 0, ?)').run('OFAC_SDN', error);
      throw err;
    }

    this.upsertEntries('OFAC_SDN', entries, db);
    db.prepare('INSERT INTO pep_sync_log (list_source, entries_loaded) VALUES (?, ?)').run('OFAC_SDN', entries.length);
    return entries.length;
  }

  private async syncUn(): Promise<number> {
    const db = getDb();
    let entries: PepEntry[] = [];

    try {
      const res = await fetch(UN_CONSOLIDATED_URL, { signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error(`UN fetch failed: ${res.status}`);
      const xml = await res.text();
      const parsed = await parseStringPromise(xml, { explicitArray: true });

      const individuals = parsed?.CONSOLIDATED_LIST?.INDIVIDUALS?.[0]?.INDIVIDUAL ?? [];
      for (const ind of individuals) {
        const ref = ind.DATAID?.[0] ?? ind.REFERENCE_NUMBER?.[0] ?? '';
        const firstName = ind.FIRST_NAME?.[0] ?? '';
        const secondName = ind.SECOND_NAME?.[0] ?? '';
        const thirdName = ind.THIRD_NAME?.[0] ?? '';
        const fullName = [firstName, secondName, thirdName].filter(Boolean).join(' ').trim();
        if (!fullName) continue;

        // Aliases
        const aliasNames: string[] = [];
        for (const aka of ind.INDIVIDUAL_ALIAS ?? []) {
          const akaName = aka.ALIAS_NAME?.[0] ?? '';
          if (akaName && akaName !== fullName) aliasNames.push(akaName);
        }

        // DOB
        let dob = '';
        for (const dobEntry of ind.INDIVIDUAL_DATE_OF_BIRTH ?? []) {
          const year = dobEntry.YEAR?.[0] ?? '';
          const month = dobEntry.MONTH?.[0] ?? '';
          const day = dobEntry.DAY?.[0] ?? '';
          if (year) {
            dob = [year, month?.padStart(2, '0'), day?.padStart(2, '0')].filter(Boolean).join('-');
            break;
          }
        }

        // Nationality
        let nationality = '';
        for (const nat of ind.NATIONALITY ?? []) {
          nationality = nat.VALUE?.[0] ?? '';
          if (nationality) break;
        }

        entries.push({
          entry_id: `UN_${ref}`,
          list_source: 'UN_CONSOLIDATED',
          entry_type: 'individual',
          full_name: fullName,
          aliases: aliasNames.join('|'),
          date_of_birth: dob,
          nationality,
          program: 'UN_SANCTIONS',
          is_sanctions: 1,
        });
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      db.prepare('INSERT INTO pep_sync_log (list_source, entries_loaded, error) VALUES (?, 0, ?)').run('UN_CONSOLIDATED', error);
      throw err;
    }

    this.upsertEntries('UN_CONSOLIDATED', entries, db);
    db.prepare('INSERT INTO pep_sync_log (list_source, entries_loaded) VALUES (?, ?)').run('UN_CONSOLIDATED', entries.length);
    return entries.length;
  }

  private upsertEntries(listSource: string, entries: PepEntry[], db: ReturnType<typeof getDb>): void {
    // Delete existing entries for this list, then re-insert (FTS5 doesn't support upsert)
    db.prepare("DELETE FROM pep_entries WHERE list_source = ?").run(listSource);

    const insert = db.prepare(`
      INSERT INTO pep_entries
        (entry_id, list_source, entry_type, full_name, aliases, date_of_birth, nationality, program, is_sanctions)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = db.transaction((rows: PepEntry[]) => {
      for (const r of rows) {
        insert.run(r.entry_id, r.list_source, r.entry_type, r.full_name, r.aliases, r.date_of_birth, r.nationality, r.program, r.is_sanctions);
      }
    });

    insertMany(entries);
  }

  getLastSyncInfo(): Record<string, { entries: number; synced_at: number } | null> {
    const db = getDb();
    const result: Record<string, { entries: number; synced_at: number } | null> = {
      OFAC_SDN: null,
      UN_CONSOLIDATED: null,
    };
    for (const source of Object.keys(result)) {
      const row = db.prepare(`
        SELECT entries_loaded, synced_at FROM pep_sync_log
        WHERE list_source = ? AND error IS NULL
        ORDER BY synced_at DESC LIMIT 1
      `).get(source) as { entries_loaded: number; synced_at: number } | undefined;
      if (row) result[source] = { entries: row.entries_loaded, synced_at: row.synced_at };
    }
    return result;
  }
}
