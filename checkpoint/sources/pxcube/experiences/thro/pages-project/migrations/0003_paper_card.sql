-- 0003: the paper card (P01, Sam's Mid-Century Retro ThroCard) joins the review page; give it a count row.
-- Derived data only: the raw feedback table is unchanged. OR IGNORE keeps it safe to apply after a recompute.
INSERT OR IGNORE INTO feedback_counts (key, n) VALUES ('p01', 0);
