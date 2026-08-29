-- ============================================================
-- Migration: workshop_app_snapshots
-- Tabela para persistir o estado completo da aplicação como JSON.
-- RLS desabilitado para acesso direto via service_role key.
-- ============================================================

CREATE TABLE IF NOT EXISTS workshop_app_snapshots (
  id         TEXT PRIMARY KEY DEFAULT 'singleton',
  company_id TEXT NOT NULL DEFAULT 'default',
  state      JSONB NOT NULL DEFAULT '{}',
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Insert the singleton row
INSERT INTO workshop_app_snapshots (id, company_id, state, updated_at)
VALUES ('singleton', 'default', '{}', now())
ON CONFLICT (id) DO NOTHING;

-- RLS: permissive — service_role bypasses RLS anyway
ALTER TABLE workshop_app_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for authenticated" ON workshop_app_snapshots
  FOR ALL
  USING (true)
  WITH CHECK (true);
