create extension if not exists pgcrypto;
create extension if not exists pg_trgm;
create extension if not exists citext;

do $$
begin
  create type app_role as enum ('admin', 'attendant', 'mechanic');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type order_status as enum ('draft', 'waiting_approval', 'approved', 'in_service', 'waiting_parts', 'finished', 'delivered', 'cancelled');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type payment_status as enum ('unpaid', 'partial', 'paid', 'refunded', 'cancelled');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type payment_method as enum ('pix', 'cash', 'debit', 'credit', 'transfer', 'other');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type priority_level as enum ('low', 'normal', 'high', 'urgent');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type inspection_status as enum ('ok', 'attention', 'damaged', 'not_applicable');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type quote_status as enum ('draft', 'sent', 'approved', 'rejected', 'expired');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type document_type as enum ('service_order', 'quote', 'receipt', 'fiscal_receipt');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type document_status as enum ('draft', 'generated', 'cancelled');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type catalog_status as enum ('active', 'inactive');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type fiscal_provider_status as enum ('not_configured', 'ready', 'unavailable');
exception when duplicate_object then null;
end $$;

create table if not exists companies (
  id uuid primary key default gen_random_uuid(),
  legal_name text not null,
  trade_name text not null,
  tax_id text,
  phone text not null,
  whatsapp text,
  address text not null,
  city text not null,
  state text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists employees (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete restrict,
  name text not null,
  role app_role not null,
  phone text,
  email text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists app_users (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete restrict,
  employee_id uuid references employees(id) on delete set null,
  username citext unique,
  password_hash text not null,
  role app_role not null,
  active boolean not null default true,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists app_sessions (
  id uuid primary key default gen_random_uuid(),
  app_user_id uuid not null references app_users(id) on delete cascade,
  token_hash text not null unique,
  user_agent text,
  ip inet,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete restrict,
  cpf char(11) not null,
  name text not null,
  phone text not null,
  email text,
  no_email boolean not null default false,
  address text,
  district text,
  notes text,
  created_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint customers_cpf_digits check (cpf ~ '^[0-9]{11}$'),
  constraint customers_email_or_no_email check (no_email or nullif(email, '') is not null)
);

create unique index if not exists customers_company_cpf_active_unique
  on customers(company_id, cpf)
  where deleted_at is null;

create index if not exists customers_name_trgm_idx on customers using gin (name gin_trgm_ops);
create index if not exists customers_phone_idx on customers(company_id, phone);

create table if not exists vehicles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete restrict,
  customer_id uuid not null references customers(id) on delete restrict,
  plate text not null,
  brand text not null,
  model text not null,
  version text,
  year integer,
  color text,
  category text not null default 'car',
  lookup_status text not null default 'manual',
  lookup_provider text,
  image_url text,
  created_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint vehicles_plate_format check (plate ~ '^[A-Z]{3}[0-9A-Z][0-9][0-9A-Z][0-9]$' or plate ~ '^[A-Z]{3}[0-9]{4}$'),
  constraint vehicles_year_valid check (year is null or year between 1950 and extract(year from now())::int + 1)
);

create unique index if not exists vehicles_company_plate_active_unique
  on vehicles(company_id, plate)
  where deleted_at is null;

create index if not exists vehicles_model_trgm_idx on vehicles using gin ((brand || ' ' || model || ' ' || coalesce(version, '')) gin_trgm_ops);

create table if not exists vehicle_mileage_history (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete restrict,
  vehicle_id uuid not null references vehicles(id) on delete cascade,
  service_order_id uuid,
  mileage integer not null check (mileage >= 0),
  recorded_at timestamptz not null default now(),
  created_by uuid references app_users(id) on delete set null
);

create table if not exists catalog_services (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete restrict,
  name text not null,
  description text,
  internal_code text,
  default_price numeric(12,2) not null default 0 check (default_price >= 0),
  default_labor numeric(12,2) not null default 0 check (default_labor >= 0),
  cost numeric(12,2) not null default 0 check (cost >= 0),
  estimated_minutes integer not null default 0 check (estimated_minutes >= 0),
  category text not null,
  status catalog_status not null default 'active',
  created_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists catalog_services_company_internal_code_unique
  on catalog_services(company_id, internal_code)
  where internal_code is not null;

create table if not exists catalog_products (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete restrict,
  name text not null,
  description text,
  sku text not null,
  default_price numeric(12,2) not null default 0 check (default_price >= 0),
  cost numeric(12,2) not null default 0 check (cost >= 0),
  stock_quantity integer not null default 0 check (stock_quantity >= 0),
  category text not null,
  status catalog_status not null default 'active',
  created_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists catalog_products_company_sku_unique on catalog_products(company_id, sku);

create sequence if not exists service_order_number_seq;

create table if not exists service_orders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete restrict,
  number text not null unique,
  customer_id uuid not null references customers(id) on delete restrict,
  vehicle_id uuid not null references vehicles(id) on delete restrict,
  status order_status not null default 'draft',
  payment_status payment_status not null default 'unpaid',
  current_mileage integer not null check (current_mileage >= 0),
  fuel_level numeric(5,2) not null default 0 check (fuel_level between 0 and 100),
  entry_state text not null,
  priority priority_level not null default 'normal',
  advisor_id uuid references employees(id) on delete set null,
  mechanic_id uuid references employees(id) on delete set null,
  estimated_delivery_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  delivered_at timestamptz,
  diagnosis text,
  mechanic_recommendations text,
  customer_notes text,
  internal_notes text,
  customer_signature_storage_path text,
  approved_quote_revision_id uuid,
  idempotency_key text unique,
  version integer not null default 1 check (version >= 1),
  created_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists service_orders_company_status_idx on service_orders(company_id, status);
create index if not exists service_orders_company_payment_idx on service_orders(company_id, payment_status);
create index if not exists service_orders_number_trgm_idx on service_orders using gin (number gin_trgm_ops);

alter table vehicle_mileage_history
  drop constraint if exists vehicle_mileage_history_service_order_id_fkey;

alter table vehicle_mileage_history
  add constraint vehicle_mileage_history_service_order_id_fkey
  foreign key (service_order_id) references service_orders(id) on delete set null;

create table if not exists service_order_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete restrict,
  service_order_id uuid not null references service_orders(id) on delete cascade,
  item_type text not null check (item_type in ('service', 'part', 'custom')),
  catalog_service_id uuid references catalog_services(id) on delete set null,
  catalog_product_id uuid references catalog_products(id) on delete set null,
  description text not null,
  quantity numeric(12,3) not null default 1 check (quantity > 0),
  unit_price numeric(12,2) not null default 0 check (unit_price >= 0),
  labor_price numeric(12,2) not null default 0 check (labor_price >= 0),
  discount numeric(12,2) not null default 0 check (discount >= 0),
  cost numeric(12,2) not null default 0 check (cost >= 0),
  notes text,
  done_at timestamptz,
  done_by uuid references app_users(id) on delete set null,
  sort_order integer not null default 0,
  created_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table service_order_items
  add column if not exists done_at timestamptz,
  add column if not exists done_by uuid references app_users(id) on delete set null,
  add column if not exists sort_order integer not null default 0;

create index if not exists service_order_items_order_sort_idx on service_order_items(service_order_id, sort_order, created_at);

create table if not exists inspection_templates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete restrict,
  label text not null,
  category text not null,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists service_order_inspections (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete restrict,
  service_order_id uuid not null references service_orders(id) on delete cascade,
  template_id uuid references inspection_templates(id) on delete set null,
  label text not null,
  category text not null,
  status inspection_status not null default 'ok',
  notes text,
  created_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists vehicle_photos (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete restrict,
  service_order_id uuid not null references service_orders(id) on delete cascade,
  label text not null,
  storage_path text not null,
  mime_type text,
  size_bytes bigint,
  created_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists quote_revisions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete restrict,
  service_order_id uuid not null references service_orders(id) on delete cascade,
  version integer not null check (version >= 1),
  status quote_status not null default 'draft',
  subtotal_parts numeric(12,2) not null default 0,
  subtotal_labor numeric(12,2) not null default 0,
  discount numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  items_snapshot jsonb not null default '[]'::jsonb,
  sent_at timestamptz,
  approved_at timestamptz,
  approved_by_customer_id uuid references customers(id) on delete set null,
  created_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(service_order_id, version)
);

alter table service_orders
  drop constraint if exists service_orders_approved_quote_revision_id_fkey;

alter table service_orders
  add constraint service_orders_approved_quote_revision_id_fkey
  foreign key (approved_quote_revision_id) references quote_revisions(id) on delete set null;

create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete restrict,
  service_order_id uuid not null references service_orders(id) on delete restrict,
  method payment_method not null,
  amount numeric(12,2) not null check (amount > 0),
  status text not null default 'confirmed' check (status in ('pending', 'confirmed', 'cancelled')),
  reference text,
  idempotency_key text not null unique,
  paid_at timestamptz not null default now(),
  created_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  cancelled_at timestamptz
);

create index if not exists payments_company_order_idx on payments(company_id, service_order_id);

create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete restrict,
  service_order_id uuid not null references service_orders(id) on delete restrict,
  type document_type not null,
  status document_status not null default 'generated',
  version integer not null check (version >= 1),
  public_token text not null unique,
  storage_path text,
  total numeric(12,2) not null default 0,
  idempotency_key text not null unique,
  created_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  unique(service_order_id, type, version)
);

create table if not exists maintenance_reminders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete restrict,
  customer_id uuid not null references customers(id) on delete cascade,
  vehicle_id uuid not null references vehicles(id) on delete cascade,
  service_order_id uuid references service_orders(id) on delete set null,
  title text not null,
  due_date timestamptz,
  due_mileage integer,
  status text not null default 'open' check (status in ('open', 'done', 'cancelled')),
  notes text,
  created_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists fiscal_integrations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  provider text,
  status fiscal_provider_status not null default 'not_configured',
  municipality_code text,
  company_tax_id text,
  encrypted_config jsonb not null default '{}'::jsonb,
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, provider)
);

create table if not exists audit_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete set null,
  entity_type text not null,
  entity_id uuid,
  action text not null,
  actor_user_id uuid references app_users(id) on delete set null,
  before_data jsonb,
  after_data jsonb,
  summary text not null,
  occurred_at timestamptz not null default now()
);

create index if not exists audit_events_company_time_idx on audit_events(company_id, occurred_at desc);

create table if not exists operation_idempotency_keys (
  key text primary key,
  company_id uuid references companies(id) on delete cascade,
  entity_type text not null,
  entity_id uuid,
  created_at timestamptz not null default now()
);

create table if not exists workshop_app_snapshots (
  company_id uuid primary key references companies(id) on delete cascade,
  state jsonb not null,
  updated_by uuid references app_users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function set_service_order_number()
returns trigger
language plpgsql
as $$
begin
  if new.number is null or new.number = '' then
    new.number = 'OS-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('service_order_number_seq')::text, 4, '0');
  end if;
  return new;
end;
$$;

create or replace function recalculate_order_payment_status(p_order_id uuid)
returns void
language plpgsql
as $$
declare
  v_total numeric(12,2);
  v_paid numeric(12,2);
begin
  select coalesce(sum((quantity * (unit_price + labor_price)) - discount), 0)
    into v_total
  from service_order_items
  where service_order_id = p_order_id;

  select coalesce(sum(amount), 0)
    into v_paid
  from payments
  where service_order_id = p_order_id
    and status = 'confirmed';

  update service_orders
  set payment_status = case
      when v_total <= 0 then 'unpaid'::payment_status
      when v_paid <= 0 then 'unpaid'::payment_status
      when v_paid < v_total then 'partial'::payment_status
      else 'paid'::payment_status
    end,
    updated_at = now(),
    version = version + 1
  where id = p_order_id;
end;
$$;

create or replace function recalculate_order_payment_status_trigger()
returns trigger
language plpgsql
as $$
begin
  perform recalculate_order_payment_status(coalesce(new.service_order_id, old.service_order_id));
  return coalesce(new, old);
end;
$$;

create or replace function audit_row_change()
returns trigger
language plpgsql
as $$
declare
  v_company_id uuid;
  v_entity_id uuid;
  v_actor uuid;
begin
  v_company_id = coalesce((to_jsonb(new)->>'company_id')::uuid, (to_jsonb(old)->>'company_id')::uuid);
  v_entity_id = coalesce((to_jsonb(new)->>'id')::uuid, (to_jsonb(old)->>'id')::uuid);
  v_actor = nullif(current_setting('app.current_user_id', true), '')::uuid;

  insert into audit_events(company_id, entity_type, entity_id, action, actor_user_id, before_data, after_data, summary)
  values (
    v_company_id,
    tg_table_name,
    v_entity_id,
    lower(tg_op),
    v_actor,
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end,
    tg_table_name || ' ' || lower(tg_op)
  );

  return coalesce(new, old);
end;
$$;

create or replace function app_verify_login(p_username text, p_password text, p_user_agent text default null, p_ip inet default null)
returns table (
  user_id uuid,
  company_id uuid,
  employee_id uuid,
  username text,
  display_name text,
  role app_role,
  session_token text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user app_users%rowtype;
  v_employee employees%rowtype;
  v_token text;
  v_expires timestamptz;
begin
  select *
    into v_user
  from app_users
  where app_users.username = lower(trim(p_username))::citext
    and active = true;

  if not found or v_user.password_hash <> crypt(p_password, v_user.password_hash) then
    raise exception 'invalid_credentials' using errcode = '28000';
  end if;

  select *
    into v_employee
  from employees
  where id = v_user.employee_id;

  v_token = encode(gen_random_bytes(32), 'hex');
  v_expires = now() + interval '12 hours';

  insert into app_sessions(app_user_id, token_hash, user_agent, ip, expires_at)
  values (v_user.id, encode(digest(v_token, 'sha256'), 'hex'), p_user_agent, p_ip, v_expires);

  update app_users set last_login_at = now(), updated_at = now() where id = v_user.id;

  return query
  select
    v_user.id,
    v_user.company_id,
    v_user.employee_id,
    v_user.username::text,
    coalesce(v_employee.name, v_user.username::text),
    v_user.role,
    v_token,
    v_expires;
end;
$$;

create trigger companies_updated_at before update on companies for each row execute function set_updated_at();
create trigger employees_updated_at before update on employees for each row execute function set_updated_at();
create trigger app_users_updated_at before update on app_users for each row execute function set_updated_at();
create trigger customers_updated_at before update on customers for each row execute function set_updated_at();
create trigger vehicles_updated_at before update on vehicles for each row execute function set_updated_at();
create trigger catalog_services_updated_at before update on catalog_services for each row execute function set_updated_at();
create trigger catalog_products_updated_at before update on catalog_products for each row execute function set_updated_at();
create trigger service_orders_updated_at before update on service_orders for each row execute function set_updated_at();
create trigger service_order_items_updated_at before update on service_order_items for each row execute function set_updated_at();
create trigger service_order_inspections_updated_at before update on service_order_inspections for each row execute function set_updated_at();
create trigger fiscal_integrations_updated_at before update on fiscal_integrations for each row execute function set_updated_at();
create trigger service_orders_number before insert on service_orders for each row execute function set_service_order_number();
create trigger service_order_items_payment_status after insert or update or delete on service_order_items for each row execute function recalculate_order_payment_status_trigger();
create trigger payments_payment_status after insert or update or delete on payments for each row execute function recalculate_order_payment_status_trigger();

create trigger audit_customers after insert or update on customers for each row execute function audit_row_change();
create trigger audit_vehicles after insert or update on vehicles for each row execute function audit_row_change();
create trigger audit_service_orders after insert or update on service_orders for each row execute function audit_row_change();
create trigger audit_service_order_items after insert or update or delete on service_order_items for each row execute function audit_row_change();
create trigger audit_quote_revisions after insert or update on quote_revisions for each row execute function audit_row_change();
create trigger audit_payments after insert or update on payments for each row execute function audit_row_change();
create trigger audit_documents after insert or update on documents for each row execute function audit_row_change();

alter table companies enable row level security;
alter table employees enable row level security;
alter table app_users enable row level security;
alter table app_sessions enable row level security;
alter table customers enable row level security;
alter table vehicles enable row level security;
alter table vehicle_mileage_history enable row level security;
alter table catalog_services enable row level security;
alter table catalog_products enable row level security;
alter table service_orders enable row level security;
alter table service_order_items enable row level security;
alter table inspection_templates enable row level security;
alter table service_order_inspections enable row level security;
alter table vehicle_photos enable row level security;
alter table quote_revisions enable row level security;
alter table payments enable row level security;
alter table documents enable row level security;
alter table maintenance_reminders enable row level security;
alter table fiscal_integrations enable row level security;
alter table audit_events enable row level security;
alter table operation_idempotency_keys enable row level security;
alter table workshop_app_snapshots enable row level security;

do $$
declare
  r record;
begin
  for r in
    select tablename
    from pg_tables
    where schemaname = 'public'
      and tablename in (
        'companies','employees','app_users','app_sessions','customers','vehicles','vehicle_mileage_history',
        'catalog_services','catalog_products','service_orders','service_order_items','inspection_templates',
        'service_order_inspections','vehicle_photos','quote_revisions','payments','documents',
        'maintenance_reminders','fiscal_integrations','audit_events','operation_idempotency_keys','workshop_app_snapshots'
      )
  loop
    execute format('drop policy if exists service_role_all on %I', r.tablename);
    execute format('create policy service_role_all on %I for all using (auth.role() = ''service_role'') with check (auth.role() = ''service_role'')', r.tablename);
  end loop;
end $$;

insert into companies(id, legal_name, trade_name, phone, whatsapp, address, city, state)
values (
  '00000000-0000-4000-8000-000000000001',
  'Auto Mecânica Total Flex',
  'Total Flex',
  '11948499650',
  '11948499650',
  'Estrada Cata Preta, 898 - Vila João Ramalho',
  'Santo André',
  'SP'
)
on conflict (id) do update
set legal_name = excluded.legal_name,
    trade_name = excluded.trade_name,
    phone = excluded.phone,
    whatsapp = excluded.whatsapp,
    address = excluded.address,
    city = excluded.city,
    state = excluded.state;

insert into employees(id, company_id, name, role, phone, active)
values
  ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000001', 'Total Flex', 'admin', '11948499650', true)
on conflict (id) do update
set name = excluded.name,
    role = excluded.role,
    phone = excluded.phone,
    active = excluded.active;

insert into app_users(id, company_id, employee_id, username, password_hash, role, active)
values (
  '00000000-0000-4000-8000-000000000021',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000011',
  'totalflex',
  crypt('1234', gen_salt('bf')),
  'admin',
  true
)
on conflict (username) do update
set password_hash = excluded.password_hash,
    role = excluded.role,
    active = excluded.active,
    employee_id = excluded.employee_id;

insert into fiscal_integrations(company_id, status)
values ('00000000-0000-4000-8000-000000000001', 'not_configured')
on conflict do nothing;
