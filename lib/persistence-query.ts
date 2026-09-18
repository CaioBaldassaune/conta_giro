// Bind the row collection once. This keeps 500-row imports within D1's
// per-invocation query and per-query parameter limits, including the free tier.
export const RECORD_UPSERT_SQL = `INSERT INTO records (id,company_id,kind,period,data,updated_at)
SELECT json_extract(value,'$.id'), ?, json_extract(value,'$.kind'), json_extract(value,'$.period'), json_extract(value,'$.data'), ?
FROM json_each(?) WHERE EXISTS (SELECT 1 FROM companies WHERE id = ? AND version = ?)
ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at
WHERE records.company_id=excluded.company_id`;
export const SEED_RECORDS_SQL = `INSERT INTO records (id,company_id,kind,period,data,updated_at)
SELECT json_extract(value,'$.id'), ?, json_extract(value,'$.kind'), json_extract(value,'$.period'), json_extract(value,'$.data'), ?
FROM json_each(?) WHERE EXISTS (SELECT 1 FROM companies WHERE id = ?)`;
