-- Verification: exercise the very RPCs/queries the UI runs.
update oly_campaigns set status = 'active', updated_at = now()
 where id = 'd1c8db0f-a956-4e62-88b1-fd753c9e9714' and status = 'draft';

-- Simulate the signed-in school admin for SECURITY DEFINER auth.uid() checks
select set_config('request.jwt.claims',
  '{"sub":"f575aec2-8ca6-4598-aee4-551fa9db8a59","role":"authenticated"}', false);

select jsonb_build_object(
  'analytics_rpc', (select oly_school_report('edec11b2-2604-4e58-bfdb-2dfa05f8d3a1')),
  'absentees_pool', (
    select count(*) from oly_students s
    where s.oly_school_id = 'edec11b2-2604-4e58-bfdb-2dfa05f8d3a1' and s.status = 'active'
      and not exists (
        select 1 from oly_batch_assignments ba
        join oly_batches b on b.id = ba.oly_batch_id
        where ba.oly_student_id = s.id and b.status <> 'cancelled')
  ),
  'publish_job', (select to_jsonb(j) - 'created_at' - 'updated_at' - 'id'
                    from oly_publish_jobs j
                   where j.oly_school_id = 'edec11b2-2604-4e58-bfdb-2dfa05f8d3a1'),
  'tier_counts', (select jsonb_object_agg(certificate_tier, n) from (
      select certificate_tier, count(*) as n from oly_results
      where oly_school_id = 'edec11b2-2604-4e58-bfdb-2dfa05f8d3a1'
      group by certificate_tier) t),
  'batches', (select jsonb_agg(jsonb_build_object('label', batch_label, 'pin', pin,
      'status', status, 'enrolled', (select count(*) from oly_batch_assignments ba where ba.oly_batch_id = b.id))
      order by batch_label)
    from oly_batches b where b.oly_school_id = 'edec11b2-2604-4e58-bfdb-2dfa05f8d3a1'),
  'study_materials_visible', (select count(*) from oly_study_materials m
    where m.grade_level_id in ('d9ec752e-e972-447c-b099-ccf502d554ab','17bf8c34-4bb6-404b-820c-ae58ea359c16'))
) as verification;
