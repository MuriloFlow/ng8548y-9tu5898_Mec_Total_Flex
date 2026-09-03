# Integração FlowDesk (licenciamento financeiro)

Este projeto consulta o **FlowDesk** para saber se o acesso está liberado. Se a cobrança
obrigatória vencer e passar da carência, o FlowDesk marca o projeto como `BLOCKED_PAYMENT`
e o sistema exibe a tela **“Aplicação bloqueada por falta de pagamento”** com o botão
**Realizar pagamento**. Quando o Mercado Pago confirma o pagamento, o webhook libera o
projeto e a tela some sozinha — sem intervenção manual.

## 1. Variáveis de ambiente

Adicione ao `.env.local` (e às variáveis do projeto na Vercel):

```bash
# Chave secreta do projeto, gerada no FlowDesk em Credenciais → Nova chave
FLOWDESK_SECRET_KEY=fd_live_sk_xxxxxxxxxxxxxxxxxxxxxxxx

# URL do painel (produção). Em desenvolvimento use http://localhost:3000
FLOWDESK_API_URL=https://flowdeskbrasil.vercel.app

# enforce (padrão) | monitor (só loga, nunca bloqueia) | off (desliga)
FLOWDESK_MODE=enforce

# Opcionais
FLOWDESK_CACHE_SECONDS=60
FLOWDESK_TIMEOUT_MS=4000
```

> **Nunca** use prefixo `NEXT_PUBLIC_` nessas variáveis. A chave secreta só existe no servidor.

## 2. Arquivos da integração

| Arquivo | Papel |
| --- | --- |
| `src/lib/flowdesk/types.ts` | Contrato do endpoint `/api/v1/entitlement` |
| `src/lib/flowdesk/client.ts` | Consulta o FlowDesk (server-only, com cache e timeout) |
| `src/components/flowdesk/access-gate.tsx` | Server Component que decide liberar ou bloquear |
| `src/components/flowdesk/blocked-screen.tsx` | Tela de bloqueio + verificação automática |
| `src/app/api/flowdesk/status/route.ts` | Proxy de polling (mantém a secret no servidor) |

O gate está ligado no `src/app/layout.tsx`, então cobre **todas** as rotas de página.

## 3. Comportamento de falha (fail-open)

Se o FlowDesk estiver fora do ar, com timeout ou sem chave configurada, o acesso é
**liberado** e o erro vai para o log do servidor. Uma indisponibilidade do painel nunca
derruba o sistema do cliente.

## 4. Como testar o bloqueio

1. No painel FlowDesk, abra o projeto → **Acesso** → **Bloquear manualmente**.
2. Recarregue este sistema (ou espere o cache de 60s expirar).
3. A tela de bloqueio aparece com a cobrança e o botão de pagamento.
4. Pague no checkout (Pix em sandbox aprova na hora) ou clique em **Desbloquear** no painel.
5. A tela detecta a liberação em até 15 segundos e recarrega automaticamente.

Para ver a tela sem bloquear de verdade, deixe `FLOWDESK_MODE=monitor` — o bloqueio só é
registrado no log.

## 5. Endpoints do FlowDesk disponíveis para este projeto

Autentique com `Authorization: Bearer $FLOWDESK_SECRET_KEY`.

| Método | Rota | Uso |
| --- | --- | --- |
| GET | `/api/v1/entitlement` | Status de acesso + cobrança bloqueante |
| GET | `/api/v1/project` | Dados do projeto e do cliente |
| GET | `/api/v1/charges` | Lista de cobranças |
| POST | `/api/v1/charges` | Cria cobrança (aceita `Idempotency-Key`) |
| POST | `/api/v1/payment-links` | Gera um link de pagamento |
| GET | `/api/v1/payments` | Histórico de pagamentos |
| GET | `/api/v1/events` | Fila de eventos (alternativa ao webhook) |
| GET | `/api/v1/ping` | Teste de credencial |
