-- Execute UMA VEZ no Supabase → SQL Editor → Run
-- Corrige: "Could not find the 'cpf_hash' column of 'customers' in the schema cache"

alter table public.customers add column if not exists cpf_hash text;

drop index if exists public.customers_company_cpf_active_unique;

create unique index if not exists customers_company_cpf_hash_active_unique
  on public.customers(company_id, cpf_hash)
  where deleted_at is null and cpf_hash is not null;

-- Permite que o app aplique patches automaticamente nos proximos syncs
create or replace function public.tf_apply_schema_patches()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  alter table public.customers add column if not exists cpf_hash text;
  drop index if exists public.customers_company_cpf_active_unique;
  create unique index if not exists customers_company_cpf_hash_active_unique
    on public.customers(company_id, cpf_hash)
    where deleted_at is null and cpf_hash is not null;
  return jsonb_build_object('ok', true);
exception when others then
  return jsonb_build_object('ok', false, 'error', SQLERRM);
end;
$$;

grant execute on function public.tf_apply_schema_patches() to service_role;
