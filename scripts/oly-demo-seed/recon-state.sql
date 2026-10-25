with demo as (
  select os.*, i.name as inst_name
  from oly_schools os join institutions i on i.id = os.institution_id
  where i.name = 'New Flow Demo'
)
select jsonb_build_object(
  'school', (select to_jsonb(d) - 'created_at' - 'updated_at' from demo d),
  'campaign', (select to_jsonb(c) from oly_campaigns c, demo d where c.id = d.campaign_id),
  'grades', (
    select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.grade_name, 'number', g.grade_number) order by g.grade_number)
    from grade_levels g, demo d where g.id = any(d.participating_grade_level_ids)
  ),
  'subject_grade_catalog', (
    select jsonb_agg(row order by (row->>'grade')) from (
      select jsonb_build_object(
        'grade', g.grade_name,
        'grade_id', g.id,
        'subjects', (
          select jsonb_agg(jsonb_build_object(
            'id', s.id, 'name', s.name,
            'topics', (select count(*) from oly_topics t where t.subject_id = s.id and t.grade_level_id = g.id),
            'questions_active', (select count(*) from oly_questions q where q.subject_id = s.id and q.grade_level_id = g.id and q.status = 'active'),
            'materials', (select count(*) from oly_study_materials m where m.subject_id = s.id and m.grade_level_id = g.id)
          ) order by s.name)
          from oly_subjects s
          join oly_subject_classes sc on sc.subject_id = s.id and sc.grade_level_id = g.id
          where s.status = 'active'
        )
      ) as row
      from grade_levels g, demo d
      where g.id = any(d.participating_grade_level_ids)
    ) x
  ),
  'other_schools_sharing_grades', (
    select jsonb_agg(jsonb_build_object('school', i2.name, 'status', os2.status, 'grades',
      (select jsonb_agg(g2.grade_name) from grade_levels g2 where g2.id = any(os2.participating_grade_level_ids))))
    from oly_schools os2 join institutions i2 on i2.id = os2.institution_id, demo d
    where os2.id <> d.id
      and os2.participating_grade_level_ids && d.participating_grade_level_ids
  ),
  'existing_demo_data', (
    select jsonb_build_object(
      'students', (select count(*) from oly_students st where st.oly_school_id = d.id),
      'batches', (select count(*) from oly_batches b where b.oly_school_id = d.id),
      'teachers', (select count(*) from profiles p where p.institution_id = d.institution_id
                     and exists (select 1 from user_roles ur where ur.user_id = p.id and ur.role = 'teacher'))
    ) from demo d
  ),
  'all_grades_with_oly_subjects', (
    select jsonb_agg(distinct g.grade_name)
    from oly_subject_classes sc join grade_levels g on g.id = sc.grade_level_id
  )
) as state;
