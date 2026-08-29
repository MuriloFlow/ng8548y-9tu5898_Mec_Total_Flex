-- ============================================================
-- TOTAL FLEX — SQL FINAL
-- Execute este script NO COMPLETO no SQL Editor do Supabase.
-- Ele cria a tabela necessária para salvar os dados remotamente.
-- ============================================================

-- 1. Criar tabela de snapshots
CREATE TABLE IF NOT EXISTS workshop_app_snapshots (
  id         TEXT PRIMARY KEY DEFAULT 'singleton',
  company_id TEXT NOT NULL DEFAULT 'default',
  state      JSONB NOT NULL DEFAULT '{}',
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Inserir linha singleton
INSERT INTO workshop_app_snapshots (id, company_id, state, updated_at)
VALUES ('singleton', 'default', '{}', now())
ON CONFLICT (id) DO NOTHING;

-- 3. Habilitar Row Level Security
ALTER TABLE workshop_app_snapshots ENABLE ROW LEVEL SECURITY;

-- 4. Criar política permissiva (service_role bypassa RLS)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE policyname = 'tf_full_access'
    AND tablename = 'workshop_app_snapshots'
  ) THEN
    CREATE POLICY "tf_full_access" ON workshop_app_snapshots
      FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 5. Criar função RPC para executar SQL (usada pelo auto-setup)
CREATE OR REPLACE FUNCTION exec_sql(sql TEXT)
RETURNS void AS $$
BEGIN
  EXECUTE sql;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. Verificar se tudo funcionou
SELECT 'Tabela criada com sucesso!' AS resultado;
SELECT * FROM workshop_app_snapshots;
