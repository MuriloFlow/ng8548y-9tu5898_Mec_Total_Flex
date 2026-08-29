-- ============================================================
-- TOTAL FLEX — SQL FINAL (Execute NO COMPLETO no SQL Editor)
-- ============================================================

-- 1. Criar função exec_sql PRIMEIRO (necessária para auto-setup)
CREATE OR REPLACE FUNCTION exec_sql(sql TEXT)
RETURNS void AS $$
BEGIN
  EXECUTE sql;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Criar tabela de snapshots
CREATE TABLE IF NOT EXISTS workshop_app_snapshots (
  id         TEXT PRIMARY KEY DEFAULT 'singleton',
  company_id TEXT NOT NULL DEFAULT 'default',
  state      JSONB NOT NULL DEFAULT '{}',
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Inserir linha singleton
INSERT INTO workshop_app_snapshots (id, company_id, state, updated_at)
VALUES ('singleton', 'default', '{}', now())
ON CONFLICT (id) DO NOTHING;

-- 4. Habilitar RLS
ALTER TABLE workshop_app_snapshots ENABLE ROW LEVEL SECURITY;

-- 5. Criar política permissiva (service_role bypassa RLS)
DROP POLICY IF EXISTS "tf_full_access" ON workshop_app_snapshots;
CREATE POLICY "tf_full_access" ON workshop_app_snapshots
  FOR ALL USING (true) WITH CHECK (true);

-- 6. Verificar
SELECT 'Setup completo! exec_sql existe:' AS msg;
SELECT proname FROM pg_proc WHERE proname = 'exec_sql';
SELECT count(*) AS total_snapshots FROM workshop_app_snapshots;
