import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// We test RiskScoringService in isolation by injecting a test DB
describe('RiskScoringService', () => {
  let db: Database.Database;

  beforeEach(() => {
    // Use in-memory DB for tests
    process.env['DB_PATH'] = ':memory:';
    process.env['JWT_SECRET'] = 'test-secret-that-is-long-enough-to-pass';
    process.env['MASTER_API_KEY'] = 'test-master-key';
    db = new Database(':memory:');
    db.pragma('foreign_keys = OFF');

    // Minimal schema
    db.exec(`
      CREATE TABLE sessions (id TEXT PRIMARY KEY, merchant_id TEXT, state TEXT DEFAULT 'created', session_token_hash TEXT, metadata TEXT, redirect_url TEXT, created_at INTEGER DEFAULT 0, updated_at INTEGER DEFAULT 0, expires_at INTEGER DEFAULT 9999999999);
      CREATE TABLE documents (id TEXT PRIMARY KEY, session_id TEXT, document_type TEXT DEFAULT 'PASSPORT', side TEXT DEFAULT 'FRONT', storage_path TEXT DEFAULT '', ocr_raw TEXT, ocr_parsed TEXT, face_descriptor TEXT, confidence REAL, status TEXT DEFAULT 'PENDING', error TEXT, created_at INTEGER DEFAULT 0, updated_at INTEGER DEFAULT 0);
      CREATE TABLE selfie_checks (id TEXT PRIMARY KEY, session_id TEXT, storage_path TEXT DEFAULT '', face_detected INTEGER, liveness_score REAL, match_score REAL, status TEXT DEFAULT 'PENDING', error TEXT, created_at INTEGER DEFAULT 0, updated_at INTEGER DEFAULT 0);
      CREATE TABLE address_checks (id TEXT PRIMARY KEY, session_id TEXT, document_type TEXT DEFAULT 'UTILITY_BILL', storage_path TEXT DEFAULT '', ocr_raw TEXT, ocr_parsed TEXT, name_match_score REAL, confidence REAL, status TEXT DEFAULT 'PENDING', error TEXT, created_at INTEGER DEFAULT 0, updated_at INTEGER DEFAULT 0);
    `);
  });

  it('returns rejected when no checks exist', async () => {
    const { RiskScoringService } = await import('../../src/services/RiskScoringService.js');

    // Monkey-patch getDb to return test db
    const dbModule = await import('../../src/db/client.js');
    (dbModule as any).getDb = () => db;

    db.prepare("INSERT INTO sessions VALUES ('ses_1','mer_1','created','hash',NULL,NULL,0,0,9999999999)").run();

    const svc = new RiskScoringService();
    const result = svc.score('ses_1');
    expect(result.decision).toBe('rejected');
    expect(result.score).toBe(0);
  });

  it('approves when all checks pass with high confidence', async () => {
    const { RiskScoringService } = await import('../../src/services/RiskScoringService.js');
    const dbModule = await import('../../src/db/client.js');
    (dbModule as any).getDb = () => db;

    db.prepare("INSERT INTO sessions VALUES ('ses_2','mer_1','processing','hash',NULL,NULL,0,0,9999999999)").run();
    db.prepare("INSERT INTO documents VALUES ('doc_1','ses_2','PASSPORT','FRONT','',NULL,'{}',NULL,0.95,'DONE',NULL,0,0)").run();
    db.prepare("INSERT INTO selfie_checks VALUES ('slf_1','ses_2','',1,0.88,0.87,'DONE',NULL,0,0)").run();
    db.prepare("INSERT INTO address_checks VALUES ('adr_1','ses_2','UTILITY_BILL','','{}','{}',0.90,0.85,'DONE',NULL,0,0)").run();

    const svc = new RiskScoringService();
    const result = svc.score('ses_2');
    expect(result.decision).toBe('approved');
    expect(result.score).toBeGreaterThan(0.8);
  });
});
