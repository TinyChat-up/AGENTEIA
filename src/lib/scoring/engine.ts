// ============================================================
// AI VENTURE STUDIO — Scoring Engine v2
// Risk-adjusted formula per governance spec:
//   Score = (net_profit / capital_deployed) × margin_stability × automation
//           − total_risk − cac_volatility
// ============================================================

import type {
  MetricsDaily, Run, Learning, Decision,
  ScoreBreakdown, DecisionOutcome, AgentStage, VerticalType
} from '@/types'
import { STAGE_THRESHOLDS } from '@/types'

const WEIGHTS = {
  profitability:    0.30,
  margin_stability: 0.20,
  automation:       0.20,
  risk:             0.15,
  cac_stability:    0.15,
} as const

const BENCHMARKS = {
  education: {
    target_roi: 0.25, target_margin: 0.35,
    target_cac_eur: 20, target_ltv_eur: 180, target_automation: 0.60,
  },
  b2b_tech: {
    target_roi: 0.40, target_margin: 0.50,
    target_cac_eur: 40, target_ltv_eur: 400, target_automation: 0.70,
  },
}

// ---- PROFITABILITY (0-100) ----------------------------------

function scoreProfitability(metrics: MetricsDaily[], vertical: VerticalType) {
  const bench = BENCHMARKS[vertical]
  const recent = metrics.slice(-14)
  if (!recent.length) return { score: 0, weight: WEIGHTS.profitability, roi: 0, net_profit_eur: 0, capital_deployed_eur: 0 }

  const net_profit_eur       = recent.reduce((s, m) => s + Number(m.net_profit_eur), 0)
  const capital_deployed_eur = recent.reduce((s, m) => s + Number(m.total_cost_eur), 0)
  const roi                  = capital_deployed_eur > 0 ? net_profit_eur / capital_deployed_eur : 0
  const slope                = roi >= 0 ? Math.min(80, (roi / bench.target_roi) * 80) : Math.max(-20, roi * 50)
  const score                = Math.min(100, Math.max(0, Math.round(20 + slope)))

  return { score, weight: WEIGHTS.profitability, roi, net_profit_eur, capital_deployed_eur }
}

// ---- MARGIN STABILITY (0-100) -------------------------------

function scoreMarginStability(metrics: MetricsDaily[]) {
  if (metrics.length < 3) return { score: 30, weight: WEIGHTS.margin_stability, current_margin: 0, margin_variance: 1 }

  const margins       = metrics.slice(-14).map(m => Number(m.margin))
  const current_margin = margins.at(-1) ?? 0
  const avg           = margins.reduce((s, m) => s + m, 0) / margins.length
  const variance      = margins.reduce((s, m) => s + (m - avg) ** 2, 0) / margins.length
  const margin_variance = Math.sqrt(variance)

  const marginScore    = Math.min(60, Math.max(0, current_margin * 100))
  const stabilityScore = Math.min(40, Math.max(0, (1 - margin_variance / 0.3) * 40))
  const score          = Math.min(100, Math.round(marginScore + stabilityScore))

  return { score, weight: WEIGHTS.margin_stability, current_margin, margin_variance }
}

// ---- AUTOMATION (0-100) ------------------------------------

function scoreAutomation(metrics: MetricsDaily[]) {
  const recent = metrics.slice(-7)
  if (!recent.length) return { score: 0, weight: WEIGHTS.automation, automation_level: 0 }

  const automation_level = recent.reduce((s, m) => s + Number(m.automation_score), 0) / recent.length
  const score            = Math.round(automation_level * 100)

  return { score, weight: WEIGHTS.automation, automation_level }
}

// ---- RISK PENALTY (0-100, subtracted) ----------------------

function scoreRisk(metrics: MetricsDaily[]) {
  const recent = metrics.slice(-7)
  if (!recent.length) return { score: 50, weight: WEIGHTS.risk, total_risk: 0.5, legal_risk: 0, platform_risk: 0 }

  const total_risk    = recent.reduce((s, m) => s + Number(m.risk_score), 0) / recent.length
  const legal_risk    = recent.reduce((s, m) => s + Number(m.legal_risk), 0) / recent.length
  const platform_risk = recent.reduce((s, m) => s + Number(m.platform_dependency_risk), 0) / recent.length
  const score         = Math.round(total_risk * 100)

  return { score, weight: WEIGHTS.risk, total_risk, legal_risk, platform_risk }
}

// ---- CAC VOLATILITY PENALTY (0-100, subtracted) -----------

function scoreCACStability(metrics: MetricsDaily[], vertical: VerticalType) {
  const bench  = BENCHMARKS[vertical]
  const recent = metrics.filter(m => m.cac_eur > 0).slice(-14)
  if (recent.length < 2) return { score: 30, weight: WEIGHTS.cac_stability, cac_volatility: 0, avg_cac_eur: 0 }

  const cacs        = recent.map(m => Number(m.cac_eur))
  const avg_cac_eur = cacs.reduce((s, c) => s + c, 0) / cacs.length
  const std         = Math.sqrt(cacs.reduce((s, c) => s + (c - avg_cac_eur) ** 2, 0) / cacs.length)
  const cac_volatility = avg_cac_eur > 0 ? std / avg_cac_eur : 1

  const levelPenalty = Math.min(60, (avg_cac_eur / bench.target_cac_eur) * 30)
  const volatPenalty = Math.min(40, cac_volatility * 40)
  const score        = Math.round(levelPenalty + volatPenalty)

  return { score, weight: WEIGHTS.cac_stability, cac_volatility, avg_cac_eur }
}

// ============================================================
// COMPOSITE — main exported function
// ============================================================

export function computeAgentScore(params: {
  agentId: string
  vertical: VerticalType
  stage: AgentStage
  metrics: MetricsDaily[]
  runs: Run[]
  learnings: Learning[]
  decisions: Decision[]
}): ScoreBreakdown {
  const { agentId, vertical, stage, metrics, decisions } = params

  const profitability    = scoreProfitability(metrics, vertical)
  const margin_stability = scoreMarginStability(metrics)
  const automation       = scoreAutomation(metrics)
  const risk             = scoreRisk(metrics)
  const cac_stability    = scoreCACStability(metrics, vertical)

  // Positives minus penalties
  const raw_score =
      profitability.score    * WEIGHTS.profitability
    + margin_stability.score * WEIGHTS.margin_stability
    + automation.score       * WEIGHTS.automation
    - risk.score             * WEIGHTS.risk
    - cac_stability.score    * WEIGHTS.cac_stability

  const composite_score = Math.min(100, Math.max(0, Math.round(raw_score)))
  const threshold       = STAGE_THRESHOLDS[stage].min_score
  const trend           = determineTrend(metrics)
  const recommendation  = deriveDecision(composite_score, trend, stage, decisions)

  return {
    agent_id: agentId,
    date: new Date().toISOString().split('T')[0],
    composite_score,
    raw_score,
    components: { profitability, margin_stability, automation, risk, cac_stability },
    threshold_for_stage: threshold,
    passes_threshold: composite_score >= threshold,
    trend,
    recommendation,
  }
}

function determineTrend(metrics: MetricsDaily[]): 'rising' | 'stable' | 'declining' {
  if (metrics.length < 6) return 'stable'
  const sorted = [...metrics].sort((a, b) => a.date.localeCompare(b.date))
  const half   = Math.floor(sorted.length / 2)
  const f      = sorted.slice(0, half).reduce((s, m) => s + Number(m.net_profit_eur), 0)
  const s2     = sorted.slice(half).reduce((s, m) => s + Number(m.net_profit_eur), 0)
  if (s2 > f * 1.15) return 'rising'
  if (s2 < f * 0.85) return 'declining'
  return 'stable'
}

function deriveDecision(
  score: number,
  trend: 'rising' | 'stable' | 'declining',
  stage: AgentStage,
  decisions: Decision[]
): DecisionOutcome {
  const recent = [...decisions].sort((a, b) => b.created_at.localeCompare(a.created_at))[0]
  const daysSince = recent
    ? (Date.now() - new Date(recent.created_at).getTime()) / 86400000
    : Infinity

  if (daysSince < 7) return recent.outcome

  if (score >= 75 && trend === 'rising') return stage === 'S3' ? 'fund' : 'promote'
  if (score >= 75)                        return 'graduate'
  if (score >= 60 && trend !== 'declining') return 'fund'
  if (score >= 40)                        return 'hold'
  if (score >= 25 && trend !== 'declining') return 'pivot'
  return 'kill'
}
