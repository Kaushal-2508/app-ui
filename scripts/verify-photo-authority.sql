-- Authority matrix for can_set_user_photo(). Seeds fixtures, asserts, rolls back.
-- Run via scripts/run-sql.ps1 (posts to the Supabase Management API).
--
-- OUTPUT NOTE: the Management API's query endpoint returns only the row set
-- of the LAST statement in the batch, or the error message if ANY statement
-- in the batch raises -- and on error it discards every row any earlier
-- statement in the same batch would have produced (verified empirically: a
-- three-statement batch where only the middle statement fails returns just
-- the error, not the first statement's rows). It also never surfaces
-- RAISE NOTICE / RAISE WARNING text at all, pass or fail (verified: a lone
-- `DO $$ BEGIN RAISE NOTICE ...; END $$;` returns an empty success body).
-- So this script keeps the RAISE NOTICE/WARNING calls for anyone running it
-- interactively via psql, but ALSO records every cell into a TEMP TABLE and
-- SELECTs it back as the second-to-last statement before ROLLBACK -- that
-- SELECT's rows are what actually reaches the Management API caller on a
-- passing run.
--
-- FAIL-LOUD NOTE: after that SELECT, one more statement re-checks the same
-- temp table and RAISEs if any row has status = 'FAIL'. On a pass this is a
-- no-op and the SELECT's rows above it are what the caller sees (HTTP 201).
-- On a fail it raises, and the Management API's all-or-nothing batch
-- behaviour means the response becomes JUST that error (HTTP error), which
-- blanks the row-by-row detail -- but a silent HTTP 201 "pass" on a genuinely
-- failing suite is far worse than a loud failure with less detail, so this
-- is deliberate. See section "Important 5" below for how both directions
-- were confirmed.
--
-- SYNTAX NOTE: the assertions loops read
--   FOR r IN SELECT * FROM (VALUES (...), ...) AS t(actor, target, expected, label)
-- with NO types in that column alias list. A typed alias list
-- (`AS t(actor uuid, target uuid, ...)`) is only legal for a function call in
-- FROM (e.g. json_to_recordset()), not for a plain VALUES-derived table, and
-- raises `42601 syntax error at or near "uuid"` (verified). Column types here
-- are inferred fine from the uuid/boolean/text values actually passed.
--
-- FIXTURE NOTE: profiles has an FK to auth.users(id) (profiles_id_fkey, NOT
-- deferrable), and auth.users carries trigger on_auth_user_created
-- (handle_new_user), which itself INSERTs the public.profiles row. So every
-- fixture "user" is seeded by inserting into auth.users first and then
-- UPDATE-ing the pre-created profiles row -- NEVER a bare INSERT INTO
-- public.profiles (that would violate the FK, since no auth.users row would
-- exist yet). handle_new_user does
--   INSERT INTO public.profiles (id, full_name, email)
--   VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email), NEW.email)
-- and both profiles.full_name and profiles.email are NOT NULL, so the
-- auth.users insert must carry an email too (not just id) or that trigger
-- itself fails with a not-null violation before we ever reach our UPDATE.
BEGIN;

CREATE TEMP TABLE zz_photo_authority_results (
  seq    int PRIMARY KEY,
  label  text NOT NULL,
  status text NOT NULL
);

DO $suite$
DECLARE
  v_inst      uuid := gen_random_uuid();
  v_inst_b    uuid := gen_random_uuid();   -- second institution: cross-tenant negative coverage
  v_wing      uuid := gen_random_uuid();
  v_cg_in     uuid := gen_random_uuid();   -- class_group backing the in-wing class
  v_cg_out    uuid := gen_random_uuid();   -- class_group backing the out-of-wing class
  v_cls_in    uuid := gen_random_uuid();   -- class inside the coordinator's wing
  v_cls_out   uuid := gen_random_uuid();   -- class outside it
  v_subj      uuid := gen_random_uuid();
  v_sadmin    uuid := gen_random_uuid();
  v_coord     uuid := gen_random_uuid();
  v_coord2    uuid := gen_random_uuid();
  v_teach     uuid := gen_random_uuid();   -- teaches v_subj in v_cls_in
  v_teach2    uuid := gen_random_uuid();   -- teaches v_cls_out only
  v_stu_in    uuid := gen_random_uuid();   -- student of v_cls_in
  v_stu_out   uuid := gen_random_uuid();   -- student of v_cls_out
  v_super     uuid := gen_random_uuid();   -- super_admin, institution-agnostic
  v_stu_b     uuid := gen_random_uuid();   -- student of institution B
  v_ret1      text;                        -- set_user_avatar / clear_user_avatar return capture
  v_ret2      text;
  v_ret_clear text;
  v_now_path  text;
  v_fails     int  := 0;
  v_seq       int  := 0;
  r           record;
BEGIN
  -- ---- fixtures ----
  INSERT INTO public.institutions (id, name, code) VALUES (v_inst, 'ZZ Test Inst', 'ZZTEST');

  -- Seed the auth.users row (this fires handle_new_user, which pre-creates the
  -- profiles row) then UPDATE the profiles row into shape. Never INSERT INTO
  -- public.profiles directly.
  INSERT INTO auth.users (id, email) VALUES (v_sadmin,  'zz.admin@test.invalid');
  INSERT INTO auth.users (id, email) VALUES (v_coord,   'zz.coord@test.invalid');
  INSERT INTO auth.users (id, email) VALUES (v_coord2,  'zz.coord2@test.invalid');
  INSERT INTO auth.users (id, email) VALUES (v_teach,   'zz.teach@test.invalid');
  INSERT INTO auth.users (id, email) VALUES (v_teach2,  'zz.teach2@test.invalid');
  INSERT INTO auth.users (id, email) VALUES (v_stu_in,  'zz.stuin@test.invalid');
  INSERT INTO auth.users (id, email) VALUES (v_stu_out, 'zz.stuout@test.invalid');

  UPDATE public.profiles SET full_name = 'ZZ Admin',   email = 'zz.admin@test.invalid',  institution_id = v_inst WHERE id = v_sadmin;
  UPDATE public.profiles SET full_name = 'ZZ Coord',   email = 'zz.coord@test.invalid',  institution_id = v_inst WHERE id = v_coord;
  UPDATE public.profiles SET full_name = 'ZZ Coord 2', email = 'zz.coord2@test.invalid', institution_id = v_inst WHERE id = v_coord2;
  UPDATE public.profiles SET full_name = 'ZZ Teacher', email = 'zz.teach@test.invalid',  institution_id = v_inst WHERE id = v_teach;
  UPDATE public.profiles SET full_name = 'ZZ Teach 2', email = 'zz.teach2@test.invalid', institution_id = v_inst WHERE id = v_teach2;
  UPDATE public.profiles SET full_name = 'ZZ Stu In',  email = 'zz.stuin@test.invalid',  institution_id = v_inst WHERE id = v_stu_in;
  UPDATE public.profiles SET full_name = 'ZZ Stu Out', email = 'zz.stuout@test.invalid', institution_id = v_inst WHERE id = v_stu_out;

  INSERT INTO public.user_roles (user_id, role, institution_id) VALUES
    (v_sadmin, 'school_admin', v_inst),
    (v_coord,  'coordinator',  v_inst),
    (v_coord2, 'coordinator',  v_inst),
    (v_teach,  'teacher',      v_inst),
    (v_teach2, 'teacher',      v_inst),
    (v_stu_in, 'student',      v_inst),
    (v_stu_out,'student',      v_inst);

  -- classes.class_group_id is NOT NULL, so the class_group must exist first.
  INSERT INTO public.class_groups (id, institution_id, name, academic_year) VALUES
    (v_cg_in,  v_inst, 'ZZ Group A', '2026-27'),
    (v_cg_out, v_inst, 'ZZ Group B', '2026-27');

  INSERT INTO public.classes (id, institution_id, name, section, academic_year, class_group_id)
  VALUES (v_cls_in,  v_inst, 'ZZ Class A', 'A', '2026-27', v_cg_in),
         (v_cls_out, v_inst, 'ZZ Class B', 'B', '2026-27', v_cg_out);

  -- class_assignments.subject_id, subject_class_mappings.subject_id and
  -- subject_class_group_mappings.subject_id ALL FK to universal_subjects(id)
  -- (verified: NOT public.subjects -- that table is unrelated to these three).
  -- Scope this fixture row to our throw-away institution
  -- (universal_subjects.institution_id) so check_subject_single_class_group
  -- (which only restricts institution-owned subjects to one class_group) and
  -- check_subject_unique_per_class_group leave it alone. code is nullable per
  -- information_schema but a BEFORE INSERT trigger (check_subject_code_required)
  -- rejects a blank one, so it must be supplied explicitly.
  INSERT INTO public.universal_subjects (id, name, code, institution_id)
  VALUES (v_subj, 'ZZ Subject', 'ZZSUB', v_inst);

  -- Never write subject_class_mappings directly (class-groups skill,
  -- CLAUDE.md SS22): write subject_class_group_mappings and let
  -- fanout_subject_class_group_mapping_trg materialize the per-section row
  -- (here, into v_cls_in, the only class under v_cg_in).
  INSERT INTO public.subject_class_group_mappings (institution_id, class_group_id, subject_id, is_optional)
  VALUES (v_inst, v_cg_in, v_subj, false);

  INSERT INTO public.wings (id, institution_id, name) VALUES (v_wing, v_inst, 'ZZ Wing');
  INSERT INTO public.wing_assignments (wing_id, user_id) VALUES (v_wing, v_coord);
  INSERT INTO public.wing_class_mappings (wing_id, class_id) VALUES (v_wing, v_cls_in);

  INSERT INTO public.class_assignments (user_id, class_id, subject_id, role) VALUES
    (v_stu_in,  v_cls_in,  NULL,   'student'),
    (v_stu_out, v_cls_out, NULL,   'student'),
    (v_teach,   v_cls_in,  v_subj, 'teacher'),
    (v_teach2,  v_cls_out, v_subj, 'teacher');

  -- ---- second institution + super_admin fixtures (Important 2) ----
  -- Without a second institution EVERY existing cell is intra-institution, so
  -- deleting the institution guards in can_set_user_photo would leave every
  -- assertion above still passing. Without a super_admin fixture,
  -- is_super_admin(_actor) and the coordinator branch's
  -- NOT is_super_admin(_target) guard are both unexercised.
  INSERT INTO public.institutions (id, name, code) VALUES (v_inst_b, 'ZZ Test Inst B', 'ZZTESTB');

  INSERT INTO auth.users (id, email) VALUES (v_super, 'zz.super@test.invalid');
  INSERT INTO auth.users (id, email) VALUES (v_stu_b, 'zz.stub@test.invalid');

  UPDATE public.profiles SET full_name = 'ZZ Super Admin', email = 'zz.super@test.invalid', institution_id = v_inst   WHERE id = v_super;
  UPDATE public.profiles SET full_name = 'ZZ Stu B',       email = 'zz.stub@test.invalid',  institution_id = v_inst_b WHERE id = v_stu_b;

  INSERT INTO public.user_roles (user_id, role, institution_id) VALUES
    (v_super, 'super_admin', v_inst),
    (v_stu_b, 'student',     v_inst_b);

  -- ---- assertions: can_set_user_photo(actor, target) ----
  -- Each row: actor, target, expected. Every mismatch is counted and reported.
  FOR r IN
      SELECT * FROM (VALUES
        -- school admin reaches everyone in the institution
        (v_sadmin,  v_stu_in,  true,  'school_admin -> student in wing'),
        (v_sadmin,  v_stu_out, true,  'school_admin -> student out of wing'),
        (v_sadmin,  v_coord,   true,  'school_admin -> coordinator'),
        (v_sadmin,  v_sadmin,  true,  'school_admin -> self'),
        -- coordinator is wing-scoped, and never touches peers or admins
        (v_coord,   v_stu_in,  true,  'coordinator -> student IN wing'),
        (v_coord,   v_stu_out, false, 'coordinator -> student OUT of wing'),
        (v_coord,   v_teach,   true,  'coordinator -> teacher of wing class'),
        (v_coord,   v_teach2,  false, 'coordinator -> teacher outside wing'),
        (v_coord,   v_coord2,  false, 'coordinator -> PEER coordinator'),
        (v_coord,   v_sadmin,  false, 'coordinator -> school admin'),
        (v_coord,   v_coord,   true,  'coordinator -> self'),
        -- teacher reaches only their own subject students
        (v_teach,   v_stu_in,  true,  'teacher -> own subject student'),
        (v_teach,   v_stu_out, false, 'teacher -> student they do not teach'),
        (v_teach,   v_teach2,  false, 'teacher -> another teacher'),
        (v_teach,   v_coord,   false, 'teacher -> coordinator'),
        (v_teach,   v_teach,   true,  'teacher -> self'),
        -- students reach nobody, INCLUDING themselves
        (v_stu_in,  v_stu_in,  false, 'student -> SELF'),
        (v_stu_in,  v_stu_out, false, 'student -> another student'),
        (v_stu_in,  v_teach,   false, 'student -> teacher'),
        -- cross-institution (Important 2): none of the institution-scoped
        -- roles reach across a tenant boundary; only super_admin does, and a
        -- coordinator never reaches a super_admin regardless of institution
        (v_sadmin,  v_stu_b,   false, 'school_admin(inst A) -> student(inst B)'),
        (v_coord,   v_stu_b,   false, 'coordinator(inst A) -> student(inst B)'),
        (v_teach,   v_stu_b,   false, 'teacher(inst A) -> student(inst B)'),
        (v_super,   v_stu_b,   true,  'super_admin -> student(inst B)'),
        (v_coord,   v_super,   false, 'coordinator(inst A) -> super_admin')
      ) AS t(actor, target, expected, label)
  LOOP
    v_seq := v_seq + 1;
    IF public.can_set_user_photo(r.actor, r.target) IS DISTINCT FROM r.expected THEN
      v_fails := v_fails + 1;
      RAISE WARNING 'FAIL: % (expected %)', r.label, r.expected;
      INSERT INTO zz_photo_authority_results VALUES (v_seq, r.label, 'FAIL');
    ELSE
      RAISE NOTICE 'ok: %', r.label;
      INSERT INTO zz_photo_authority_results VALUES (v_seq, r.label, 'ok');
    END IF;
  END LOOP;

  -- ---- the trigger, not just the predicate ----
  -- This is the control that closes the FOUR broad profiles-UPDATE policies.
  -- The RPC being correct proves nothing about a direct PostgREST write, so
  -- impersonate a caller (auth.uid() reads request.jwt.claims->>'sub') and
  -- attempt the update the RPC is meant to make impossible.

  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', v_stu_in::text, 'role', 'authenticated')::text,
                     true);
  v_seq := v_seq + 1;
  BEGIN
    UPDATE public.profiles SET avatar_path = v_stu_in::text || '/x.webp' WHERE id = v_stu_in;
    v_fails := v_fails + 1;
    RAISE WARNING 'FAIL: trigger allowed a STUDENT to set their own photo directly';
    INSERT INTO zz_photo_authority_results VALUES (v_seq, 'trigger: block direct student self-write', 'FAIL');
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'ok: trigger blocked direct student self-write';
    INSERT INTO zz_photo_authority_results VALUES (v_seq, 'trigger: block direct student self-write', 'ok');
  END;

  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', v_coord::text, 'role', 'authenticated')::text,
                     true);
  v_seq := v_seq + 1;
  BEGIN
    UPDATE public.profiles SET avatar_path = v_stu_out::text || '/x.webp' WHERE id = v_stu_out;
    v_fails := v_fails + 1;
    RAISE WARNING 'FAIL: trigger allowed a COORDINATOR to reach outside their wing';
    INSERT INTO zz_photo_authority_results VALUES (v_seq, 'trigger: block out-of-wing coordinator write', 'FAIL');
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'ok: trigger blocked out-of-wing coordinator write';
    INSERT INTO zz_photo_authority_results VALUES (v_seq, 'trigger: block out-of-wing coordinator write', 'ok');
  END;

  -- ...and confirm the happy path still passes the trigger.
  v_seq := v_seq + 1;
  BEGIN
    UPDATE public.profiles SET avatar_path = v_stu_in::text || '/y.webp' WHERE id = v_stu_in;
    RAISE NOTICE 'ok: trigger allowed in-wing coordinator write';
    INSERT INTO zz_photo_authority_results VALUES (v_seq, 'trigger: allow legitimate in-wing coordinator write', 'ok');
  EXCEPTION WHEN insufficient_privilege THEN
    v_fails := v_fails + 1;
    RAISE WARNING 'FAIL: trigger blocked a LEGITIMATE in-wing coordinator write';
    INSERT INTO zz_photo_authority_results VALUES (v_seq, 'trigger: allow legitimate in-wing coordinator write', 'FAIL');
  END;

  -- Important 1: authority is necessary but not sufficient. A school admin
  -- has full authority over v_stu_in (same institution) but the trigger must
  -- still block them from pointing v_stu_in's row at an object living inside
  -- someone ELSE's storage folder via a direct PostgREST update -- exactly
  -- the attack set_user_avatar()'s own comment names, on the path the RPC
  -- does not cover.
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', v_sadmin::text, 'role', 'authenticated')::text,
                     true);
  v_seq := v_seq + 1;
  BEGIN
    UPDATE public.profiles SET avatar_path = v_teach::text || '/spoof.webp' WHERE id = v_stu_in;
    v_fails := v_fails + 1;
    RAISE WARNING 'FAIL: trigger allowed an authorised admin to point a row at another user''s folder';
    INSERT INTO zz_photo_authority_results VALUES (v_seq, 'trigger: block cross-user path spoofing by an authorised admin', 'FAIL');
  EXCEPTION WHEN invalid_parameter_value THEN
    RAISE NOTICE 'ok: trigger blocked cross-user path spoofing by an authorised admin';
    INSERT INTO zz_photo_authority_results VALUES (v_seq, 'trigger: block cross-user path spoofing by an authorised admin', 'ok');
  END;

  PERFORM set_config('request.jwt.claims', NULL, true);

  -- ---- write RPCs: set_user_avatar / clear_user_avatar (Important 4) ----
  -- The predicate/trigger tests above prove can_set_user_photo() and
  -- avatar_owner_from_path() are correct, but nothing above has ever called
  -- the RPC wrapper itself -- its own error codes and its "returns the
  -- previous path" contract (which Task 2's orphaned-object cleanup depends
  -- on) were unexercised.
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', v_teach::text, 'role', 'authenticated')::text,
                     true);

  -- 1. unauthorized caller -> 42501 (teacher does not teach v_stu_out)
  v_seq := v_seq + 1;
  BEGIN
    PERFORM public.set_user_avatar(v_stu_out, v_stu_out::text || '/spoof.webp');
    v_fails := v_fails + 1;
    RAISE WARNING 'FAIL: set_user_avatar allowed an unauthorized caller';
    INSERT INTO zz_photo_authority_results VALUES (v_seq, 'set_user_avatar: 42501 for unauthorized caller', 'FAIL');
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'ok: set_user_avatar raised 42501 for an unauthorized caller';
    INSERT INTO zz_photo_authority_results VALUES (v_seq, 'set_user_avatar: 42501 for unauthorized caller', 'ok');
  END;

  -- 2. authorized caller (self), wrong-owner path -> 22023
  v_seq := v_seq + 1;
  BEGIN
    PERFORM public.set_user_avatar(v_teach, v_stu_in::text || '/spoof.webp');
    v_fails := v_fails + 1;
    RAISE WARNING 'FAIL: set_user_avatar accepted a path owned by someone else';
    INSERT INTO zz_photo_authority_results VALUES (v_seq, 'set_user_avatar: 22023 for wrong-owner path', 'FAIL');
  EXCEPTION WHEN invalid_parameter_value THEN
    RAISE NOTICE 'ok: set_user_avatar raised 22023 for a wrong-owner path';
    INSERT INTO zz_photo_authority_results VALUES (v_seq, 'set_user_avatar: 22023 for wrong-owner path', 'ok');
  END;

  -- 3. set_user_avatar RETURNS THE PREVIOUS PATH. v_teach's avatar_path is
  -- untouched so far (only v_stu_in / v_stu_out were written above -- the two
  -- failed calls in 1 and 2 raised before any write), so the first call's
  -- previous value must be NULL and the second call's previous value must be
  -- exactly what the first call wrote.
  v_seq := v_seq + 1;
  SELECT public.set_user_avatar(v_teach, v_teach::text || '/first.webp')  INTO v_ret1;
  SELECT public.set_user_avatar(v_teach, v_teach::text || '/second.webp') INTO v_ret2;
  IF v_ret1 IS NOT NULL OR v_ret2 IS DISTINCT FROM (v_teach::text || '/first.webp') THEN
    v_fails := v_fails + 1;
    RAISE WARNING 'FAIL: set_user_avatar did not return the previous path (got % then %)', v_ret1, v_ret2;
    INSERT INTO zz_photo_authority_results VALUES (v_seq, 'set_user_avatar: returns previous path across two calls', 'FAIL');
  ELSE
    RAISE NOTICE 'ok: set_user_avatar returns the previous path on each call';
    INSERT INTO zz_photo_authority_results VALUES (v_seq, 'set_user_avatar: returns previous path across two calls', 'ok');
  END IF;

  -- 4. clear_user_avatar returns the previous path and leaves avatar_path NULL
  v_seq := v_seq + 1;
  SELECT public.clear_user_avatar(v_teach) INTO v_ret_clear;
  SELECT avatar_path INTO v_now_path FROM public.profiles WHERE id = v_teach;
  IF v_ret_clear IS DISTINCT FROM (v_teach::text || '/second.webp') OR v_now_path IS NOT NULL THEN
    v_fails := v_fails + 1;
    RAISE WARNING 'FAIL: clear_user_avatar contract broken (returned %, avatar_path now %)', v_ret_clear, v_now_path;
    INSERT INTO zz_photo_authority_results VALUES (v_seq, 'clear_user_avatar: returns previous path and clears', 'FAIL');
  ELSE
    RAISE NOTICE 'ok: clear_user_avatar returns previous path and clears avatar_path';
    INSERT INTO zz_photo_authority_results VALUES (v_seq, 'clear_user_avatar: returns previous path and clears', 'ok');
  END IF;

  PERFORM set_config('request.jwt.claims', NULL, true);

  -- path parser
  v_seq := v_seq + 1;
  IF public.avatar_owner_from_path(v_stu_in::text || '/abc.webp') IS DISTINCT FROM v_stu_in THEN
    v_fails := v_fails + 1; RAISE WARNING 'FAIL: avatar_owner_from_path happy path';
    INSERT INTO zz_photo_authority_results VALUES (v_seq, 'avatar_owner_from_path: happy path', 'FAIL');
  ELSE
    INSERT INTO zz_photo_authority_results VALUES (v_seq, 'avatar_owner_from_path: happy path', 'ok');
  END IF;

  v_seq := v_seq + 1;
  IF public.avatar_owner_from_path('not-a-uuid/x.webp') IS NOT NULL THEN
    v_fails := v_fails + 1; RAISE WARNING 'FAIL: avatar_owner_from_path should return NULL on garbage';
    INSERT INTO zz_photo_authority_results VALUES (v_seq, 'avatar_owner_from_path: garbage returns NULL', 'FAIL');
  ELSE
    INSERT INTO zz_photo_authority_results VALUES (v_seq, 'avatar_owner_from_path: garbage returns NULL', 'ok');
  END IF;

  v_seq := v_seq + 1;
  IF public.avatar_owner_from_path(NULL) IS NOT NULL THEN
    v_fails := v_fails + 1; RAISE WARNING 'FAIL: avatar_owner_from_path should return NULL on NULL';
    INSERT INTO zz_photo_authority_results VALUES (v_seq, 'avatar_owner_from_path: NULL returns NULL', 'FAIL');
  ELSE
    INSERT INTO zz_photo_authority_results VALUES (v_seq, 'avatar_owner_from_path: NULL returns NULL', 'ok');
  END IF;

  -- ---- view gate: can_view_user_photo(_target, _viewer) (Important 3) ----
  -- Argument order is (target, viewer) -- the OPPOSITE of
  -- can_set_user_photo(actor, target). This is the ONLY cross-tenant control
  -- in front of a private bucket holding photographs of children, so it gets
  -- negative coverage, not just one positive case -- a body of `SELECT true`
  -- would otherwise still pass this suite.
  FOR r IN
      SELECT * FROM (VALUES
        (v_stu_in, v_teach,  true,  'can_view_user_photo: same-institution allowed'),
        (v_stu_b,  v_teach,  false, 'can_view_user_photo: target inst B, viewer inst A'),
        (v_stu_in, v_stu_b,  false, 'can_view_user_photo: target inst A, viewer inst B'),
        (v_stu_in, NULL,     false, 'can_view_user_photo: NULL viewer'),
        (NULL,     v_teach,  false, 'can_view_user_photo: NULL target')
      ) AS t(target, viewer, expected, label)
  LOOP
    v_seq := v_seq + 1;
    IF public.can_view_user_photo(r.target, r.viewer) IS DISTINCT FROM r.expected THEN
      v_fails := v_fails + 1;
      RAISE WARNING 'FAIL: % (expected %)', r.label, r.expected;
      INSERT INTO zz_photo_authority_results VALUES (v_seq, r.label, 'FAIL');
    ELSE
      RAISE NOTICE 'ok: %', r.label;
      INSERT INTO zz_photo_authority_results VALUES (v_seq, r.label, 'ok');
    END IF;
  END LOOP;

  -- ---- summary ----
  -- Deliberately NOT a RAISE EXCEPTION here: the Management API discards every
  -- row from this whole batch if any statement raises, which would blank out
  -- the very cell-by-cell breakdown above. The verdict is a data row instead,
  -- visible on a passing run; the hard fail-loud gate lives after the
  -- top-level SELECT below (Important 5).
  v_seq := v_seq + 1;
  IF v_fails > 0 THEN
    RAISE WARNING '% assertion(s) FAILED', v_fails;
    INSERT INTO zz_photo_authority_results VALUES (v_seq, 'SUMMARY', v_fails || ' assertion(s) FAILED');
  ELSE
    RAISE NOTICE 'ALL PHOTO AUTHORITY ASSERTIONS PASSED';
    INSERT INTO zz_photo_authority_results VALUES (v_seq, 'SUMMARY', 'ALL PHOTO AUTHORITY ASSERTIONS PASSED');
  END IF;
END $suite$;

SELECT seq, label, status FROM zz_photo_authority_results ORDER BY seq;

-- Important 5: fail loud. On a pass this is a no-op and the SELECT above is
-- the last thing returned (HTTP 201, rows intact). On a fail it RAISEs, and
-- the Management API's all-or-nothing batch behaviour turns the whole
-- response into just this error (HTTP error, no rows) -- a loud failure with
-- less detail beats a silent HTTP 201 "pass" on a genuinely failing suite.
DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM zz_photo_authority_results WHERE status = 'FAIL') THEN
    RAISE EXCEPTION 'Photo authority suite FAILED -- see the SELECT above for which cell(s) failed.'
      USING ERRCODE = 'P0001';
  END IF;
END $guard$;

ROLLBACK;
