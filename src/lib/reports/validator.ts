// ============================================================
// AI VENTURE STUDIO — ReportV1 Validator
// Mother AI ignores/freezes agents that fail this contract
// ============================================================

import type { ReportV1, AgentStage } from '@/types'

interface ValidationRule {
  field: string
  check: (r: Partial<ReportV1>) => boolean
  message: string
}

// ============================================================
// BASE RULES — every report must pass these
// ============================================================

const BASE_RULES: ValidationRule[] = [
  {
    field: 'period_start',
    check: r => !!r.period_start && isValidDate(r.period_start),
    message: 'period_start must be a valid YYYY-MM-DD date',
  },
  {
    field: 'period_end',
    check: r => !!r.period_end && isValidDate(r.period_end),
    message: 'period_end must be a valid YYYY-MM-DD date',
  },
  {
    field: 'period_order',
    check: r => !r.period_start || !r.period_end || r.period_end >= r.period_start,
    message: 'period_end must be >= period_start',
  },
  {
    field: 'stage',
    check: r => !!r.stage && ['S0', 'S1', 'S2', 'S3'].includes(r.stage),
    message: 'stage must be one of S0, S1, S2, S3',
  },
  {
    field: 'kpis',
    check: r => !!r.kpis && typeof r.kpis === 'object',
    message: 'kpis block is required',
  },
  {
    field: 'kpis.revenue_eur',
    check: r => r.kpis !== undefined && typeof r.kpis.revenue_eur === 'number' && r.kpis.revenue_eur >= 0,
    message: 'kpis.revenue_eur must be a non-negative number',
  },
  {
    field: 'kpis.net_profit_eur',
    check: r => r.kpis !== undefined && typeof r.kpis.net_profit_eur === 'number',
    message: 'kpis.net_profit_eur is required (can be negative)',
  },
  {
    field: 'kpis.margin',
    check: r => r.kpis !== undefined && typeof r.kpis.margin === 'number'
                && r.kpis.margin >= -1 && r.kpis.margin <= 1,
    message: 'kpis.margin must be between -1 and 1',
  },
  {
    field: 'spend',
    check: r => !!r.spend && typeof r.spend === 'object',
    message: 'spend block is required',
  },
  {
    field: 'spend.total_eur',
    check: r => r.spend !== undefined && typeof r.spend.total_eur === 'number' && r.spend.total_eur >= 0,
    message: 'spend.total_eur must be a non-negative number',
  },
  {
    field: 'spend.consistency',
    check: r => {
      if (!r.spend) return false
      const computed = (r.spend.ad_spend_eur ?? 0)
                     + (r.spend.tools_spend_eur ?? 0)
                     + (r.spend.other_spend_eur ?? 0)
      return Math.abs(computed - r.spend.total_eur) < 0.02
    },
    message: 'spend.total_eur must equal ad + tools + other (within €0.02)',
  },
  {
    field: 'ops',
    check: r => !!r.ops && typeof r.ops === 'object',
    message: 'ops block is required',
  },
  {
    field: 'ops.automation_level',
    check: r => r.ops !== undefined && typeof r.ops.automation_level === 'number'
                && r.ops.automation_level >= 0 && r.ops.automation_level <= 1,
    message: 'ops.automation_level must be 0–1',
  },
  {
    field: 'ops.blockers',
    check: r => r.ops !== undefined && Array.isArray(r.ops.blockers),
    message: 'ops.blockers must be an array',
  },
  {
    field: 'risk',
    check: r => !!r.risk && typeof r.risk === 'object',
    message: 'risk block is required',
  },
  {
    field: 'risk.overall',
    check: r => r.risk !== undefined && typeof r.risk.overall === 'number'
                && r.risk.overall >= 0 && r.risk.overall <= 1,
    message: 'risk.overall must be 0–1',
  },
  {
    field: 'risk.components',
    check: r => {
      if (!r.risk) return false
      const fields = ['legal', 'platform_dependency', 'reputation', 'injection_exposure']
      return fields.every(f => typeof (r.risk as Record<string, unknown>)[f] === 'number')
    },
    message: 'risk must include legal, platform_dependency, reputation, injection_exposure (all 0–1)',
  },
  {
    field: 'next_actions',
    check: r => Array.isArray(r.next_actions) && r.next_actions.length > 0,
    message: 'next_actions must be a non-empty array of strings',
  },
  {
    field: 'hypothesis_status',
    check: r => !!r.hypothesis_status &&
                ['validating', 'validated', 'invalidated', 'pivoting'].includes(r.hypothesis_status),
    message: 'hypothesis_status must be one of: validating|validated|invalidated|pivoting',
  },
  {
    field: 'evidence',
    check: r => Array.isArray(r.evidence),
    message: 'evidence must be an array (empty is accepted)',
  },
]

// ============================================================
// STAGE-SPECIFIC RULES
// ============================================================

const STAGE_RULES: Record<AgentStage, ValidationRule[]> = {
  S0: [],
  S1: [
    {
      field: 'kpis.cac_eur',
      check: r => r.kpis !== undefined && typeof r.kpis.cac_eur === 'number' && r.kpis.cac_eur >= 0,
      message: 'S1+ requires kpis.cac_eur (customer acquisition cost)',
    },
  ],
  S2: [
    {
      field: 'kpis.ltv_eur',
      check: r => r.kpis !== undefined && typeof r.kpis.ltv_eur === 'number' && r.kpis.ltv_eur >= 0,
      message: 'S2+ requires kpis.ltv_eur (lifetime value)',
    },
    {
      field: 'kpis.payback_days',
      check: r => r.kpis !== undefined && typeof r.kpis.payback_days === 'number' && r.kpis.payback_days >= 0,
      message: 'S2+ requires kpis.payback_days',
    },
  ],
  S3: [],
}

// ============================================================
// RESULT TYPES
// ============================================================

export interface ValidationResult {
  is_valid: boolean
  errors: string[]
  warnings: string[]
}

// ============================================================
// MAIN VALIDATE FUNCTION
// ============================================================

export function validateReport(report: Partial<ReportV1>): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  // Base rules
  for (const rule of BASE_RULES) {
    if (!rule.check(report)) {
      errors.push(`[${rule.field}] ${rule.message}`)
    }
  }

  // Stage rules
  const stage = report.stage ?? 'S0'
  for (const rule of (STAGE_RULES[stage] ?? [])) {
    if (!rule.check(report)) {
      errors.push(`[${rule.field}] ${rule.message}`)
    }
  }

  // Warnings (non-blocking — Mother AI factors these into confidence)
  if (!report.evidence || report.evidence.length === 0) {
    warnings.push('No evidence URLs provided — Mother AI will apply confidence penalty')
  }
  if (report.risk?.overall && report.risk.overall > 0.7) {
    warnings.push('High overall risk (>0.7) — Mother AI may issue HOLD or KILL')
  }
  if (report.ops?.blockers && report.ops.blockers.length > 3) {
    warnings.push('4+ blockers — consider flagging for PIVOT decision')
  }
  if (report.hypothesis_status === 'invalidated' && !report.notes) {
    warnings.push('Hypothesis invalidated without notes — provide context for Mother AI')
  }

  return { is_valid: errors.length === 0, errors, warnings }
}

// ============================================================
// FREEZE CHECK — should agent funding be frozen?
// ============================================================

export function shouldFreezeAgent(params: {
  lastReportAt: string | null
  lastReportValid: boolean | null
  freezeAfterHours?: number
}): { should_freeze: boolean; reason: string | null } {
  const { lastReportAt, lastReportValid, freezeAfterHours = 48 } = params

  if (!lastReportAt) {
    return { should_freeze: true, reason: 'Agent has never submitted a report' }
  }

  const hoursSince = (Date.now() - new Date(lastReportAt).getTime()) / (1000 * 60 * 60)

  if (hoursSince > freezeAfterHours) {
    return {
      should_freeze: true,
      reason: `No report in ${Math.round(hoursSince)}h (policy threshold: ${freezeAfterHours}h)`,
    }
  }

  if (lastReportValid === false) {
    return { should_freeze: true, reason: 'Last submitted report failed format validation' }
  }

  return { should_freeze: false, reason: null }
}

// ============================================================
// HELPERS
// ============================================================

function isValidDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s))
}
