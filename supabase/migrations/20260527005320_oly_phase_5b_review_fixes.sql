-- Phase 5b review fixes:
--   1. Drop NOT NULL on oly_impersonation_log.super_admin_id (§21 cascade trap — NOT NULL + ON DELETE SET NULL blocks super_admin profile deletion)
--   2. Add UNIQUE(roll_number, campaign_year) on oly_results_archive so day60 ON CONFLICT actually idempotents
--   3. Tighten dormancy RPC grants — service_role only; revoke from authenticated (cron-only, not user-callable)

-- =========================================================================
-- 1. Cascade-safety: super_admin_id allowed to be NULL after super-admin deletion
-- =========================================================================
alter table public.oly_impersonation_log alter column super_admin_id drop not null;

-- =========================================================================
-- 2. Idempotency: enforce uniqueness so ON CONFLICT in oly_dormancy_day60 has a target
-- A cron retry must not double-insert the same student's archive row.
-- =========================================================================
alter table public.oly_results_archive
  add constraint oly_results_archive_roll_year_uniq unique (roll_number, campaign_year);

create or replace function public.oly_dormancy_day60(p_campaign_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_purged integer := 0;
  v_auth_ids uuid[] := '{}';
  v_pdf_paths text[] := '{}';
  v_student record;
begin
  for v_student in
    select s.id, s.auth_user_id, s.roll_number, s.oly_school_id, s.campaign_id,
           s.class_label, s.subject_ids,
           r.id as result_id, r.total_marks_obtained, r.total_max_marks, r.percentage,
           r.subject_scores, r.certificate_tier, r.certificate_id,
           r.class_rank, r.school_rank, r.total_time_seconds,
           r.result_pdf_path, r.certificate_pdf_path,
           sc.school_short_code, c.campaign_year
      from public.oly_students s
      join public.oly_results r on r.oly_student_id = s.id
      join public.oly_schools sc on sc.id = s.oly_school_id
      join public.oly_campaigns c on c.id = sc.campaign_id
     where s.status = 'dormant'
       and s.profile_id is null
       and s.updated_at < now() - interval '30 days'
       and (p_campaign_id is null or s.campaign_id = p_campaign_id)
  loop
    insert into public.oly_results_archive (
      roll_number, school_short_code, class_label, campaign_year,
      subject_ids, total_marks_obtained, total_max_marks, percentage,
      subject_scores, certificate_tier, certificate_id,
      class_rank, school_rank, total_time_seconds
    ) values (
      v_student.roll_number, v_student.school_short_code, v_student.class_label, v_student.campaign_year,
      v_student.subject_ids, v_student.total_marks_obtained, v_student.total_max_marks, v_student.percentage,
      v_student.subject_scores, v_student.certificate_tier, v_student.certificate_id,
      v_student.class_rank, v_student.school_rank, v_student.total_time_seconds
    )
    on conflict (roll_number, campaign_year) do nothing;

    if v_student.auth_user_id is not null then
      v_auth_ids := v_auth_ids || v_student.auth_user_id;
    end if;
    if v_student.result_pdf_path is not null then
      v_pdf_paths := v_pdf_paths || v_student.result_pdf_path;
    end if;
    if v_student.certificate_pdf_path is not null then
      v_pdf_paths := v_pdf_paths || v_student.certificate_pdf_path;
    end if;

    update public.oly_students
       set full_name = '[PURGED]',
           parent_name = '[PURGED]',
           parent_phone = '[PURGED]',
           parent_email = null,
           date_of_birth = '1900-01-01'::date,
           status = 'archived',
           updated_at = now()
     where id = v_student.id;

    v_purged := v_purged + 1;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'purged', v_purged,
    'auth_user_ids_to_delete', to_jsonb(v_auth_ids),
    'storage_paths_to_delete', to_jsonb(v_pdf_paths)
  );
end;
$$;

-- =========================================================================
-- 3. Defense-in-depth: dormancy RPCs are cron-invoked only.
-- Revoke from authenticated; service_role retains access via default.
-- =========================================================================
revoke execute on function public.oly_dormancy_day30(uuid) from authenticated;
revoke execute on function public.oly_dormancy_day60(uuid) from authenticated;
revoke execute on function public.oly_cleanup_stuck_attempts() from authenticated;
