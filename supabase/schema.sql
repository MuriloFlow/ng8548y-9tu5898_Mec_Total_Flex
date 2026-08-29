-- ============================================================
-- Total Flex — Supabase SQL Schema
-- Execute este script no SQL Editor do Supabase Dashboard.
-- ============================================================

-- Habilita extensão para UUIDs (caso ainda não esteja habilitada)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─────────────────────────────────────────────────────────────
-- 1. empresa
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS company (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  trade_name TEXT NOT NULL,
  phone      TEXT NOT NULL DEFAULT '',
  whatsapp   TEXT NOT NULL DEFAULT '',
  address    TEXT NOT NULL DEFAULT '',
  city       TEXT NOT NULL DEFAULT '',
  state      TEXT NOT NULL DEFAULT '',
  tax_id     TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────
-- 2. usuarios (login)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app_users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  display_name  TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin','attendant','mechanic')),
  active        BOOLEAN NOT NULL DEFAULT true,
  employee_id   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────
-- 3. funcionarios
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS employees (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  role       TEXT NOT NULL CHECK (role IN ('admin','attendant','mechanic')),
  phone      TEXT,
  email      TEXT,
  active     BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE app_users
  ADD CONSTRAINT fk_app_users_employee
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE SET NULL;

-- ─────────────────────────────────────────────────────────────
-- 4. clientes
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS customers (
  id         TEXT PRIMARY KEY,
  cpf        TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  phone      TEXT NOT NULL,
  email      TEXT,
  no_email   BOOLEAN NOT NULL DEFAULT false,
  address    TEXT,
  district   TEXT,
  notes      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_customers_cpf ON customers(cpf);

-- ─────────────────────────────────────────────────────────────
-- 5. veiculos
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vehicles (
  id             TEXT PRIMARY KEY,
  customer_id    TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  plate          TEXT NOT NULL,
  brand          TEXT NOT NULL,
  model          TEXT NOT NULL,
  version        TEXT,
  year           INTEGER,
  color          TEXT,
  category       TEXT NOT NULL DEFAULT 'car' CHECK (category IN ('car','motorcycle','truck','van','other')),
  lookup_status  TEXT NOT NULL DEFAULT 'manual',
  lookup_provider TEXT,
  image_url      TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_vehicles_plate ON vehicles(plate);
CREATE INDEX IF NOT EXISTS idx_vehicles_customer ON vehicles(customer_id);

-- ─────────────────────────────────────────────────────────────
-- 6. registros de quilometragem
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mileage_records (
  id          TEXT PRIMARY KEY,
  vehicle_id  TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  order_id    TEXT,
  mileage     INTEGER NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────
-- 7. catalogo de servicos
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS catalog_services (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  description        TEXT,
  internal_code      TEXT,
  default_price      NUMERIC(12,2) NOT NULL DEFAULT 0,
  default_labor      NUMERIC(12,2) NOT NULL DEFAULT 0,
  cost               NUMERIC(12,2) NOT NULL DEFAULT 0,
  estimated_minutes  INTEGER NOT NULL DEFAULT 60,
  category           TEXT NOT NULL DEFAULT '',
  status             TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────
-- 8. catalogo de pecas/produtos
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS catalog_products (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  description     TEXT,
  sku             TEXT NOT NULL,
  default_price   NUMERIC(12,2) NOT NULL DEFAULT 0,
  cost            NUMERIC(12,2) NOT NULL DEFAULT 0,
  stock_quantity  INTEGER NOT NULL DEFAULT 0,
  category        TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────
-- 9. ordens de servico
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS service_orders (
  id                          TEXT PRIMARY KEY,
  number                      TEXT NOT NULL,
  customer_id                 TEXT NOT NULL REFERENCES customers(id),
  vehicle_id                  TEXT NOT NULL REFERENCES vehicles(id),
  status                      TEXT NOT NULL DEFAULT 'draft'
                                CHECK (status IN (
                                  'draft','waiting_approval','approved',
                                  'in_service','waiting_parts',
                                  'finished','delivered','cancelled'
                                )),
  payment_status              TEXT NOT NULL DEFAULT 'unpaid'
                                CHECK (payment_status IN (
                                  'unpaid','partial','paid','refunded','cancelled'
                                )),
  current_mileage             INTEGER NOT NULL DEFAULT 0,
  fuel_level                  INTEGER NOT NULL DEFAULT 0,
  entry_state                 TEXT NOT NULL DEFAULT '',
  priority                    TEXT NOT NULL DEFAULT 'normal'
                                CHECK (priority IN ('low','normal','high','urgent')),
  advisor_id                  TEXT NOT NULL,
  mechanic_id                 TEXT,
  estimated_delivery_at       TIMESTAMPTZ,
  started_at                  TIMESTAMPTZ,
  finished_at                 TIMESTAMPTZ,
  delivered_at                TIMESTAMPTZ,
  diagnosis                   TEXT,
  mechanic_recommendations    TEXT,
  customer_notes              TEXT,
  internal_notes              TEXT,
  customer_signature_data_url TEXT,
  mechanic_signature_data_url TEXT,
  approved_quote_revision_id  TEXT,
  idempotency_key             TEXT UNIQUE,
  version                     INTEGER NOT NULL DEFAULT 1,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at                  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_orders_customer ON service_orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_vehicle  ON service_orders(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_orders_status   ON service_orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_number   ON service_orders(number);

-- ─────────────────────────────────────────────────────────────
-- 10. itens da ordem de servico
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS order_items (
  id          TEXT PRIMARY KEY,
  order_id    TEXT NOT NULL REFERENCES service_orders(id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK (type IN ('service','part','custom')),
  catalog_id  TEXT,
  description TEXT NOT NULL,
  quantity    NUMERIC(10,3) NOT NULL DEFAULT 1,
  unit_price  NUMERIC(12,2) NOT NULL DEFAULT 0,
  labor_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount    NUMERIC(12,2) NOT NULL DEFAULT 0,
  cost        NUMERIC(12,2) NOT NULL DEFAULT 0,
  notes       TEXT,
  done_at     TIMESTAMPTZ,
  done_by     TEXT,
  sort_order  INTEGER,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);

-- ─────────────────────────────────────────────────────────────
-- 11. itens de inspecao/checklist
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inspection_items (
  id         TEXT PRIMARY KEY,
  order_id   TEXT NOT NULL REFERENCES service_orders(id) ON DELETE CASCADE,
  label      TEXT NOT NULL,
  category   TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'not_applicable'
               CHECK (status IN ('ok','attention','damaged','not_applicable')),
  notes      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inspection_order ON inspection_items(order_id);

-- ─────────────────────────────────────────────────────────────
-- 12. fotos/anexos
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS photos (
  id         TEXT PRIMARY KEY,
  order_id   TEXT NOT NULL REFERENCES service_orders(id) ON DELETE CASCADE,
  label      TEXT NOT NULL,
  data_url   TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_photos_order ON photos(order_id);

-- ─────────────────────────────────────────────────────────────
-- 13. revisoes de orcamento
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS quote_revisions (
  id                TEXT PRIMARY KEY,
  order_id          TEXT NOT NULL REFERENCES service_orders(id) ON DELETE CASCADE,
  version           INTEGER NOT NULL,
  status            TEXT NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft','sent','approved','rejected','expired')),
  subtotal_parts    NUMERIC(12,2) NOT NULL DEFAULT 0,
  subtotal_labor    NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount          NUMERIC(12,2) NOT NULL DEFAULT 0,
  total             NUMERIC(12,2) NOT NULL DEFAULT 0,
  items_snapshot    JSONB NOT NULL DEFAULT '[]',
  sent_at           TIMESTAMPTZ,
  approved_at       TIMESTAMPTZ,
  approved_by       TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_quotes_order ON quote_revisions(order_id);

-- ─────────────────────────────────────────────────────────────
-- 14. pagamentos
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payments (
  id               TEXT PRIMARY KEY,
  order_id         TEXT NOT NULL REFERENCES service_orders(id) ON DELETE CASCADE,
  method           TEXT NOT NULL CHECK (method IN ('pix','cash','debit','credit','transfer','other')),
  amount           NUMERIC(12,2) NOT NULL,
  status           TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('pending','confirmed','cancelled')),
  reference        TEXT,
  paid_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by       TEXT NOT NULL,
  idempotency_key  TEXT UNIQUE NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(order_id);

-- ─────────────────────────────────────────────────────────────
-- 15. documentos gerados
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS documents (
  id               TEXT PRIMARY KEY,
  order_id         TEXT NOT NULL REFERENCES service_orders(id) ON DELETE CASCADE,
  type             TEXT NOT NULL CHECK (type IN ('service_order','quote','receipt','fiscal_receipt')),
  status           TEXT NOT NULL DEFAULT 'generated' CHECK (status IN ('draft','generated','cancelled')),
  version          INTEGER NOT NULL,
  public_token     TEXT NOT NULL UNIQUE,
  total            NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by       TEXT NOT NULL,
  idempotency_key  TEXT UNIQUE NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_documents_order ON documents(order_id);

-- ─────────────────────────────────────────────────────────────
-- 16. lembretes
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reminders (
  id          TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  vehicle_id  TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  order_id    TEXT,
  title       TEXT NOT NULL,
  due_date    DATE,
  due_mileage INTEGER,
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','cancelled')),
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reminders_customer ON reminders(customer_id);
CREATE INDEX IF NOT EXISTS idx_reminders_due      ON reminders(due_date);

-- ─────────────────────────────────────────────────────────────
-- 17. eventos de auditoria
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_events (
  id           TEXT PRIMARY KEY,
  entity_type  TEXT NOT NULL,
  entity_id    TEXT NOT NULL,
  action       TEXT NOT NULL,
  user_id      TEXT NOT NULL,
  before_data  JSONB,
  after_data   JSONB,
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  summary      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_events(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_time   ON audit_events(occurred_at DESC);

-- ─────────────────────────────────────────────────────────────
-- 18. chaves de operacao processada (idempotencia)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS processed_operation_keys (
  key TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────
-- 19. snapshots do estado da aplicacao (sync remoto)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workshop_app_snapshots (
  id         TEXT PRIMARY KEY DEFAULT 'singleton',
  company_id TEXT NOT NULL DEFAULT 'default',
  state      JSONB NOT NULL DEFAULT '{}',
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO workshop_app_snapshots (id, company_id, state, updated_at)
VALUES ('singleton', 'default', '{}', now())
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- RLS (Row Level Security) — opcional, ativar conforme necessidade
-- ─────────────────────────────────────────────────────────────
-- Para habilitar RLS em todas as tabelas, descomente o bloco abaixo:
--
-- ALTER TABLE company              ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE app_users            ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE employees            ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE customers            ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE vehicles             ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE mileage_records      ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE catalog_services     ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE catalog_products     ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE service_orders       ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE order_items          ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE inspection_items     ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE photos               ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE quote_revisions      ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE payments             ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE documents            ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE reminders            ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE audit_events         ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE processed_operation_keys ENABLE ROW LEVEL SECURITY;
--
-- Exemplo de policy para service_orders (acesso autenticado):
-- CREATE POLICY "Authenticated full access" ON service_orders
--   FOR ALL USING (auth.role() = 'authenticated');
