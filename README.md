# Luvia Agent
Assistente de vendas e suporte construído com Mastra + Express. Este README é um guia rápido para quem está começando.

## Requisitos
- Node.js >= 22.13 (veja `package.json`).
- npm para instalar dependências.
- Chaves de API em um `.env` (não versionado).

## Configuração rápida
1) Instale as dependências: `npm install`
2) Crie um `.env` com as variáveis abaixo.
3) Suba o ambiente local:
   - Somente Mastra: `npm run dev`
   - API de chat: `npm run dev:chat`
   - Tudo junto (recomendado): `npm run dev:all` (API + Mastra em paralelo)

Build/produção:
- `npm run build` para gerar o bundle.
- `npm start` para rodar o bundle já construído.

## Variáveis de ambiente
- `OPENAI_API_KEY` (obrigatória) — LLM e validações.
- `SUPABASE_URL` / `SUPABASE_KEY` — busca de produtos, regras e clientes.
- `COHERE_API_KEY` — fallback de similaridade (usada quando `NODE_ENV=production`).
- `QDRANT_URL` / `QDRANT_API_KEY` — vetores de produtos/estratégias.
- `ESCALATION_WEBHOOK_URL` — opcional, chamado em escalonamentos.
- `PORT` — porta do Express (padrão 3000).
- `DEBUG` ou `SUPABASE_DEBUG` — log extra para Supabase (opcional).

## Fluxo principal
- `src/server.ts` expõe `POST /api/chat`, encaminhando para o workflow `luviaWorkflow`.
- `src/mastra/workflows/luvia-workflow.ts` faz a orquestração:
  - Step 1: segurança/PII leve, saudação, detecção de produto/intent, carregamento de contexto e enriquecimento (Supabase + Qdrant).
  - Step 2: roteia para agentes (`sales`, `support`, `clarification`, `docs`, `dont_know`, `guardrail`, `deep`), mantendo estado da conversa via LibSQL em `.mastra/mastra.db`.
  - Step 3: guardrails (PII/políticas), valida promessas e, se necessário, escala para humano/webhook.
- Resposta típica: `{ response, workflow_status, agent_used, needs_human, ticket_id?, validation_issues? }`.

## Pastas úteis
- `src/mastra/agents` — definições dos agentes (vendas, suporte, clarificação, guardrail).
- `src/mastra/tools` — ferramentas usadas pelo workflow (busca avançada, contexto, PII, validações, etc.).
- `src/mastra/scorers` — avaliadores (ex.: `relevance-scorer.ts`).
- `src/mastra/utils` — utilitários (logs, clientes).
- `src/schemas` — esquemas de entrada/validação (ex.: `input.schema.ts`).
- `public/` — assets servidos pelo Express.

## Teste rápido da API
Com `npm run dev:all` ativo:
```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "team_id": "time-demo",
    "message": "Preciso de suporte para meu pedido",
    "phone": "5511999999999",
    "email": "user@example.com",
    "user_confirmation": false
  }'
```

## Para se orientar
- Leia `AGENTS.md` para padrões do repositório.
- Logs e estado local ficam em `.mastra/mastra.db` (gerenciado pelo LibSQL/Mastra).
