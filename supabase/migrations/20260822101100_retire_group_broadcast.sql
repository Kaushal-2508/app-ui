-- Retires the group-broadcast send path.
--
-- send_bulk_message put every recipient into ONE conversation. For a message
-- that is the wrong shape: 253 people share a room, they can see each other,
-- and nobody has a private thread with the sender. send_direct_messages
-- replaced it with a fan-out of ordinary 1:1 conversations.
--
-- Dropping rather than leaving them unused: both are SECURITY DEFINER and
-- EXECUTE-able by every authenticated user, so an unused one is a live path to
-- the behaviour we just removed on purpose.
--
-- Existing 'broadcast' conversations are deliberately NOT deleted. There is one
-- on prod, a test send, and it belongs to whoever sent it. MessageThread still
-- renders that type read-only for recipients, so it stays readable and inert.
BEGIN;

DROP FUNCTION IF EXISTS public.send_bulk_message(
  uuid, text, text, text, uuid[], uuid[], text[], uuid[], uuid[]);

DROP FUNCTION IF EXISTS public.bulk_message_audience_preview(
  text, uuid[], uuid[], text[], uuid[], uuid[]);

COMMIT;
