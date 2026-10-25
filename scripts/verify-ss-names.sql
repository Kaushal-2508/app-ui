-- Show the cloned chapters that had corruption in their source name: old -> new,
-- plus the UTF-8 hex of the new name so we can confirm clean bytes regardless of
-- the transport read-back garble.
SELECT b.new_name,
       b.old_name,
       encode(convert_to(b.new_name,'UTF8'),'hex') AS new_hex
FROM salci_backups.social_science_merge_20260617 b
WHERE b.kind = 'chapter'
  AND (b.old_name LIKE '%'||chr(65533)||'%' OR b.old_name ~ 'Class \d')
ORDER BY b.new_name;
