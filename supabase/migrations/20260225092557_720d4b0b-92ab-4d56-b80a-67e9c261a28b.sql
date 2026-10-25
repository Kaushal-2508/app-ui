
-- Fix the broken SELECT policy on conversations table
-- Bug: cp.conversation_id = cp.id should be cp.conversation_id = conversations.id
DROP POLICY IF EXISTS "conv_select" ON public.conversations;

CREATE POLICY "conv_select" ON public.conversations
FOR SELECT USING (
  (EXISTS (
    SELECT 1 FROM conversation_participants cp
    WHERE cp.conversation_id = conversations.id
      AND cp.user_id = auth.uid()
  ))
  OR is_institution_admin(auth.uid(), institution_id)
);
