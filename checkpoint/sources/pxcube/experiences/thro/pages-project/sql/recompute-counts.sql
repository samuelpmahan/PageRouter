-- Rebuilds the DERIVED tables from the RAW table. Idempotent; never touches feedback.
-- "Latest revision per answer_id" is what counts (view feedback_latest), so revision 2 replaces revision 1's picks.
-- Run when traffic is quiet (it is several statements, not one transaction), then run check-counts.sql.
--   local : npx wrangler d1 execute thro-feedback --local  --file=sql/recompute-counts.sql
--   remote: npx wrangler d1 execute thro-feedback --remote --file=sql/recompute-counts.sql
UPDATE feedback_counts
SET n = (SELECT COUNT(*) FROM feedback_latest l, json_each(l.picks) j WHERE j.value = feedback_counts.key)
WHERE key <> '_answers';
UPDATE feedback_counts SET n = (SELECT COUNT(DISTINCT answer_id) FROM feedback) WHERE key = '_answers';
DELETE FROM feedback_daily;
INSERT INTO feedback_daily (day, answers) SELECT substr(received_at, 1, 10), COUNT(*) FROM feedback GROUP BY 1;
