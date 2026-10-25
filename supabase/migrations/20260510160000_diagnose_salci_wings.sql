-- Diagnostic — counts wing_assignments + wing_class_mappings for Salci.
-- Read-only. Logs to NOTICE.

DO $diag$
DECLARE
  v_inst       UUID;
  v_jr_wing    UUID;
  v_sr_wing    UUID;
  v_coord_id   UUID;
  v_wa_count   INTEGER;
  v_wcm_jr     INTEGER;
  v_wcm_sr     INTEGER;
  v_active_jr  INTEGER;
  v_classes    INTEGER;
  rec          RECORD;
BEGIN
  SELECT id INTO v_inst FROM public.institutions WHERE name = 'Salci National School';
  RAISE NOTICE 'institution_id = %', v_inst;

  SELECT id INTO v_jr_wing FROM public.wings WHERE institution_id = v_inst AND name = 'Junior Wing';
  SELECT id INTO v_sr_wing FROM public.wings WHERE institution_id = v_inst AND name = 'Senior Wing';
  RAISE NOTICE 'junior_wing_id = % | senior_wing_id = %', v_jr_wing, v_sr_wing;

  SELECT id INTO v_coord_id FROM auth.users WHERE email = 'coordinator.junior@salci-test.in';
  RAISE NOTICE 'coordinator.junior auth.users id = %', v_coord_id;

  SELECT COUNT(*) INTO v_wa_count
  FROM public.wing_assignments WHERE user_id = v_coord_id;
  RAISE NOTICE 'wing_assignments rows for coordinator.junior: %', v_wa_count;

  SELECT COUNT(*) INTO v_wcm_jr
  FROM public.wing_class_mappings WHERE wing_id = v_jr_wing;
  SELECT COUNT(*) INTO v_wcm_sr
  FROM public.wing_class_mappings WHERE wing_id = v_sr_wing;
  RAISE NOTICE 'wing_class_mappings: junior=% senior=%', v_wcm_jr, v_wcm_sr;

  SELECT COUNT(*) INTO v_active_jr
  FROM public.wing_class_mappings wcm
  JOIN public.classes c ON c.id = wcm.class_id
  WHERE wcm.wing_id = v_jr_wing AND c.is_active = true;
  RAISE NOTICE 'junior wing classes that are is_active=true: %', v_active_jr;

  SELECT COUNT(*) INTO v_classes
  FROM public.classes WHERE institution_id = v_inst AND is_active = true;
  RAISE NOTICE 'active classes in institution: %', v_classes;

  RAISE NOTICE 'classes by academic_year:';
  FOR rec IN
    SELECT academic_year, COUNT(*) AS n
    FROM public.classes
    WHERE institution_id = v_inst
    GROUP BY academic_year
    ORDER BY academic_year
  LOOP
    RAISE NOTICE '  ay=% count=%', rec.academic_year, rec.n;
  END LOOP;
END;
$diag$;
