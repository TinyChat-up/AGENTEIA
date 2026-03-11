// ============================================================
// /api/reports — ReportV1 ingestion and retrieval
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { validateReport } from '@/lib/reports/validator'
import type { ReportV1 } from '@/types'

// POST /api/reports — agent submits its ReportV1
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const body: Partial<ReportV1> = await req.json()

  if (!body.agent_id) {
    return NextResponse.json({ error: 'Missing agent_id' }, { status: 400 })
  }

  // 1. Validate the report contract
  const validation = validateReport(body)

  // 2. Persist the report regardless (with validation status)
  const { data: report, error } = await supabase.from('reports').insert({
    agent_id:          body.agent_id,
    run_id:            body.run_id ?? null,
    period_start:      body.period_start,
    period_end:        body.period_end,
    stage:             body.stage,
    format_version:    'v1',
    // KPIs
    kpi_revenue_eur:    body.kpis?.revenue_eur ?? 0,
    kpi_net_profit_eur: body.kpis?.net_profit_eur ?? 0,
    kpi_margin:         body.kpis?.margin ?? 0,
    kpi_cac_eur:        body.kpis?.cac_eur ?? 0,
    kpi_ltv_eur:        body.kpis?.ltv_eur ?? 0,
    kpi_payback_days:   body.kpis?.payback_days ?? 0,
    // Spend
    spend_ad_eur:       body.spend?.ad_spend_eur ?? 0,
    spend_tools_eur:    body.spend?.tools_spend_eur ?? 0,
    spend_other_eur:    body.spend?.other_spend_eur ?? 0,
    spend_total_eur:    body.spend?.total_eur ?? 0,
    // Ops
    ops_tasks_done:     body.ops?.tasks_done ?? 0,
    ops_blockers:       body.ops?.blockers ?? [],
    ops_automation:     body.ops?.automation_level ?? 0,
    // Risk
    risk_legal:         body.risk?.legal ?? 0,
    risk_platform:      body.risk?.platform_dependency ?? 0,
    risk_reputation:    body.risk?.reputation ?? 0,
    risk_injection:     body.risk?.injection_exposure ?? 0,
    risk_overall:       body.risk?.overall ?? 0,
    // Content
    next_actions:       body.next_actions ?? [],
    evidence:           body.evidence ?? [],
    hypothesis_status:  body.hypothesis_status ?? 'validating',
    notes:              body.notes ?? null,
    // Validation
    is_valid:           validation.is_valid,
    validation_errors:  validation.errors,
  }).select().single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // 3. Update agent's last_report_at
  await supabase.from('agents').update({
    last_report_at: new Date().toISOString(),
  }).eq('id', body.agent_id)

  // 4. If invalid, freeze the agent's funding immediately
  if (!validation.is_valid) {
    await supabase.from('agents').update({ status: 'frozen' }).eq('id', body.agent_id)
  } else if (body.agent_id) {
    // Unfreeze if previously frozen due to report issues
    await supabase.from('agents')
      .update({ status: 'active' })
      .eq('id', body.agent_id)
      .eq('status', 'frozen')
  }

  return NextResponse.json({
    data: report,
    validation: {
      is_valid: validation.is_valid,
      errors: validation.errors,
      warnings: validation.warnings,
    },
    message: validation.is_valid
      ? 'Report accepted and valid'
      : `Report rejected: ${validation.errors.length} validation error(s)`,
  }, { status: validation.is_valid ? 201 : 422 })
}

// GET /api/reports
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { searchParams } = new URL(req.url)

  const agent_id   = searchParams.get('agent_id')
  const only_valid = searchParams.get('valid') === 'true'
  const limit      = Number(searchParams.get('limit') ?? 20)

  let query = supabase.from('reports').select('*').order('created_at', { ascending: false }).limit(limit)

  if (agent_id)   query = query.eq('agent_id', agent_id)
  if (only_valid) query = query.eq('is_valid', true)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data })
}
