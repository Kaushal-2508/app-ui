BEGIN;

CREATE TABLE IF NOT EXISTS public.support_messages (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id    uuid NOT NULL REFERENCES public.reported_issues(id) ON DELETE CASCADE,
  author_id    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  author_name  text,
  author_side  text NOT NULL CHECK (author_side IN ('reporter', 'salci', 'system')),
  kind         text NOT NULL DEFAULT 'message' CHECK (kind IN ('message', 'system')),
  body         text NOT NULL,
  is_internal  boolean NOT NULL DEFAULT false,
  attachments  jsonb NOT NULL DEFAULT '[]'::jsonb,
  client_token uuid,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_support_messages_ticket_created
  ON public.support_messages(ticket_id, created_at);
CREATE INDEX IF NOT EXISTS idx_support_messages_author
  ON public.support_messages(author_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_support_messages_client_token
  ON public.support_messages(client_token)
  WHERE client_token IS NOT NULL;

ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Support participants read the thread" ON public.support_messages;
CREATE POLICY "Support participants read the thread"
  ON public.support_messages FOR SELECT TO authenticated
  USING (
    public.is_super_admin((SELECT auth.uid()))
    OR (public.is_support_ticket_reporter(ticket_id) AND NOT is_internal)
  );

REVOKE ALL ON TABLE public.support_messages FROM anon;
REVOKE ALL ON TABLE public.support_messages FROM authenticated;
GRANT SELECT ON TABLE public.support_messages TO authenticated;

-- Two NULL tokens coexist; a repeated token is rejected.
INSERT INTO public.support_messages (ticket_id, author_side, body)
SELECT id, 'system', 'dry run a' FROM public.reported_issues ORDER BY created_at LIMIT 1;
INSERT INTO public.support_messages (ticket_id, author_side, body)
SELECT id, 'system', 'dry run b' FROM public.reported_issues ORDER BY created_at LIMIT 1;
INSERT INTO public.support_messages (ticket_id, author_side, body, client_token)
SELECT id, 'reporter', 'dry run c', '00000000-0000-4000-8000-000000000001'
FROM public.reported_issues ORDER BY created_at LIMIT 1;

DO $$
BEGIN
  BEGIN
    INSERT INTO public.support_messages (ticket_id, author_side, body, client_token)
    SELECT id, 'reporter', 'dry run d', '00000000-0000-4000-8000-000000000001'
    FROM public.reported_issues ORDER BY created_at LIMIT 1;
    RAISE EXCEPTION 'DRY RUN FAILED: duplicate client_token was accepted';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'duplicate client_token correctly rejected';
  END;
END $$;

ROLLBACK;

SELECT 'dry run completed with no error' AS result,
       to_regclass('public.support_messages') IS NULL AS rolled_back_clean;
