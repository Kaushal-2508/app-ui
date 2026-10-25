-- Fire send-push when a notification row is written, so the Capacitor app gets
-- the same notifications the browser already gets.
--
-- There is ALREADY a webhook on this table: `send_push_on_notification`, a
-- dashboard-created `supabase_functions.http_request` trigger pointing at
-- send-web-push. That one stays exactly as it is; this adds a SECOND,
-- independent trigger for the native plane, so a failure or a slow response on
-- one channel cannot affect the other.
--
-- It is NOT another `supabase_functions.http_request` trigger, for one specific
-- reason: that helper takes its headers as a literal, so the shared webhook
-- secret ends up in plain text inside `pg_get_triggerdef()` output, and
-- therefore in any migration that creates it. This version reads the secret
-- from Vault at call time, so nothing secret is committed to the repo.

-- Seed Vault from the secret the existing webhook already carries, INSIDE the
-- database, so the value never passes through a file, a shell history or a
-- code review. Idempotent.
do $seed$
declare
  found text;
begin
  if exists (select 1 from vault.decrypted_secrets where name = 'webhook_secret') then
    raise notice 'vault secret webhook_secret already present; leaving it alone';
    return;
  end if;

  select (regexp_match(pg_get_triggerdef(t.oid), 'Bearer ([A-Za-z0-9._-]+)'))[1]
    into found
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  where c.relname = 'notifications'
    and t.tgname = 'send_push_on_notification'
    and not t.tgisinternal;

  if found is null or length(found) < 16 then
    raise exception
      'Could not recover the webhook secret from send_push_on_notification. Create the Vault secret "webhook_secret" manually (it must equal the WEBHOOK_SECRET edge-function secret), then re-run.';
  end if;

  perform vault.create_secret(
    found,
    'webhook_secret',
    'Shared bearer secret for the notification webhooks (send-web-push, send-push). Must equal the WEBHOOK_SECRET edge-function secret.'
  );
end $seed$;

-- The trigger body. Exception-wrapped end to end: a notification must be
-- written even if the push cannot be dispatched, exactly as the audit triggers
-- are (§11). pg_net is fire-and-forget, so this never blocks the INSERT on the
-- network either.
create or replace function public.tg_send_native_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  secret text;
begin
  select decrypted_secret into secret
  from vault.decrypted_secrets
  where name = 'webhook_secret';

  if secret is null then
    raise warning 'tg_send_native_push: Vault secret "webhook_secret" is missing; no native push for notification %', new.id;
    return null;
  end if;

  perform net.http_post(
    url := 'https://gyymkgohcijeksmrzuyw.supabase.co/functions/v1/send-push',
    body := jsonb_build_object('record', to_jsonb(new)),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || secret
    ),
    timeout_milliseconds := 5000
  );
  return null;
exception when others then
  -- Never let a push problem abort the notification it was about.
  raise warning 'tg_send_native_push failed for notification %: %', new.id, sqlerrm;
  return null;
end;
$$;

revoke all on function public.tg_send_native_push() from anon;
revoke all on function public.tg_send_native_push() from public;

drop trigger if exists send_native_push_on_notification on public.notifications;
create trigger send_native_push_on_notification
  after insert on public.notifications
  for each row execute function public.tg_send_native_push();

comment on function public.tg_send_native_push() is
  'AFTER INSERT on notifications: dispatches the row to the send-push edge function (FCM, native app) via pg_net, reading the bearer secret from Vault. Exception-wrapped so it can never abort the notification write. The browser channel is a separate trigger, send_push_on_notification -> send-web-push.';
