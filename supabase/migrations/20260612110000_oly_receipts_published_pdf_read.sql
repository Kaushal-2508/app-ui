-- Published result/certificate PDFs live in the private olympiad-receipts
-- bucket, but the only storage policy was "super_admin can manage" — so the
-- client-side createSignedUrl() in useOlympiadPublishedResultUrl failed with
-- a permission error for school admins AND for the students themselves, even
-- though oly_get_published_signed_url_path had already authorized them.
-- Mirror that RPC's scope check (super admin / school admin of the owning
-- school / the student) as a storage SELECT policy via a SECURITY DEFINER
-- helper, keyed on the exact paths stored in oly_results.

create or replace function public.oly_can_read_published_pdf(p_path text, p_uid uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.oly_results r
     where (r.result_pdf_path = p_path or r.certificate_pdf_path = p_path)
       and (
         public.is_super_admin(p_uid)
         or public.oly_is_school_admin_for(p_uid, r.oly_school_id)
         or public.oly_student_can_read(p_uid, r.oly_student_id)
       )
  );
$$;

grant execute on function public.oly_can_read_published_pdf(text, uuid) to authenticated;

-- The helper looks rows up by exact PDF path — index both path columns so the
-- per-sign lookup never falls back to a seq scan as oly_results grows.
create index if not exists idx_oly_results_result_pdf_path
  on public.oly_results(result_pdf_path) where result_pdf_path is not null;
create index if not exists idx_oly_results_certificate_pdf_path
  on public.oly_results(certificate_pdf_path) where certificate_pdf_path is not null;

drop policy if exists "published result PDFs readable by scope" on storage.objects;
create policy "published result PDFs readable by scope"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'olympiad-receipts'
    and public.oly_can_read_published_pdf(name, auth.uid())
  );
