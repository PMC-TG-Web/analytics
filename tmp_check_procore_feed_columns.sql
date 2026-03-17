SELECT column_name, ordinal_position
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'procore_project_feed'
ORDER BY ordinal_position;
