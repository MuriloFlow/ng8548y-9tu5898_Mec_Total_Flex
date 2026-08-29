-- ============================================================
-- TOTAL FLEX — SQL COMPLETO PARA SUPABASE
-- Execute este SQL no SQL Editor do Supabase de UMA VEZ
-- ============================================================

-- 1. Função exec_sql (para criar tabelas via API se necessário)
CREATE OR REPLACE FUNCTION public.exec_sql(sql TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  EXECUTE sql;
END;
$$;

-- Garantir que service_role pode executar
GRANT EXECUTE ON FUNCTION public.exec_sql(TEXT) TO service_role;
REVOKE EXECUTE ON FUNCTION public.exec_sql(TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.exec_sql(TEXT) FROM authenticated;

-- 2. ============================================================
-- TABELA: workshop_app_snapshots (snapshots do estado)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.workshop_app_snapshots (
  id          TEXT PRIMARY KEY DEFAULT 'singleton',
  company_id  TEXT NOT NULL DEFAULT 'default',
  state       JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by  TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Garantir que a row existe
INSERT INTO public.workshop_app_snapshots (id, company_id, state, updated_at)
VALUES ('singleton', 'default', '{}'::jsonb, now())
ON CONFLICT (id) DO NOTHING;

-- RLS para workshop_app_snapshots
ALTER TABLE public.workshop_app_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tf_full_access" ON public.workshop_app_snapshots;
CREATE POLICY "tf_full_access" ON public.workshop_app_snapshots
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- 3. ============================================================
-- RLS PARA TODAS AS TABELAS (service_role bypassa, mas anon precisa)
-- ============================================================

-- app_users
ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tf_anon_all" ON public.app_users;
CREATE POLICY "tf_anon_all" ON public.app_users FOR ALL USING (true) WITH CHECK (true);

-- audit_events
ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tf_anon_all" ON public.audit_events;
CREATE POLICY "tf_anon_all" ON public.audit_events FOR ALL USING (true) WITH CHECK (true);

-- catalog_products
ALTER TABLE public.catalog_products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tf_anon_all" ON public.catalog_products;
CREATE POLICY "tf_anon_all" ON public.catalog_products FOR ALL USING (true) WITH CHECK (true);

-- catalog_services
ALTER TABLE public.catalog_services ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tf_anon_all" ON public.catalog_services;
CREATE POLICY "tf_anon_all" ON public.catalog_services FOR ALL USING (true) WITH CHECK (true);

-- company
ALTER TABLE public.company ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tf_anon_all" ON public.company;
CREATE POLICY "tf_anon_all" ON public.company FOR ALL USING (true) WITH CHECK (true);

-- customers
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tf_anon_all" ON public.customers;
CREATE POLICY "tf_anon_all" ON public.customers FOR ALL USING (true) WITH CHECK (true);

-- documents
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tf_anon_all" ON public.documents;
CREATE POLICY "tf_anon_all" ON public.documents FOR ALL USING (true) WITH CHECK (true);

-- employees
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tf_anon_all" ON public.employees;
CREATE POLICY "tf_anon_all" ON public.employees FOR ALL USING (true) WITH CHECK (true);

-- inspection_items
ALTER TABLE public.inspection_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tf_anon_all" ON public.inspection_items;
CREATE POLICY "tf_anon_all" ON public.inspection_items FOR ALL USING (true) WITH CHECK (true);

-- mileage_records
ALTER TABLE public.mileage_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tf_anon_all" ON public.mileage_records;
CREATE POLICY "tf_anon_all" ON public.mileage_records FOR ALL USING (true) WITH CHECK (true);

-- order_items
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tf_anon_all" ON public.order_items;
CREATE POLICY "tf_anon_all" ON public.order_items FOR ALL USING (true) WITH CHECK (true);

-- payments
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tf_anon_all" ON public.payments;
CREATE POLICY "tf_anon_all" ON public.payments FOR ALL USING (true) WITH CHECK (true);

-- photos
ALTER TABLE public.photos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tf_anon_all" ON public.photos;
CREATE POLICY "tf_anon_all" ON public.photos FOR ALL USING (true) WITH CHECK (true);

-- processed_operation_keys
ALTER TABLE public.processed_operation_keys ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tf_anon_all" ON public.processed_operation_keys;
CREATE POLICY "tf_anon_all" ON public.processed_operation_keys FOR ALL USING (true) WITH CHECK (true);

-- quote_revisions
ALTER TABLE public.quote_revisions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tf_anon_all" ON public.quote_revisions;
CREATE POLICY "tf_anon_all" ON public.quote_revisions FOR ALL USING (true) WITH CHECK (true);

-- reminders
ALTER TABLE public.reminders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tf_anon_all" ON public.reminders;
CREATE POLICY "tf_anon_all" ON public.reminders FOR ALL USING (true) WITH CHECK (true);

-- service_orders
ALTER TABLE public.service_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tf_anon_all" ON public.service_orders;
CREATE POLICY "tf_anon_all" ON public.service_orders FOR ALL USING (true) WITH CHECK (true);

-- vehicles
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tf_anon_all" ON public.vehicles;
CREATE POLICY "tf_anon_all" ON public.vehicles FOR ALL USING (true) WITH CHECK (true);

-- 4. ============================================================
-- AUMENTAR LIMITE DO PAYLOAD (padrão do Supabase é 1MB)
-- Executar via SQL para permitir payloads maiores
-- ============================================================
-- Nota: isso pode precisar ser feito no dashboard em Settings > API
-- O limite padrão é 1MB, mas o snapshot pode ser maior com fotos

-- 5. ============================================================
-- VERIFICAR: rodar para confirmar que tudo funciona
-- ============================================================
SELECT 'exec_sql existe' AS check1, proname FROM pg_proc WHERE proname = 'exec_sql';
SELECT 'workshop_app_snapshots existe' AS check2, count(*) AS rows FROM public.workshop_app_snapshots;
SELECT 'RLS policies criadas' AS check3, count(*) AS total_policies FROM pg_policies WHERE schemaname = 'public';
