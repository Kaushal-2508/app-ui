-- supabase/migrations/20260625120000_user_topic_orders.sql
-- Per-USER personal ordering of syllabus chapters. Mirrors the
-- institution_hidden_topics override pattern, but keyed by user so a person's
-- arrangement never touches the shared (global) syllabus_topics rows and never
-- affects anyone else. Works identically for global and institution chapters.

CREATE TABLE IF NOT EXISTS public.user_topic_orders (
  user_id       UUID NOT NULL REFERENCES public.profiles(id)        ON DELETE CASCADE,
  topic_id      UUID NOT NULL REFERENCES public.syllabus_topics(id) ON DELETE CASCADE,
  display_order INTEGER NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, topic_id)
);

-- FK index (PK already covers user_id-first lookups; topic_id needs its own).
CREATE INDEX IF NOT EXISTS user_topic_orders_topic_idx
  ON public.user_topic_orders (topic_id);

ALTER TABLE public.user_topic_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own topic order"   ON public.user_topic_orders;
DROP POLICY IF EXISTS "Users insert own topic order" ON public.user_topic_orders;
DROP POLICY IF EXISTS "Users update own topic order" ON public.user_topic_orders;
DROP POLICY IF EXISTS "Users delete own topic order" ON public.user_topic_orders;

CREATE POLICY "Users read own topic order"   ON public.user_topic_orders
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users insert own topic order" ON public.user_topic_orders
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users update own topic order" ON public.user_topic_orders
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users delete own topic order" ON public.user_topic_orders
  FOR DELETE TO authenticated USING (user_id = auth.uid());
