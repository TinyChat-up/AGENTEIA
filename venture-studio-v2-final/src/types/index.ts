// ============================================================
// AI VENTURE STUDIO — Core Type System v2
// Unified from architectural blueprint + governance spec
// ============================================================

// ============================================================
// FOUNDATIONAL ENUMS
// ============================================================

/** All agents including the mother */
export type AgentType = 'mother' | 'explorer' | 'exploiter'

export type VerticalType = 'education' | 'b2b_tech'

/** Active lifecycle states */
export type AgentStatus =
  | 'active'
  | 'paused'          // manual pause or 3-consecutive-failure rule
  | 'frozen'          // no valid report received — funding frozen
  | 'graduating'      // explorer promoted, exploiter being spawned
  | 'terminated'      // killed by Mother AI or human
  | 'killed'          // hard kill-switch triggered by human

/** Stage gates for explorer progression */
export type AgentStage = 'S0' | 'S1' | 'S2' | 'S3'
// S0 = hypothesis validation  (budget: 150 EUR)
// S1 = early traction          (budget: 500 EUR)
// S2 = scaling                 (budget: 2000 EUR)
// S3 = exploiter full ops      (budget: 10000 EUR)

export type RunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'

export type DecisionOutcome =
  | 'fund'
  | 'hold'
  | 'pivot'
  | 'kill'
  | 'promote'
  | 'replicate'
  | 'graduate'

export type TransactionType =
  | 'budget_allocation'
  | 'stage_promotion'
  | 'spend'
  | 'refund'
  | 'penalty'
  | 'bonus'
  | 'reclaim'

export type ArtifactType =
  | 'landing_page'
  | 'report'
  | 'hypothesis'
  | 'experiment'
  | 'model'
  | 'dataset'
  | 'playbook'
  | 'ad_creative'

export type ToolPermission =
  | 'web_search'
  | 'email_send'
  | 'web_scrape'
  | 'file_read'
  | 'file_write'
  | 'api_call_external'
  | 'database_read'
  | 'database_write'
  | 'ad_platform'
  | 'payment_processor'

// ============================================================
// AGENTS
// ============================================================

export interface AgentConfig {
  tools_allowed: ToolPermission[]
  max_cost_per_run_eur: number
  max_daily_spend_eur: number
  reporting_required: boolean
  report_interval_hours: number
  can_spawn_agents: boolean
  kill_switch_active: boolean
  custom_constraints: Record<string, unknown>
}

export interface Agent {
  id: string
  name: string
  type: AgentType
  vertical: VerticalType
  status: AgentStatus
  stage: AgentStage
  config_json: AgentConfig
  hypothesis: string
  current_score: number
  consecutive_failures: number
  last_report_at: string | null
  parent_agent_id: string | null
  generation: number
  created_at: string
  updated_at: string
}

export interface AgentWithBudget extends Agent {
  budget: Budget | null
  latest_run: Run | null
  latest_metrics: MetricsDaily | null
  latest_report: ReportV1 | null
  pending_transactions: number
}

// ============================================================
// BUDGETS
// ============================================================

export interface Budget {
  id: string
  agent_id: string
  stage: AgentStage
  allocated_eur: number
  spent_eur: number
  available_eur: number
  hard_limit_eur: number
  weekly_limit_eur: number
  auto_approve_threshold_eur: number
  start_date: string
  end_date: string
  created_at: string
  updated_at: string
}

// ============================================================
// RUNS
// ============================================================

export interface Run {
  id: string
  agent_id: string
  goal: string
  status: RunStatus
  cost_estimated_eur: number
  cost_real_eur: number
  started_at: string | null
  finished_at: string | null
  tasks_completed: number
  tasks_failed: number
  tokens_used: number
  error_message: string | null
  output_summary: string | null
  metadata: Record<string, unknown>
  created_at: string
}

// ============================================================
// METRICS DAILY
// ============================================================

export interface MetricsDaily {
  id: string
  agent_id: string
  date: string
  revenue_eur: number
  net_profit_eur: number
  ad_spend_eur: number
  tools_spend_eur: number
  other_spend_eur: number
  total_cost_eur: number
  margin: number
  cac_eur: number
  ltv_eur: number
  payback_days: number
  leads_generated: number
  conversions: number
  conversion_rate: number
  experiments_run: number
  experiments_succeeded: number
  success_rate: number
  automation_score: number
  tasks_done: number
  risk_score: number
  legal_risk: number
  platform_dependency_risk: number
  reputation_risk: number
  injection_exposure: number
  nps_score: number | null
  custom_kpis: Record<string, number>
  created_at: string
}

// ============================================================
// REPORT V1 — Standardized reporting contract
// ============================================================

export interface ReportV1 {
  id: string
  agent_id: string
  run_id: string | null
  period_start: string
  period_end: string
  stage: AgentStage
  format_version: 'v1'
  kpis: {
    revenue_eur: number
    net_profit_eur: number
    margin: number
    cac_eur: number
    ltv_eur: number
    payback_days: number
  }
  spend: {
    ad_spend_eur: number
    tools_spend_eur: number
    other_spend_eur: number
    total_eur: number
  }
  ops: {
    tasks_done: number
    blockers: string[]
    automation_level: number
  }
  risk: {
    legal: number
    platform_dependency: number
    reputation: number
    injection_exposure: number
    overall: number
  }
  next_actions: string[]
  evidence: string[]
  hypothesis_status: 'validating' | 'validated' | 'invalidated' | 'pivoting'
  notes: string | null
  is_valid: boolean
  validation_errors: string[]
  created_at: string
}

// ============================================================
// TRANSACTIONS LEDGER
// ============================================================

export interface TransactionLedger {
  id: string
  agent_id: string
  budget_id: string
  type: TransactionType
  amount_eur: number
  balance_after_eur: number
  description: string
  vendor: string | null
  evidence_url: string | null
  approved_by: 'auto' | 'mother_ai' | string
  run_id: string | null
  requires_approval: boolean
  approved_at: string | null
  rejected_at: string | null
  rejection_reason: string | null
  created_at: string
}

// ============================================================
// DECISIONS
// ============================================================

export interface Decision {
  id: string
  agent_id: string
  outcome: DecisionOutcome
  rationale: string
  score_at_decision: number
  evidence: string[]
  confidence: number
  budget_change_eur: number | null
  new_stage: AgentStage | null
  new_hypothesis: string | null
  target_vertical: VerticalType | null
  made_by: 'mother_ai' | 'human_override'
  human_reviewer_id: string | null
  reviewed_at: string | null
  overridden: boolean
  override_reason: string | null
  effective_date: string
  created_at: string
}

// ============================================================
// LEARNINGS
// ============================================================

export interface Learning {
  id: string
  agent_id: string
  run_id: string | null
  hypothesis: string
  result: string
  analysis: string
  vertical: VerticalType
  stage: AgentStage
  is_transferable: boolean
  confidence: number
  tags: string[]
  created_at: string
}

// ============================================================
// ARTIFACTS
// ============================================================

export interface Artifact {
  id: string
  agent_id: string
  run_id: string | null
  type: ArtifactType
  title: string
  description: string
  url: string | null
  storage_path: string | null
  version: number
  is_active: boolean
  metadata: Record<string, unknown>
  created_at: string
}

// ============================================================
// SCORING — Risk-adjusted composite score
// Score = (net_profit / capital_deployed)
//        x margin_stability
//        x automation_score
//        - total_risk
//        - cac_volatility
// ============================================================

export interface ScoreComponents {
  profitability: {
    score: number
    weight: number
    roi: number
    net_profit_eur: number
    capital_deployed_eur: number
  }
  margin_stability: {
    score: number
    weight: number
    current_margin: number
    margin_variance: number
  }
  automation: {
    score: number
    weight: number
    automation_level: number
  }
  risk: {
    score: number
    weight: number
    total_risk: number
    legal_risk: number
    platform_risk: number
  }
  cac_stability: {
    score: number
    weight: number
    cac_volatility: number
    avg_cac_eur: number
  }
}

export interface ScoreBreakdown {
  agent_id: string
  date: string
  composite_score: number
  raw_score: number
  components: ScoreComponents
  threshold_for_stage: number
  passes_threshold: boolean
  trend: 'rising' | 'stable' | 'declining'
  recommendation: DecisionOutcome
}

// ============================================================
// STAGE THRESHOLDS
// ============================================================

export const STAGE_THRESHOLDS: Record<AgentStage, {
  min_score: number
  min_weeks: number
  budget_eur: number
  required_kpis: string[]
}> = {
  S0: { min_score: 0,  min_weeks: 0, budget_eur: 150,   required_kpis: [] },
  S1: { min_score: 40, min_weeks: 2, budget_eur: 500,   required_kpis: ['first_paying_customer', 'positive_margin'] },
  S2: { min_score: 60, min_weeks: 3, budget_eur: 2000,  required_kpis: ['cac_ltv_ratio_positive', 'repeatable_acquisition'] },
  S3: { min_score: 75, min_weeks: 4, budget_eur: 10000, required_kpis: ['profitable', 'automated_ops', 'stable_margin'] },
}

// ============================================================
// GOVERNANCE POLICIES
// ============================================================

export interface GovernancePolicy {
  id: string
  name: string
  description: string
  rule_type:
    | 'consecutive_failure_pause'
    | 'no_report_freeze'
    | 'budget_hard_limit'
    | 'spend_approval_threshold'
    | 'explorer_no_self_scale'
    | 'kill_switch'
    | 'weekly_spend_cap'
  parameters: Record<string, number | string | boolean>
  is_active: boolean
  created_at: string
}

// ============================================================
// ORCHESTRATOR
// ============================================================

export interface OrchestratorRun {
  id: string
  cycle_type: 'daily_metrics' | 'weekly_decisions' | 'biweekly_review'
  started_at: string
  completed_at: string | null
  agents_evaluated: number
  decisions_made: number
  reports_validated: number
  reports_rejected: number
  agents_frozen: number
  budget_redistributed_eur: number
  status: 'running' | 'completed' | 'failed'
  summary: string | null
  raw_output: string | null
  created_at: string
}

// ============================================================
// API WRAPPERS
// ============================================================

export interface ApiResponse<T> {
  data: T | null
  error: string | null
  metadata?: { count?: number; page?: number; total?: number }
}

export interface PaginatedResponse<T> {
  items: T[]
  total: number
  page: number
  per_page: number
  has_more: boolean
}

// ============================================================
// DASHBOARD AGGREGATES
// ============================================================

export interface StudioSummary {
  total_agents: number
  active_agents: number
  paused_agents: number
  frozen_agents: number
  explorer_count: number
  exploiter_count: number
  total_budget_allocated_eur: number
  total_budget_spent_eur: number
  monthly_revenue_eur: number
  monthly_profit_eur: number
  avg_score: number
  top_agent: AgentWithBudget | null
  decisions_this_week: number
  pending_approvals: number
  reports_missing: number
  stage_distribution: Record<AgentStage, number>
}
