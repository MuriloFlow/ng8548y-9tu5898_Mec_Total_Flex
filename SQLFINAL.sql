-- ============================================================
-- TOTAL FLEX - SQL COMPLETO DO PROJETO
-- Mecânica Total Flex - Sistema de Oficina
--
-- COMO USAR:
--   1. Crie um projeto novo no Supabase (supabase.com)
--   2. Abra SQL Editor → New query
--   3. Cole e execute ESTE arquivo inteiro (Run)
--   4. Configure no .env do app:
--        NEXT_PUBLIC_SUPABASE_URL=https://SEU_PROJETO.supabase.co
--        NEXT_PUBLIC_SUPABASE_ANON_KEY=sua_anon_key
--        SUPABASE_SERVICE_ROLE_KEY=sua_service_role_key
--   5. Login padrão: totalflex / 1234
--
-- TABELAS CRIADAS (20):
--   company, employees, app_users, app_sessions,
--   customers, vehicles, mileage_records,
--   catalog_services, catalog_products,
--   service_orders, order_items, inspection_items,
--   photos (fotos da OS em data_url/base64),
--   quote_revisions, payments, documents,
--   reminders, audit_events, processed_operation_keys,
--   workshop_app_snapshots (backup JSON completo do app)
--
-- O app salva em DUAS camadas:
--   • Tabelas normalizadas (visíveis no Table Editor)
--   • Snapshot JSON (workshop_app_snapshots.state)
-- ============================================================

create extension if not exists pgcrypto;
create extension if not exists citext;
create extension if not exists pg_trgm;

set search_path = public, extensions;

create table if not exists public.company (
  id text primary key,
  name text not null,
  trade_name text not null,
  phone text not null default '',
  whatsapp text not null default '',
  address text not null default '',
  city text not null default '',
  state text not null default '',
  tax_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.employees (
  id text primary key,
  company_id text references public.company(id) on delete restrict,
  name text not null,
  role text not null check (role in ('admin', 'attendant', 'mechanic')),
  phone text,
  email text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.employees add column if not exists company_id text;
alter table public.employees add column if not exists updated_at timestamptz not null default now();

create table if not exists public.app_users (
  id text primary key,
  company_id text references public.company(id) on delete restrict,
  employee_id text references public.employees(id) on delete set null,
  username citext unique,
  display_name text,
  password_hash text,
  role text not null default 'admin' check (role in ('admin', 'attendant', 'mechanic')),
  active boolean not null default true,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.app_users add column if not exists company_id text;
alter table public.app_users add column if not exists employee_id text;
alter table public.app_users add column if not exists display_name text;
alter table public.app_users add column if not exists password_hash text;
alter table public.app_users add column if not exists last_login_at timestamptz;
alter table public.app_users add column if not exists updated_at timestamptz not null default now();

do $$
begin
  alter table public.app_users
    add constraint app_users_company_id_fkey
    foreign key (company_id) references public.company(id) on delete restrict;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.app_users
    add constraint app_users_employee_id_fkey
    foreign key (employee_id) references public.employees(id) on delete set null;
exception when duplicate_object then null;
end $$;

create table if not exists public.app_sessions (
  id uuid primary key default gen_random_uuid(),
  app_user_id text not null references public.app_users(id) on delete cascade,
  token_hash text not null unique,
  user_agent text,
  ip inet,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create table if not exists public.customers (
  id text primary key,
  company_id text references public.company(id) on delete restrict,
  cpf text not null,
  cpf_hash text,
  name text not null,
  phone text not null,
  email text,
  no_email boolean not null default false,
  address text,
  district text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint customers_email_or_no_email check (no_email or nullif(email, '') is not null)
);

alter table public.customers add column if not exists company_id text;
alter table public.customers add column if not exists cpf_hash text;
alter table public.customers add column if not exists updated_at timestamptz not null default now();
alter table public.customers add column if not exists deleted_at timestamptz;

drop index if exists public.customers_company_cpf_active_unique;
create unique index if not exists customers_company_cpf_hash_active_unique
  on public.customers(company_id, cpf_hash)
  where deleted_at is null and cpf_hash is not null;
create index if not exists customers_name_trgm_idx on public.customers using gin (name gin_trgm_ops);
create index if not exists customers_phone_idx on public.customers(company_id, phone);

create table if not exists public.vehicles (
  id text primary key,
  company_id text references public.company(id) on delete restrict,
  customer_id text not null references public.customers(id) on delete restrict,
  plate text not null,
  brand text not null,
  model text not null,
  version text,
  year integer,
  color text,
  category text not null default 'car' check (category in ('car', 'motorcycle', 'truck', 'van', 'other')),
  lookup_status text not null default 'manual',
  lookup_provider text,
  image_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint vehicles_year_valid check (year is null or year between 1950 and extract(year from now())::int + 1)
);

alter table public.vehicles add column if not exists company_id text;
alter table public.vehicles add column if not exists updated_at timestamptz not null default now();
alter table public.vehicles add column if not exists deleted_at timestamptz;

create unique index if not exists vehicles_company_plate_active_unique
  on public.vehicles(company_id, plate)
  where deleted_at is null;
create index if not exists vehicles_customer_idx on public.vehicles(customer_id);
create index if not exists vehicles_model_trgm_idx
  on public.vehicles using gin ((brand || ' ' || model || ' ' || coalesce(version, '')) gin_trgm_ops);

create table if not exists public.mileage_records (
  id text primary key,
  company_id text references public.company(id) on delete restrict,
  vehicle_id text not null references public.vehicles(id) on delete cascade,
  order_id text,
  mileage integer not null check (mileage >= 0),
  recorded_at timestamptz not null default now()
);

alter table public.mileage_records add column if not exists company_id text;

create table if not exists public.catalog_services (
  id text primary key,
  company_id text references public.company(id) on delete restrict,
  name text not null,
  description text,
  internal_code text,
  default_price numeric(12,2) not null default 0 check (default_price >= 0),
  default_labor numeric(12,2) not null default 0 check (default_labor >= 0),
  cost numeric(12,2) not null default 0 check (cost >= 0),
  estimated_minutes integer not null default 0 check (estimated_minutes >= 0),
  category text not null default '',
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.catalog_services add column if not exists company_id text;
alter table public.catalog_services add column if not exists updated_at timestamptz not null default now();

create unique index if not exists catalog_services_company_internal_code_unique
  on public.catalog_services(company_id, internal_code)
  where internal_code is not null;

create table if not exists public.catalog_products (
  id text primary key,
  company_id text references public.company(id) on delete restrict,
  name text not null,
  description text,
  sku text not null,
  default_price numeric(12,2) not null default 0 check (default_price >= 0),
  cost numeric(12,2) not null default 0 check (cost >= 0),
  stock_quantity integer not null default 0 check (stock_quantity >= 0),
  category text not null default '',
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.catalog_products add column if not exists company_id text;
alter table public.catalog_products add column if not exists updated_at timestamptz not null default now();

create unique index if not exists catalog_products_company_sku_unique
  on public.catalog_products(company_id, sku);

create table if not exists public.service_orders (
  id text primary key,
  company_id text references public.company(id) on delete restrict,
  number text not null unique,
  customer_id text not null references public.customers(id) on delete restrict,
  vehicle_id text not null references public.vehicles(id) on delete restrict,
  status text not null default 'draft' check (status in ('draft', 'waiting_approval', 'approved', 'in_service', 'waiting_parts', 'finished', 'delivered', 'cancelled')),
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid', 'partial', 'paid', 'refunded', 'cancelled')),
  current_mileage integer not null default 0 check (current_mileage >= 0),
  fuel_level numeric(5,2) not null default 0 check (fuel_level between 0 and 100),
  entry_state text not null default '',
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  advisor_id text,
  mechanic_id text,
  estimated_delivery_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  delivered_at timestamptz,
  diagnosis text,
  mechanic_recommendations text,
  customer_notes text,
  internal_notes text,
  customer_signature_data_url text,
  mechanic_signature_data_url text,
  final_labor_amount numeric(12,2) not null default 0 check (final_labor_amount >= 0),
  approved_quote_revision_id text,
  idempotency_key text unique,
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table public.service_orders add column if not exists company_id text;
alter table public.service_orders add column if not exists final_labor_amount numeric(12,2) not null default 0;
alter table public.service_orders add column if not exists updated_at timestamptz not null default now();
alter table public.service_orders add column if not exists deleted_at timestamptz;

create index if not exists service_orders_company_status_idx on public.service_orders(company_id, status);
create index if not exists service_orders_company_payment_idx on public.service_orders(company_id, payment_status);
create index if not exists service_orders_number_trgm_idx on public.service_orders using gin (number gin_trgm_ops);

create table if not exists public.order_items (
  id text primary key,
  company_id text references public.company(id) on delete restrict,
  order_id text not null references public.service_orders(id) on delete cascade,
  type text not null check (type in ('service', 'part', 'custom')),
  catalog_id text,
  description text not null,
  quantity numeric(12,3) not null default 1 check (quantity > 0),
  unit_price numeric(12,2) not null default 0 check (unit_price >= 0),
  labor_price numeric(12,2) not null default 0 check (labor_price >= 0),
  discount numeric(12,2) not null default 0 check (discount >= 0),
  cost numeric(12,2) not null default 0 check (cost >= 0),
  notes text,
  done_at timestamptz,
  done_by text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.order_items add column if not exists company_id text;
alter table public.order_items add column if not exists updated_at timestamptz not null default now();

create index if not exists order_items_order_sort_idx on public.order_items(order_id, sort_order, created_at);

create table if not exists public.inspection_items (
  id text primary key,
  company_id text references public.company(id) on delete restrict,
  order_id text not null references public.service_orders(id) on delete cascade,
  label text not null,
  category text not null,
  status text not null default 'not_applicable' check (status in ('ok', 'attention', 'damaged', 'not_applicable')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.inspection_items add column if not exists company_id text;
alter table public.inspection_items add column if not exists updated_at timestamptz not null default now();

create index if not exists inspection_items_order_idx on public.inspection_items(order_id);

create table if not exists public.photos (
  id text primary key,
  company_id text references public.company(id) on delete restrict,
  order_id text not null references public.service_orders(id) on delete cascade,
  label text not null,
  data_url text not null,
  created_at timestamptz not null default now(),
  created_by text
);

alter table public.photos add column if not exists company_id text;

create index if not exists photos_order_idx on public.photos(order_id);

create table if not exists public.quote_revisions (
  id text primary key,
  company_id text references public.company(id) on delete restrict,
  order_id text not null references public.service_orders(id) on delete cascade,
  version integer not null check (version >= 1),
  status text not null default 'draft' check (status in ('draft', 'sent', 'approved', 'rejected', 'expired')),
  subtotal_parts numeric(12,2) not null default 0,
  subtotal_labor numeric(12,2) not null default 0,
  discount numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  items_snapshot jsonb not null default '[]'::jsonb,
  sent_at timestamptz,
  approved_at timestamptz,
  approved_by text,
  created_at timestamptz not null default now(),
  created_by text,
  unique(order_id, version)
);

alter table public.quote_revisions add column if not exists company_id text;

create table if not exists public.payments (
  id text primary key,
  company_id text references public.company(id) on delete restrict,
  order_id text not null references public.service_orders(id) on delete cascade,
  method text not null check (method in ('pix', 'cash', 'debit', 'credit', 'transfer', 'other')),
  amount numeric(12,2) not null check (amount > 0),
  status text not null default 'confirmed' check (status in ('pending', 'confirmed', 'cancelled')),
  reference text,
  paid_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  created_by text,
  idempotency_key text unique not null
);

alter table public.payments add column if not exists company_id text;

create index if not exists payments_order_idx on public.payments(order_id);

create table if not exists public.documents (
  id text primary key,
  company_id text references public.company(id) on delete restrict,
  order_id text not null references public.service_orders(id) on delete cascade,
  type text not null check (type in ('service_order', 'quote', 'receipt', 'fiscal_receipt')),
  status text not null default 'generated' check (status in ('draft', 'generated', 'cancelled')),
  version integer not null check (version >= 1),
  public_token text not null unique,
  total numeric(12,2) not null default 0,
  created_at timestamptz not null default now(),
  created_by text,
  idempotency_key text unique not null,
  unique(order_id, type, version)
);

alter table public.documents add column if not exists company_id text;

create table if not exists public.reminders (
  id text primary key,
  company_id text references public.company(id) on delete restrict,
  customer_id text not null references public.customers(id) on delete cascade,
  vehicle_id text not null references public.vehicles(id) on delete cascade,
  order_id text,
  title text not null,
  due_date date,
  due_mileage integer,
  status text not null default 'open' check (status in ('open', 'done', 'cancelled')),
  notes text,
  created_at timestamptz not null default now()
);

alter table public.reminders add column if not exists company_id text;

create index if not exists reminders_due_idx on public.reminders(company_id, due_date);

create table if not exists public.audit_events (
  id text primary key,
  company_id text references public.company(id) on delete set null,
  entity_type text not null,
  entity_id text,
  action text not null,
  user_id text,
  before_data jsonb,
  after_data jsonb,
  occurred_at timestamptz not null default now(),
  summary text not null
);

alter table public.audit_events add column if not exists company_id text;

create index if not exists audit_events_time_idx on public.audit_events(company_id, occurred_at desc);

create table if not exists public.processed_operation_keys (
  key text primary key,
  company_id text references public.company(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.processed_operation_keys add column if not exists company_id text;

create table if not exists public.workshop_app_snapshots (
  id text primary key default 'singleton',
  company_id text not null default '00000000-0000-4000-8000-000000000001',
  state jsonb not null default '{}'::jsonb,
  updated_by text,
  updated_at timestamptz not null default now()
);

alter table public.workshop_app_snapshots add column if not exists id text;
alter table public.workshop_app_snapshots add column if not exists company_id text;
alter table public.workshop_app_snapshots add column if not exists state jsonb not null default '{}'::jsonb;
alter table public.workshop_app_snapshots add column if not exists updated_by text;
alter table public.workshop_app_snapshots add column if not exists updated_at timestamptz not null default now();

with ranked_snapshots as (
  select
    ctid,
    row_number() over (order by updated_at desc nulls last) as rn
  from public.workshop_app_snapshots
  where id is null
)
update public.workshop_app_snapshots target
set id = case
  when ranked_snapshots.rn = 1 then 'singleton'
  else 'legacy-snapshot-' || ranked_snapshots.rn::text
end
from ranked_snapshots
where target.ctid = ranked_snapshots.ctid;

create unique index if not exists workshop_app_snapshots_id_unique
  on public.workshop_app_snapshots(id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.app_verify_login(
  p_username text,
  p_password text,
  p_user_agent text default null,
  p_ip inet default null
)
returns table (
  user_id text,
  company_id text,
  employee_id text,
  username text,
  display_name text,
  role text,
  session_token text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user public.app_users%rowtype;
  v_token text;
  v_expires timestamptz;
begin
  select *
    into v_user
  from public.app_users
  where app_users.username = lower(trim(p_username))::citext
    and active = true;

  if not found or v_user.password_hash is null or v_user.password_hash <> crypt(p_password, v_user.password_hash) then
    raise exception 'invalid_credentials' using errcode = '28000';
  end if;

  v_token = encode(gen_random_bytes(32), 'hex');
  v_expires = now() + interval '12 hours';

  insert into public.app_sessions(app_user_id, token_hash, user_agent, ip, expires_at)
  values (v_user.id, encode(digest(v_token, 'sha256'), 'hex'), p_user_agent, p_ip, v_expires);

  update public.app_users
  set last_login_at = now(), updated_at = now()
  where id = v_user.id;

  return query
  select
    v_user.id::text,
    v_user.company_id::text,
    v_user.employee_id::text,
    v_user.username::text,
    coalesce(v_user.display_name, v_user.username::text),
    v_user.role::text,
    v_token,
    v_expires;
end;
$$;

do $$
declare
  r record;
begin
  for r in
    select tablename
    from pg_tables
    where schemaname = 'public'
      and tablename in (
        'company', 'employees', 'app_users', 'app_sessions', 'customers', 'vehicles',
        'mileage_records', 'catalog_services', 'catalog_products', 'service_orders',
        'order_items', 'inspection_items', 'photos', 'quote_revisions', 'payments',
        'documents', 'reminders', 'audit_events', 'processed_operation_keys',
        'workshop_app_snapshots'
      )
  loop
    execute format('alter table public.%I enable row level security', r.tablename);

    if not exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = r.tablename
        and policyname = 'service_role_all'
    ) then
      execute format(
        'create policy service_role_all on public.%I for all using (auth.role() = %L) with check (auth.role() = %L)',
        r.tablename,
        'service_role',
        'service_role'
      );
    end if;
  end loop;
end $$;

insert into public.company(id, name, trade_name, phone, whatsapp, address, city, state)
values (
  '00000000-0000-4000-8000-000000000001',
  'Auto Mecanica Total Flex',
  'Total Flex',
  '11948499650',
  '11948499650',
  'Estrada Cata Preta, 898 - Vila Joao Ramalho',
  'Santo Andre',
  'SP'
)
on conflict (id) do update
set name = excluded.name,
    trade_name = excluded.trade_name,
    phone = excluded.phone,
    whatsapp = excluded.whatsapp,
    address = excluded.address,
    city = excluded.city,
    state = excluded.state,
    updated_at = now();

insert into public.employees(id, company_id, name, role, phone, active)
values (
  '00000000-0000-4000-8000-000000000011',
  '00000000-0000-4000-8000-000000000001',
  'Total Flex',
  'admin',
  '11948499650',
  true
)
on conflict (id) do update
set company_id = excluded.company_id,
    name = excluded.name,
    role = excluded.role,
    phone = excluded.phone,
    active = excluded.active,
    updated_at = now();

insert into public.app_users(id, company_id, employee_id, username, display_name, password_hash, role, active)
values (
  '00000000-0000-4000-8000-000000000021',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000011',
  'totalflex',
  'Total Flex',
  crypt('1234', gen_salt('bf')),
  'admin',
  true
)
on conflict (username) do update
set company_id = excluded.company_id,
    employee_id = excluded.employee_id,
    display_name = excluded.display_name,
    password_hash = excluded.password_hash,
    role = excluded.role,
    active = excluded.active,
    updated_at = now();

do $$
declare
  v_now text := to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_state jsonb;
begin
  v_state := jsonb_build_object(
    'company', jsonb_build_object(
      'id', '00000000-0000-4000-8000-000000000001',
      'name', 'Auto Mecanica Total Flex',
      'tradeName', 'Total Flex',
      'phone', '11948499650',
      'whatsapp', '11948499650',
      'address', 'Estrada Cata Preta, 898 - Vila Joao Ramalho',
      'city', 'Santo Andre',
      'state', 'SP'
    ),
    'users', jsonb_build_array(jsonb_build_object(
      'id', '00000000-0000-4000-8000-000000000021',
      'username', 'totalflex',
      'displayName', 'Total Flex',
      'role', 'admin',
      'active', true,
      'employeeId', '00000000-0000-4000-8000-000000000011',
      'createdAt', v_now
    )),
    'employees', jsonb_build_array(jsonb_build_object(
      'id', '00000000-0000-4000-8000-000000000011',
      'name', 'Total Flex',
      'role', 'admin',
      'phone', '11948499650',
      'active', true,
      'createdAt', v_now
    )),
    'customers', '[]'::jsonb,
    'vehicles', '[]'::jsonb,
    'mileageRecords', '[]'::jsonb,
    'services', '[]'::jsonb,
    'products', '[]'::jsonb,
    'orders', '[]'::jsonb,
    'orderItems', '[]'::jsonb,
    'inspectionItems', '[]'::jsonb,
    'photos', '[]'::jsonb,
    'quoteRevisions', '[]'::jsonb,
    'payments', '[]'::jsonb,
    'documents', '[]'::jsonb,
    'reminders', '[]'::jsonb,
    'auditEvents', '[]'::jsonb,
    'fiscalIntegration', jsonb_build_object('status', 'not_configured'),
    'processedOperationKeys', '[]'::jsonb,
    'updatedAt', v_now
  );

  insert into public.workshop_app_snapshots(id, company_id, state, updated_by, updated_at)
  values (
    'singleton',
    '00000000-0000-4000-8000-000000000001',
    v_state,
    '00000000-0000-4000-8000-000000000021',
    now()
  )
  on conflict (id) do update
  set company_id = excluded.company_id,
      state = case
        when public.workshop_app_snapshots.state is null
          or public.workshop_app_snapshots.state = '{}'::jsonb
          or public.workshop_app_snapshots.state->>'updatedAt' is null
        then excluded.state
        else public.workshop_app_snapshots.state
      end,
      updated_by = excluded.updated_by,
      updated_at = case
        when public.workshop_app_snapshots.state is null
          or public.workshop_app_snapshots.state = '{}'::jsonb
          or public.workshop_app_snapshots.state->>'updatedAt' is null
        then excluded.updated_at
        else public.workshop_app_snapshots.updated_at
      end;
end $$;

grant execute on function public.app_verify_login(text, text, text, inet) to anon, authenticated, service_role;

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

select 'ok: company' as check_name, count(*) as rows from public.company;
select 'ok: admin user' as check_name, username from public.app_users where username = 'totalflex';
select 'ok: snapshot' as check_name, state->>'updatedAt' as updated_at from public.workshop_app_snapshots where id = 'singleton';
