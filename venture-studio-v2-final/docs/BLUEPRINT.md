# AI VENTURE STUDIO — Blueprint Técnico v2
## Arquitectura unificada: Blueprint + Governance Spec

---

## 1. RESUMEN EJECUTIVO

Un AI Venture Studio autónomo y gobernado con:
- IA Madre: holding estratégico + comité de inversión automatizado
- Agentes Exploradores: validan micro-hipótesis con presupuestos cerrados
- Agentes Explotadores: escalan modelos validados, spawneados por la IA Madre
- Sistema de Gobierno: ledger inmutable, ReportV1, scoring por riesgo, stage gates, kill switches

---

## 2. DECISIONES CLAVE v2 vs v1

| Aspecto | v1 (solo Blueprint) | v2 (Fusión) |
|---------|--------------------|----|
| Tipos de agente | explorer/exploiter | mother/explorer/exploiter |
| Estados de agente | active/paused/terminated | +frozen +graduating +killed |
| Stage gates | No | S0(€150) S1(€500) S2(€2k) S3(€10k) |
| Contrato de reporte | Solo validación | ReportV1 completo con freeze automático |
| Decisiones | continue/pivot/scale/terminate/graduate | fund/hold/pivot/kill/promote/replicate/graduate |
| Scoring | 5 dimensiones positivas | Positivos - penalizaciones riesgo/CAC |
| Políticas | Solo DB triggers | Módulo governance.ts + DB triggers |
| Kill switch | No | Manual + automático codificado |
| CAC/LTV/Margin | Parcial | Campos completos en métricas |
| Ledger | Inmutable | Inmutable + vendor + evidence_url |

---

## 3. SCORING FORMULA

Score = (net_profit / capital_deployed)
       × margin_stability
       × automation_score
       - total_risk
       - cac_volatility

Pesos: Profitability 30% | Margin stability 20% | Automation 20% | Risk -15% | CAC volatility -15%

---

## 4. STAGE GATES

S0 €150 | S1 €500 (score≥40) | S2 €2k (score≥60) | S3 €10k (score≥75)

---

## 5. SETUP

```bash
npm install
cp .env.example .env.local
# Ejecutar SQL: supabase/migrations/001_initial_schema.sql
# Ejecutar SQL: supabase/policies/002_rls_policies.sql
npm run dev
npm run studio:daily   # primer ciclo
npm run studio:weekly  # ciclo de decisiones
```

---

## 6. FASES

- Fase 1 COMPLETA: DB, tipos, scoring, IA Madre, APIs, dashboard
- Fase 2 SEEDED: EDU-Explorer-01 y TECH-Explorer-01 en S0
- Fase 3 SIGUIENTE: Agent Runner con herramientas reales
- Fase 4: Exploiter spawn con playbook transferido
- Fase 5: Cross-agent learning, replicación
