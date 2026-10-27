-- Verifies the DERIVED tables agree with the RAW table. Returns one row per disagreement; ZERO ROWS means they agree.
-- Columns: what (table), key (card / '_answers' / day), actual (stored), expected (recomputed from feedback).
WITH expected_counts(key, n) AS (
  SELECT j.value, COUNT(*) FROM feedback_latest l, json_each(l.picks) j GROUP BY j.value
  UNION ALL
  SELECT '_answers', COUNT(DISTINCT answer_id) FROM feedback
),
expected_daily(day, n) AS (
  SELECT substr(received_at, 1, 10), COUNT(*) FROM feedback GROUP BY 1
)
SELECT 'feedback_counts' AS what, c.key AS key, c.n AS actual, COALESCE(e.n, 0) AS expected
FROM feedback_counts c LEFT JOIN expected_counts e ON e.key = c.key
WHERE c.n <> COALESCE(e.n, 0)
UNION ALL
SELECT 'feedback_counts', e.key, 0, e.n
FROM expected_counts e WHERE e.key NOT IN (SELECT key FROM feedback_counts)
UNION ALL
SELECT 'feedback_daily', d.day, d.answers, COALESCE(e.n, 0)
FROM feedback_daily d LEFT JOIN expected_daily e ON e.day = d.day
WHERE d.answers <> COALESCE(e.n, 0)
UNION ALL
SELECT 'feedback_daily', e.day, 0, e.n
FROM expected_daily e WHERE e.day NOT IN (SELECT day FROM feedback_daily);
