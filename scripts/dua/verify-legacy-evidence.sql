-- READ-ONLY: what the archive now holds from the platform logs
SELECT source, kind, count(*) AS rows, count(DISTINCT subject_user_id) AS people,
       min(event_at) AS first, max(event_at) AS last,
       count(*) FILTER (WHERE email IS NOT NULL) AS with_email
FROM dua.legacy_evidence GROUP BY source, kind ORDER BY source, kind;
