-- AAMVA PDF417 barcode support for North American driver's licenses / provincial ID cards.
-- The barcode is decoded client-side and the raw decoded string is stored on the
-- back-of-card document row. DocumentService parses it into authoritative identity
-- fields (see aamvaParser.ts), independent of front-side OCR.

ALTER TABLE documents ADD COLUMN barcode_raw TEXT;   -- raw decoded AAMVA string (from PDF417)
