// ============================================================
// AI VENTURE STUDIO — Governance Policy Engine
// Codifies and enforces all 10 hard rules
// ============================================================

import type { Agent, Budget, Run, AgentStatus, DecisionOutcome } from '@/types'

// ============================================================
// POLICY DEFINITIONS
// ============================================================

export interface PolicyCheckResult {
  policy: string
  triggered: boolean
  action: 'pause' | 'freeze' | 'block' | 'flag' | 'none'
  reason: string | null
  suggested_decision: DecisionOutcome | null
}

// ============================================================
// RULE 1: Hard budget limit — never exceed hard_limit_eur
// (enforced at DB level too, this is the application layer check)
// ============================================================

export function checkHardLimit(params: {
  budget: Budget
  requested_eur: number
}): PolicyCheckResult {
  const { budget, requested_eur } = params
  const would_spend = budget.spent_eur + requested_eur

  return {
    policy: 'HARD_BUDGET_LIMIT',
    triggered: would_spend > budget.hard_limit_eur,
    action: would_spend > budget.hard_limit_eur ? 'block' : 'none',
    reason: would_spend > budget.hard_limit_eur
      ? `Would exceed hard limit: €${budget.hard_limit_eur} (spent: €${budget.spent_eur}, requested: €${requested_eur})`
      : null,
    suggested_decision: would_spend > budget.hard_limit_eur ? 'hold' : null,
  }
}

// ============================================================
// RULE 2: Auto-approve threshold — flag spends above €30
// ============================================================

export function checkApprovalThreshold(params: {
  amount_eur: number
  threshold_eur?: number
}): PolicyCheckResult {
  const { amount_eur, threshold_eur = 30 } = params
  const needs_approval = amount_eur > threshold_eur

  return {
    policy: 'SPEND_APPROVAL_THRESHOLD',
    triggered: needs_approval,
    action: needs_approval ? 'flag' : 'none',
    reason: needs_approval
      ? `Spend €${amount_eur} exceeds auto-approve threshold €${threshold_eur} — requires human approval`
      : null,
    suggested_decision: null,
  }
}

// ============================================================
// RULE 3: 3 consecutive failures → pause agent
// ============================================================

export function checkConsecutiveFailures(params: {
  agent: Agent
  threshold?: number
}): PolicyCheckResult {
  const { agent, threshold = 3 } = params
  const triggered = agent.consecutive_failures >= threshold

  return {
    policy: 'CONSECUTIVE_FAILURE_PAUSE',
    triggered,
    action: triggered ? 'pause' : 'none',
    reason: triggered
      ? `${agent.consecutive_failures} consecutive run failures (threshold: ${threshold})`
      : null,
    suggested_decision: triggered ? 'hold' : null,
  }
}

// ============================================================
// RULE 4: No valid report → freeze funding
// ============================================================

export function checkReportFreezePolicy(params: {
  agent: Agent
  lastReportValid: boolean | null
  freezeAfterHours?: number
}): PolicyCheckResult {
  const { agent, lastReportValid, freezeAfterHours = 48 } = params

  let triggered = false
  let reason: string | null = null

  if (!agent.last_report_at) {
    triggered = true
    reason = 'Agent has never submitted a report'
  } else {
    const hoursSince = (Date.now() - new Date(agent.last_report_at).getTime()) / (1000 * 60 * 60)
    if (hoursSince > freezeAfterHours) {
      triggered = true
      reason = `No report for ${Math.round(hoursSince)}h (threshold: ${freezeAfterHours}h)`
    }
  }

  if (!triggered && lastReportValid === false) {
    triggered = true
    reason = 'Last report failed format validation'
  }

  return {
    policy: 'NO_REPORT_FREEZE',
    triggered,
    action: triggered ? 'freeze' : 'none',
    reason,
    suggested_decision: triggered ? 'hold' : null,
  }
}

// ============================================================
// RULE 5 & 6: Explorer cannot scale — must go through Mother AI
// ============================================================

export function checkExplorerScaleBlock(params: {
  agent: Agent
  requested_action: string
}): PolicyCheckResult {
  const { agent, requested_action } = params

  const blocked_actions = ['scale', 'promote', 'graduate', 'replicate']
  const is_blocked = agent.type === 'explorer' && blocked_actions.includes(requested_action)

  return {
    policy: 'EXPLORER_NO_SELF_SCALE',
    triggered: is_blocked,
    action: is_blocked ? 'block' : 'none',
    reason: is_blocked
      ? `Explorer agents cannot self-initiate ${requested_action} — must be decided by Mother AI`
      : null,
    suggested_decision: null,
  }
}

// ============================================================
// RULE 7: All decisions must be registered
// (checked by orchestrator before applying any outcome)
// ============================================================

export function checkDecisionRegistration(params: {
  decision_type: DecisionOutcome
  agent_id: string
  rationale: string
}): PolicyCheckResult {
  const { rationale } = params
  const missing = !rationale || rationale.trim().length < 20

  return {
    policy: 'DECISION_MUST_BE_REGISTERED',
    triggered: missing,
    action: missing ? 'block' : 'none',
    reason: missing ? 'Decision rationale must be at least 20 characters' : null,
    suggested_decision: null,
  }
}

// ============================================================
// RULE 8: All spend through ledger
// (enforced by requiring budget_id on every transaction — DB level)
// ============================================================

export function checkLedgerRequirement(params: {
  budget_id: string | null
}): PolicyCheckResult {
  const missing = !params.budget_id

  return {
    policy: 'ALL_SPEND_THROUGH_LEDGER',
    triggered: missing,
    action: missing ? 'block' : 'none',
    reason: missing ? 'Every transaction requires a valid budget_id (ledger entry)' : null,
    suggested_decision: null,
  }
}

// ============================================================
// RULE 9: Weekly spend cap
// ============================================================

export function checkWeeklySpendCap(params: {
  weekly_spent_eur: number
  weekly_limit_eur: number
  requested_eur: number
}): PolicyCheckResult {
  const { weekly_spent_eur, weekly_limit_eur, requested_eur } = params
  const would_exceed = (weekly_spent_eur + requested_eur) > weekly_limit_eur

  return {
    policy: 'WEEKLY_SPEND_CAP',
    triggered: would_exceed,
    action: would_exceed ? 'block' : 'none',
    reason: would_exceed
      ? `Weekly spend would exceed limit (spent: €${weekly_spent_eur}, limit: €${weekly_limit_eur}, requested: €${requested_eur})`
      : null,
    suggested_decision: null,
  }
}

// ============================================================
// COMPOSITE POLICY CHECK — run all policies at once
// ============================================================

export interface CompositePolicyResult {
  all_pass: boolean
  has_blocks: boolean
  has_flags: boolean
  results: PolicyCheckResult[]
  blocking_policies: string[]
  flagged_policies: string[]
}

export function runAllPolicies(params: {
  agent: Agent
  budget: Budget
  requested_spend_eur?: number
  weekly_spent_eur?: number
  last_report_valid?: boolean | null
  requested_action?: string
}): CompositePolicyResult {
  const {
    agent,
    budget,
    requested_spend_eur = 0,
    weekly_spent_eur = 0,
    last_report_valid = null,
    requested_action = 'run',
  } = params

  const results: PolicyCheckResult[] = [
    checkHardLimit({ budget, requested_eur: requested_spend_eur }),
    checkApprovalThreshold({ amount_eur: requested_spend_eur }),
    checkConsecutiveFailures({ agent }),
    checkReportFreezePolicy({ agent, lastReportValid: last_report_valid }),
    checkExplorerScaleBlock({ agent, requested_action }),
    checkLedgerRequirement({ budget_id: budget.id }),
    checkWeeklySpendCap({
      weekly_spent_eur,
      weekly_limit_eur: budget.weekly_limit_eur,
      requested_eur: requested_spend_eur,
    }),
  ]

  const triggered = results.filter(r => r.triggered)
  const blocking  = triggered.filter(r => r.action === 'block' || r.action === 'pause' || r.action === 'freeze')
  const flagged   = triggered.filter(r => r.action === 'flag')

  return {
    all_pass:          triggered.length === 0,
    has_blocks:        blocking.length > 0,
    has_flags:         flagged.length > 0,
    results,
    blocking_policies: blocking.map(r => r.policy),
    flagged_policies:  flagged.map(r => r.policy),
  }
}

// ============================================================
// NEW AGENT STATUS after policy enforcement
// ============================================================

export function deriveAgentStatus(
  current: AgentStatus,
  policyResult: CompositePolicyResult
): AgentStatus {
  if (!policyResult.has_blocks) return current

  const policies = policyResult.blocking_policies

  if (policies.includes('CONSECUTIVE_FAILURE_PAUSE')) return 'paused'
  if (policies.includes('NO_REPORT_FREEZE'))          return 'frozen'
  if (policies.includes('HARD_BUDGET_LIMIT'))         return 'paused'

  return current
}
