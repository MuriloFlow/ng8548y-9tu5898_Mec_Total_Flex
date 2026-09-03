# Integração FlowDesk — Mecânica Total Flex

Este guia conecta o **Total Flex OS** ao **FlowDesk** para bloquear o sistema automaticamente
quando a mensalidade/cobrança obrigatória vencer, exibir a tela de pagamento e liberar o
acesso assim que o Mercado Pago confirmar.

---

## Visão geral

```
Total Flex OS  ──GET /api/v1/entitlement──▶  FlowDesk
       │                                         │
       │  blocked = true                        │ cobrança vencida + carência
       ▼                                         ▼
 Tela de bloqueio ◀── payment_url ──── Link de pagamento / Pix
       │
       │  pagamento confirmado (webhook MP)
       ▼
  Acesso liberado automaticamente
```

---

## Parte 1 — Configurar no painel FlowDesk

### Passo 1: Acesse o FlowDesk

- **Produção:** https://flowdeskbrasil.vercel.app
- **Local (dev):** http://localhost:3000

Faça login com sua conta de administrador.

---

### Passo 2: Criar o cliente

1. Menu **Clientes** → **Novo cliente**
2. Preencha:
   - **Nome:** `Mecânica Total Flex` (ou razão social)
   - **E-mail:** e-mail do responsável financeiro
   - **Documento:** CNPJ ou CPF
3. Salve

> Este cliente representa quem paga a licença do sistema.

---

### Passo 3: Criar o projeto (aplicação integrada)

1. Menu **Projetos** → **Novo projeto**
2. Preencha:
   - **Nome:** `Total Flex OS`
   - **Cliente:** selecione *Mecânica Total Flex*
   - **Slug:** `total-flex-os` (opcional, para identificação)
3. Na aba **Acesso / Billing**, configure:
   - **Modo de bloqueio:** `Automático (AUTO)` — bloqueia sozinho ao vencer
   - **Dias de carência:** `3` (exemplo — dias após o vencimento antes de bloquear)
4. Salve o projeto

> Cada projeto = uma aplicação que consome a API. O Total Flex OS terá **uma chave secreta** ligada a este projeto.

---

### Passo 4: Configurar o Mercado Pago (para receber pagamentos)

1. Menu **Gateways**
2. No servidor/Vercel do FlowDesk, defina a variável:
   ```bash
   MERCADOPAGO_ACCESS_TOKEN=APP_USR-xxxxxxxx
   ```
3. Em produção, configure o webhook do Mercado Pago apontando para:
   ```
   https://flowdeskbrasil.vercel.app/api/webhooks/mercadopago
   ```

Sem isso, o checkout funciona, mas a confirmação automática depende do polling.

---

### Passo 5: Criar a cobrança obrigatória (mensalidade)

1. Abra o projeto **Total Flex OS**
2. Menu **Cobranças** → **Nova cobrança** (ou use **Assinaturas** para recorrente)
3. Configure:
   - **Cliente:** Mecânica Total Flex
   - **Projeto:** Total Flex OS
   - **Valor:** ex. `R$ 297,00`
   - **Vencimento:** data desejada
   - **Obrigatória:** ✅ **Sim** — só cobranças obrigatórias bloqueiam o app
   - **Descrição:** `Mensalidade Total Flex OS`
4. Salve — o FlowDesk gera automaticamente um **link de pagamento**

> Quando a cobrança vence e passa da carência, o projeto fica `BLOCKED_PAYMENT`.

---

### Passo 6: Gerar a chave de API (Secret Key)

1. Menu **Credenciais** → **Nova chave**
2. Selecione o projeto **Total Flex OS**
3. Marque os escopos mínimos:
   - `entitlement:read` — **obrigatório** para bloqueio
   - `charges:read` — recomendado
   - `payments:read` — opcional
4. Clique em **Gerar**
5. **Copie a chave imediatamente** — ela começa com `fd_live_sk_...` e **não aparece de novo**

> Esta chave identifica o projeto no Total Flex OS. Guarde como senha.

---

### Passo 7: Testar a chave no FlowDesk

No terminal (substitua a chave):

```bash
curl -s -H "Authorization: Bearer fd_live_sk_SUA_CHAVE" \
  https://flowdeskbrasil.vercel.app/api/v1/ping
```

Resposta esperada:
```json
{ "ok": true, "project": "Total Flex OS", ... }
```

Consultar entitlement:
```bash
curl -s -H "Authorization: Bearer fd_live_sk_SUA_CHAVE" \
  https://flowdeskbrasil.vercel.app/api/v1/entitlement
```

Campos importantes:
- `has_access: true` → app liberado
- `has_access: false` ou `blocked: true` → app bloqueado
- `charge.payment_url` → link que aparece no botão "Realizar pagamento"

Documentação completa: **FlowDesk → Documentação da API** (`/documentacao`)

---

## Parte 2 — Configurar o Total Flex OS

### Passo 8: Variáveis de ambiente

Na pasta `Mecanica Total Flex`, crie ou edite `.env.local`:

```bash
# Chave gerada no Passo 6
FLOWDESK_SECRET_KEY=fd_live_sk_xxxxxxxxxxxxxxxxxxxxxxxx

# URL do FlowDesk
# Produção:
FLOWDESK_API_URL=https://flowdeskbrasil.vercel.app
# Desenvolvimento local do FlowDesk:
# FLOWDESK_API_URL=http://localhost:3000

# enforce = bloqueia de verdade (padrão)
# monitor = só registra no log, nunca bloqueia (homologação)
# off     = desliga a verificação
FLOWDESK_MODE=enforce

# Opcionais
FLOWDESK_CACHE_SECONDS=60
FLOWDESK_TIMEOUT_MS=4000
```

> **Nunca** use prefixo `NEXT_PUBLIC_` — a chave secreta fica só no servidor.

Reinicie o Next.js após salvar:
```bash
npm run dev
```

---

### Passo 9: Testar a conexão

Com o Total Flex OS rodando:

```bash
curl -s http://localhost:3001/api/flowdesk/ping
```

*(ajuste a porta se diferente)*

Resposta esperada:
```json
{ "ok": true, "message": "Conexão com o FlowDesk OK", ... }
```

Se `ok: false` e mencionar `FLOWDESK_SECRET_KEY`, a variável não foi carregada.

---

## Parte 3 — Como funciona o bloqueio

| Camada | Arquivo | O que faz |
|--------|---------|-----------|
| Gate de páginas | `access-gate.tsx` | Checagem inicial no servidor |
| **Monitor em tempo real** | `live-monitor.tsx` + `use-flowdesk-live.ts` | Polling a cada **3s** — bloqueia/libera **sem F5** |
| Tela de bloqueio | `blocked-screen.tsx` | Cobrança + pagamento + liberação automática |
| Cliente API | `src/lib/flowdesk/client.ts` | `fetchEntitlement()` com cache e timeout |
| Proxy de status | `src/app/api/flowdesk/status/route.ts` | Polling sem expor a secret key |
| Middleware | `middleware.ts` | Bloqueia rotas `/api/*` quando inadimplente (exceto auth, health, flowdesk) |
| Layout | `src/app/layout.tsx` | Envolve todo o app com `FlowdeskAccessGate` |

### Fail-open (segurança operacional)

Se o FlowDesk estiver fora do ar, sem chave configurada ou com timeout, o **acesso é liberado**
para não derrubar a oficina. Erros vão para o log do servidor.

---

## Parte 4 — Testar o bloqueio e desbloqueio

### Simular bloqueio

**Opção A — Painel FlowDesk:**
1. Projeto **Total Flex OS** → aba **Acesso**
2. Clique em **Bloquear manualmente**

**Opção B — Cobrança vencida:**
1. Crie cobrança obrigatória com vencimento no passado
2. Aguarde o job diário ou force refresh do projeto

### Verificar bloqueio

1. Recarregue o Total Flex OS (ou aguarde ~60s de cache)
2. Deve aparecer: **"Aplicação bloqueada por falta de pagamento"**
3. Botão **Realizar pagamento** abre o checkout FlowDesk
4. APIs como `/api/workshop/sync` retornam HTTP 402

### Simular desbloqueio

**Opção A — Pagar de verdade:**
1. Clique em **Realizar pagamento** → pague via Pix
2. A tela detecta em ~5–15s e recarrega sozinha

**Opção B — Painel:**
1. FlowDesk → Projeto → **Desbloquear manualmente**

### Modo homologação (sem bloquear)

```bash
FLOWDESK_MODE=monitor
```

O bloqueio aparece no log, mas o app continua funcionando.

---

## Referência rápida de endpoints

Autenticação: `Authorization: Bearer $FLOWDESK_SECRET_KEY`

| Método | Rota | Uso |
|--------|------|-----|
| GET | `/api/v1/ping` | Testar credencial |
| GET | `/api/v1/entitlement` | Status de acesso + cobrança bloqueante |
| GET | `/api/v1/project` | Dados do projeto e cliente |
| GET | `/api/v1/charges` | Listar cobranças |
| POST | `/api/v1/charges` | Criar cobrança (header `Idempotency-Key`) |
| POST | `/api/v1/payment-links` | Gerar link avulso |
| GET | `/api/v1/payments` | Histórico de pagamentos |
| GET | `/api/v1/events` | Fila de eventos |

---

## Checklist final

- [ ] Cliente criado no FlowDesk
- [ ] Projeto **Total Flex OS** com bloqueio `AUTO` e carência definida
- [ ] Cobrança **obrigatória** emitida
- [ ] Mercado Pago configurado no FlowDesk
- [ ] Chave `fd_live_sk_...` gerada e copiada
- [ ] `.env.local` do Total Flex OS preenchido
- [ ] `GET /api/flowdesk/ping` retorna `ok: true`
- [ ] Bloqueio manual testado → tela aparece
- [ ] Pagamento testado → tela some sozinha

---

## Suporte

- Documentação API: FlowDesk → **Documentação da API**
- Logs de webhook: FlowDesk → **Webhooks**
- Pagamentos: FlowDesk → **Pagamentos**
