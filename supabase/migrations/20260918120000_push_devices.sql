-- Native app push device registry (Capacitor shell, round 7 NEEDS DB).
--
-- Requested in docs/superpowers/specs/2026-09-16-native-app-capacitor-design.md
-- Phase 3 and consumed by src/lib/pushDevices.ts. This is the native app's
-- counterpart to the website's `push_subscriptions` (Web Push / VAPID); the two
-- planes stay separate because the addressing is different (FCM device token vs
-- a browser subscription object).
--
-- One row per device token. The token is the identity: it is what FCM accepts,
-- it rotates on its own schedule, and the same physical phone can carry a
-- different token after a reinstall.

create table if not exists public.push_devices (
  id           uuid primary key default gen_random_uuid(),
  -- Ownership column, so it CASCADEs with the profile (§21). Every new column
  -- referencing profiles(id) must declare ON DELETE explicitly.
  user_id      uuid        not null references public.profiles(id) on delete cascade,
  platform     text        not null check (platform in ('android', 'ios')),
  -- UNIQUE because the client upserts on it and because FCM would otherwise
  -- receive duplicate sends for one device.
  token        text        not null unique,
  device_id    text,
  app_version  text,
  last_seen_at timestamptz not null default now(),
  created_at   timestamptz not null default now()
);

-- Every new FK gets an index in the same migration (§23). The send path reads
-- by user_id ("who should this notification reach?"), so this is the hot one.
create index if not exists idx_push_devices_user_id on public.push_devices (user_id);

alter table public.push_devices enable row level security;

-- Own-row only. A device registration is as sensitive as a session: knowing
-- someone's token means being able to push to their phone.
drop policy if exists "push_devices_select_own" on public.push_devices;
create policy "push_devices_select_own"
  on public.push_devices for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "push_devices_insert_own" on public.push_devices;
create policy "push_devices_insert_own"
  on public.push_devices for insert to authenticated
  with check (user_id = (select auth.uid()));

-- Both USING and WITH CHECK. A missing WITH CHECK silently rejected 100% of
-- teachers' offline-marks saves for two days (§26).
drop policy if exists "push_devices_update_own" on public.push_devices;
create policy "push_devices_update_own"
  on public.push_devices for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- The client deletes its own row at sign-out. Without this policy that DELETE
-- would look identical to success (§6) and leave a live token pointing at a
-- phone whose user has signed out.
drop policy if exists "push_devices_delete_own" on public.push_devices;
create policy "push_devices_delete_own"
  on public.push_devices for delete to authenticated
  using (user_id = (select auth.uid()));

-- Supabase grants table privileges to anon by default; strip them by name.
revoke all on table public.push_devices from anon;

-- ---------------------------------------------------------------------------
-- Registration goes through this function, not a client upsert.
--
-- Two reasons. First, `user_id` is stamped from auth.uid() here, so a client
-- cannot register a token against somebody else's account. Second, DEVICE
-- HANDOVER: on a shared school phone user B signs in after user A, and the
-- token is unchanged, so a client-side `upsert(onConflict: token)` would have
-- to UPDATE a row still owned by A. The own-row UPDATE policy correctly
-- refuses that, which would leave B unable to register and, worse, leave A's
-- row live so A's notifications kept arriving on B's phone. A definer function
-- can reassign the row; RLS cannot express "you may take over a token you can
-- prove you hold".
create or replace function public.register_push_device(
  _platform    text,
  _token       text,
  _device_id   text default null,
  _app_version text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;
  if _platform not in ('android', 'ios') then
    raise exception 'Unknown platform: %', _platform using errcode = '22023';
  end if;
  if _token is null or length(btrim(_token)) = 0 then
    raise exception 'A device token is required.' using errcode = '22023';
  end if;

  insert into public.push_devices (user_id, platform, token, device_id, app_version, last_seen_at)
  values (uid, _platform, btrim(_token), _device_id, _app_version, now())
  on conflict (token) do update
    set user_id      = uid,
        platform     = excluded.platform,
        device_id    = coalesce(excluded.device_id, public.push_devices.device_id),
        app_version  = coalesce(excluded.app_version, public.push_devices.app_version),
        last_seen_at = now();
end;
$$;

-- Supabase grants EXECUTE on every new function to anon; REVOKE FROM PUBLIC
-- does NOT strip it, so revoke by name (§26).
revoke all on function public.register_push_device(text, text, text, text) from anon;
revoke all on function public.register_push_device(text, text, text, text) from public;
grant execute on function public.register_push_device(text, text, text, text) to authenticated;

comment on table public.push_devices is
  'Native app (Capacitor) FCM device tokens, one row per token, own-row RLS. Register through register_push_device(); the website uses push_subscriptions instead.';
