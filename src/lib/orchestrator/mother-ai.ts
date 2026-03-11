// ============================================================
// AI VENTURE STUDIO — Mother AI Orchestrator v2
// Full governance: validate reports, enforce policies, decide,
// manage stages, rebalance budgets, spawn exploiters
// ============================================================

import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase/server'
import { computeAgentScore } from '@/lib/scoring/engine'
import { validateReport, shouldFreezeAgent } from '@/lib/reports/validator'
import { runAllPolicies, deriveAgentStatus } from '@/lib/policies/governance'
import type {
  Agent, Budget, Decision, Learning, MetricsDaily,
  OrchestratorRun, ReportV1, Run, ScoreBreakdown,
  AgentStage, DecisionOutcome,
} from '@/types'
import { STAGE_THRESHOLDS } from '@/types'

const anthropic = new Anthropic()

const MOTHER_AI_SYSTEM_PROMPT = `You are the Mother AI — the central investment committee and governance engine of an AI Venture Studio.

Your mandate is to govern a portfolio of AI micro-ventures with maximum discipline and minimum sentiment.

DECISION CRITERIA:
- FUND:      Score ≥60, stable/rising, S3 exploiters needing operational budget
- HOLD:      Score 40–59, or insufficient data, or policy violations pending resolution
- PIVOT:     Score 25–59, declining trend, hypothesis needs adjustment (not abandonment)
- KILL:      Score <25, or 3+ weeks negative trend, or unresolvable blockers
- PROMOTE:   Explorer passes stage threshold AND min_weeks AND required KPIs met
- REPLICATE: Score ≥75, proven playbook, ready to clone to adjacent vertical
- GRADUATE:  Explorer score ≥75 for 2+ weeks → spawn exploiter

HARD CONSTRAINTS YOU MUST RESPECT:
1. Never approve spend above €30 without flagging for human review
2. An explorer cannot scale itself — only you can promote
3. Freeze funding if no valid report in 48h
4. Pause agent after 3 consecutive run failures
5. Every decision must have concrete evidence
6. Separate exploration budget from exploitation budget always

REPORT VALIDATION: You receive ReportV1 structured data. Reject or freeze agents with invalid reports.

OUTPUT: Always respond with a single valid JSON object. No markdown. No preamble.`

// ============================================================
// ORCHESTRATOR CLASS
// ============================================================

export class MotherAI {
  private db: Awaited<ReturnType<typeof createClient>> | null = null

  private async getDb() {
    if (!this.db) this.db = await createClient()
    return this.db
  }

  // ----------------------------------------------------------
  // DAILY CYCLE
  // ----------------------------------------------------------

  async runDailyCycle(): Promise<OrchestratorRun> {
    const run = await this.startCycle('daily_metrics')

    try {
      const agents = await this.getActiveAgents()
      let frozen = 0

      for (const agent of agents) {
        if (agent.type === 'mother') continue

        // 1. Check report contract
        const freezeCheck = shouldFreezeAgent({
          lastReportAt:    agent.last_report_at,
          lastReportValid: await this.getLastReportValid(agent.id),
          freezeAfterHours: 48,
        })

        if (freezeCheck.should_freeze) {
          await this.freezeAgent(agent.id, freezeCheck.reason!)
          frozen++
          continue
        }

        // 2. Compute and persist score
        await this.evaluateAndScore(agent)
      }

      return this.completeCycle(run.id, {
        agents_evaluated: agents.length,
        agents_frozen: frozen,
        summary: `Daily cycle: ${agents.length} agents evaluated, ${frozen} frozen for missing/invalid reports.`,
      })
    } catch (e) {
      await this.failCycle(run.id, String(e))
      throw e
    }
  }

  // ----------------------------------------------------------
  // WEEKLY CYCLE — full governance
  // ----------------------------------------------------------

  async runWeeklyCycle(): Promise<OrchestratorRun> {
    const run = await this.startCycle('weekly_decisions')

    try {
      const agents = await this.getActiveAgents()
      const scores: ScoreBreakdown[] = []
      const decisions: Decision[] = []
      let reports_validated = 0
      let reports_rejected  = 0
      let agents_frozen     = 0

      for (const agent of agents) {
        if (agent.type === 'mother') continue

        // 1. Validate latest report
        const report = await this.getLatestReport(agent.id)
        if (report) {
          const vResult = validateReport(report)
          if (!vResult.is_valid) {
            await (await this.getDb()).from('reports').update({ is_valid: false, validation_errors: vResult.errors }).eq('id', report.id)
            reports_rejected++
          } else {
            await (await this.getDb()).from('reports').update({ is_valid: true, validation_errors: [] }).eq('id', report.id)
            reports_validated++
          }
        }

        // 2. Check freeze policy
        const lastReportValid = report ? (validateReport(report)).is_valid : null
        const freezeCheck     = shouldFreezeAgent({
          lastReportAt:    agent.last_report_at,
          lastReportValid,
        })

        if (freezeCheck.should_freeze && agent.status !== 'frozen') {
          await this.freezeAgent(agent.id, freezeCheck.reason!)
          agents_frozen++
          continue
        }

        // 3. Compute score
        const score = await this.evaluateAndScore(agent)
        scores.push(score)

        // 4. Run governance policies
        const budget    = await this.getBudget(agent.id)
        const weeklySpent = await this.getWeeklySpent(budget?.id ?? '')
        const policyResult = budget ? runAllPolicies({
          agent,
          budget,
          requested_spend_eur: 0,
          weekly_spent_eur: weeklySpent,
          last_report_valid: lastReportValid,
        }) : null

        if (policyResult?.has_blocks) {
          const newStatus = deriveAgentStatus(agent.status, policyResult)
          if (newStatus !== agent.status) {
            await (await this.getDb()).from('agents').update({ status: newStatus }).eq('id', agent.id)
          }
        }

        // 5. Generate AI decision
        const decision = await this.generateDecision(agent, score, budget, report)
        decisions.push(decision)

        // 6. Apply decision effects
        await this.applyDecision(agent, decision, budget)
      }

      // 7. Rebalance portfolio budgets
      const redistributed = await this.rebalancePortfolio(agents, scores)

      // 8. Check for graduations
      await this.processGraduations(agents, scores, decisions)

      const summary = this.buildWeeklySummary(agents, scores, decisions)

      return this.completeCycle(run.id, {
        agents_evaluated: agents.length,
        decisions_made: decisions.length,
        reports_validated,
        reports_rejected,
        agents_frozen,
        budget_redistributed_eur: redistributed,
        summary,
      })
    } catch (e) {
      await this.failCycle(run.id, String(e))
      throw e
    }
  }

  // ----------------------------------------------------------
  // SCORE EVALUATION
  // ----------------------------------------------------------

  private async evaluateAndScore(agent: Agent): Promise<ScoreBreakdown> {
    const [metrics, runs, learnings, decisions] = await Promise.all([
      this.getMetrics(agent.id, 30),
      this.getRuns(agent.id, 20),
      this.getLearnings(agent.id),
      this.getDecisions(agent.id, 5),
    ])

    const score = computeAgentScore({
      agentId:  agent.id,
      vertical: agent.vertical,
      stage:    agent.stage,
      metrics,
      runs,
      learnings,
      decisions,
    })

    await (await this.getDb()).from('agents').update({ current_score: score.composite_score }).eq('id', agent.id)

    return score
  }

  // ----------------------------------------------------------
  // AI DECISION GENERATION
  // ----------------------------------------------------------

  private async generateDecision(
    agent: Agent,
    score: ScoreBreakdown,
    budget: Budget | null,
    report: ReportV1 | null,
  ): Promise<Decision> {
    const prompt = this.buildDecisionPrompt(agent, score, budget, report)

    let parsed: Partial<Decision>

    try {
      const resp = await anthropic.messages.create({
        model: 'claude-opus-4-5',
        max_tokens: 1024,
        system: MOTHER_AI_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: prompt }],
      })
      const raw = resp.content[0].type === 'text' ? resp.content[0].text : '{}'
      const match = raw.match(/\{[\s\S]*\}/)
      parsed = match ? JSON.parse(match[0]) : {}
    } catch {
      parsed = {}
    }

    // Fallback to scoring engine recommendation
    const outcome: DecisionOutcome = parsed.outcome ?? score.recommendation

    const { data } = await (await this.getDb()).from('decisions').insert({
      agent_id:         agent.id,
      outcome,
      rationale:        parsed.rationale ?? `Score-based fallback: ${score.composite_score}/100 (${score.trend})`,
      score_at_decision: score.composite_score,
      evidence:         parsed.evidence ?? [`score:${score.composite_score}`, `trend:${score.trend}`],
      confidence:       parsed.confidence ?? 0.7,
      budget_change_eur: parsed.budget_change_eur ?? null,
      new_stage:        parsed.new_stage ?? null,
      new_hypothesis:   parsed.new_hypothesis ?? null,
      target_vertical:  parsed.target_vertical ?? null,
      made_by:          'mother_ai',
      effective_date:   new Date().toISOString().split('T')[0],
    }).select().single()

    return data!
  }

  // ----------------------------------------------------------
  // APPLY DECISION EFFECTS
  // ----------------------------------------------------------

  private async applyDecision(agent: Agent, decision: Decision, budget: Budget | null): Promise<void> {
    switch (decision.outcome) {
      case 'kill':
        await (await this.getDb()).from('agents').update({ status: 'terminated' }).eq('id', agent.id)
        break

      case 'hold':
        // No budget change, just record
        break

      case 'pivot':
        if (decision.new_hypothesis) {
          await (await this.getDb()).from('agents').update({ hypothesis: decision.new_hypothesis }).eq('id', agent.id)
        }
        break

      case 'promote':
        if (decision.new_stage && budget) {
          await this.promoteAgentStage(agent, decision.new_stage, budget)
        }
        break

      case 'fund':
        if (decision.budget_change_eur && decision.budget_change_eur > 0 && budget) {
          await this.recordBudgetChange(agent, budget, decision.budget_change_eur, `Fund decision: +€${decision.budget_change_eur}`)
        }
        break

      case 'graduate':
      case 'replicate':
        // Handled in processGraduations
        break
    }

    // Persist learning from this decision
    if (decision.rationale && decision.rationale.length > 30) {
      await (await this.getDb()).from('learnings').insert({
        agent_id: agent.id,
        hypothesis: agent.hypothesis,
        result: `Decision: ${decision.outcome} (score: ${decision.score_at_decision})`,
        analysis: decision.rationale,
        vertical: agent.vertical,
        stage: agent.stage,
        is_transferable: ['pivot', 'kill', 'graduate'].includes(decision.outcome),
        confidence: decision.confidence,
        tags: [decision.outcome, agent.stage, agent.vertical],
      })
    }
  }

  // ----------------------------------------------------------
  // STAGE PROMOTION
  // ----------------------------------------------------------

  private async promoteAgentStage(agent: Agent, newStage: AgentStage, oldBudget: Budget): Promise<void> {
    const config = STAGE_THRESHOLDS[newStage]

    // Update agent stage
    await (await this.getDb()).from('agents').update({ stage: newStage }).eq('id', agent.id)

    // Create new budget for the new stage
    const { data: newBudget } = await (await this.getDb()).from('budgets').insert({
      agent_id:                  agent.id,
      stage:                     newStage,
      allocated_eur:             config.budget_eur,
      hard_limit_eur:            config.budget_eur,
      weekly_limit_eur:          Math.round(config.budget_eur / 4),
      auto_approve_threshold_eur: 30,
      start_date:                new Date().toISOString().split('T')[0],
      end_date:                  new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    }).select().single()

    if (newBudget) {
      await (await this.getDb()).from('transactions_ledger').insert({
        agent_id:         agent.id,
        budget_id:        newBudget.id,
        type:             'stage_promotion',
        amount_eur:       config.budget_eur,
        balance_after_eur: config.budget_eur,
        description:      `Stage promotion ${agent.stage} → ${newStage}: €${config.budget_eur} allocated`,
        approved_by:      'mother_ai',
        requires_approval: config.budget_eur > 30,
        approved_at:      config.budget_eur <= 30 ? new Date().toISOString() : null,
      })
    }
  }

  // ----------------------------------------------------------
  // GRADUATION: Explorer → Exploiter
  // ----------------------------------------------------------

  private async processGraduations(
    agents: Agent[],
    scores: ScoreBreakdown[],
    decisions: Decision[],
  ): Promise<void> {
    for (const agent of agents.filter(a => a.type === 'explorer')) {
      const score    = scores.find(s => s.agent_id === agent.id)
      const decision = decisions.find(d => d.agent_id === agent.id)

      if (!score || !decision) continue
      if (!['graduate', 'replicate'].includes(decision.outcome)) continue
      if (score.composite_score < 75) continue

      await this.spawnExploiter(agent, score)
    }
  }

  private async spawnExploiter(explorer: Agent, score: ScoreBreakdown): Promise<void> {
    await (await this.getDb()).from('agents').update({ status: 'graduating' }).eq('id', explorer.id)

    const { data: exploiter } = await (await this.getDb()).from('agents').insert({
      name:            explorer.name.replace('Explorer', 'Exploiter').replace('EDU-', 'EDU-EXP-').replace('TECH-', 'TECH-EXP-'),
      type:            'exploiter',
      vertical:        explorer.vertical,
      stage:           'S2',
      hypothesis:      explorer.hypothesis,
      parent_agent_id: explorer.id,
      generation:      explorer.generation + 1,
      config_json: {
        ...explorer.config_json,
        can_spawn_agents: false,
        max_cost_per_run_eur: 20,
        max_daily_spend_eur: 100,
      },
    }).select().single()

    if (!exploiter) return

    const s2Config = STAGE_THRESHOLDS['S2']
    await (await this.getDb()).from('budgets').insert({
      agent_id:                  exploiter.id,
      stage:                     'S2',
      allocated_eur:             s2Config.budget_eur,
      hard_limit_eur:            s2Config.budget_eur,
      weekly_limit_eur:          Math.round(s2Config.budget_eur / 4),
      auto_approve_threshold_eur: 30,
      start_date:                new Date().toISOString().split('T')[0],
      end_date:                  new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    })

    await (await this.getDb()).from('learnings').insert({
      agent_id:        exploiter.id,
      hypothesis:      explorer.hypothesis,
      result:          `Graduated from explorer (score: ${score.composite_score})`,
      analysis:        `Exploiter spawned with validated playbook. Stage S2 with €${s2Config.budget_eur} budget.`,
      vertical:        explorer.vertical,
      stage:           'S2',
      is_transferable: true,
      confidence:      0.8,
      tags:            ['graduation', 'playbook', explorer.vertical],
    })
  }

  // ----------------------------------------------------------
  // PORTFOLIO REBALANCING
  // ----------------------------------------------------------

  private async rebalancePortfolio(agents: Agent[], scores: ScoreBreakdown[]): Promise<number> {
    let redistributed = 0

    for (const agent of agents.filter(a => a.type !== 'mother')) {
      const score  = scores.find(s => s.agent_id === agent.id)
      const budget = await this.getBudget(agent.id)
      if (!score || !budget) continue

      let delta = 0
      if (score.composite_score >= 75)      delta =  budget.weekly_limit_eur * 0.20
      else if (score.composite_score < 25)  delta = -budget.weekly_limit_eur * 0.30

      if (Math.abs(delta) > 0) {
        await this.recordBudgetChange(agent, budget, delta, `Weekly rebalance: score ${score.composite_score}`)
        redistributed += Math.abs(delta)
      }
    }

    return redistributed
  }

  // ----------------------------------------------------------
  // PROMPT BUILDER
  // ----------------------------------------------------------

  private buildDecisionPrompt(
    agent: Agent, score: ScoreBreakdown,
    budget: Budget | null, report: ReportV1 | null,
  ): string {
    return `
## AGENT: ${agent.name} [${agent.type.toUpperCase()}] | ${agent.vertical} | Stage ${agent.stage}
Hypothesis: ${agent.hypothesis}
Status: ${agent.status} | Generation: ${agent.generation} | Consecutive failures: ${agent.consecutive_failures}

## SCORE: ${score.composite_score}/100 (${score.trend}) — threshold for stage: ${score.threshold_for_stage}
- Profitability:     ${score.components.profitability.score}/100 (ROI: ${(score.components.profitability.roi * 100).toFixed(1)}%)
- Margin stability:  ${score.components.margin_stability.score}/100 (margin: ${(score.components.margin_stability.current_margin * 100).toFixed(1)}%)
- Automation:        ${score.components.automation.score}/100 (level: ${(score.components.automation.automation_level * 100).toFixed(0)}%)
- Risk penalty:      ${score.components.risk.score}/100 (total risk: ${(score.components.risk.total_risk * 100).toFixed(0)}%)
- CAC volatility:    ${score.components.cac_stability.score}/100 (volatility: ${score.components.cac_stability.cac_volatility.toFixed(2)})

## BUDGET: Stage ${budget?.stage ?? '?'} | Allocated: €${budget?.allocated_eur ?? 0} | Spent: €${budget?.spent_eur ?? 0} | Available: €${budget?.available_eur ?? 0}

## LATEST REPORT${report ? '' : ': NONE SUBMITTED'}
${report ? `Period: ${report.period_start} → ${report.period_end}
KPIs: revenue €${report.kpi_revenue_eur}, profit €${report.kpi_net_profit_eur}, margin ${(report.kpi_margin * 100).toFixed(1)}%
Hypothesis status: ${report.hypothesis_status}
Blockers: ${report.ops_blockers?.join('; ') || 'none'}
Risk overall: ${(report.risk_overall * 100).toFixed(0)}%` : 'No report → funding should be frozen'}

## REQUIRED JSON RESPONSE
{
  "outcome": "fund|hold|pivot|kill|promote|replicate|graduate",
  "rationale": "2-3 sentences with specific evidence",
  "evidence": ["specific metric 1", "specific observation 2"],
  "confidence": 0.0-1.0,
  "budget_change_eur": null or number,
  "new_stage": null or "S0|S1|S2|S3",
  "new_hypothesis": null or "string (pivot only)",
  "target_vertical": null or "education|b2b_tech (replicate only)"
}`
  }

  // ----------------------------------------------------------
  // SUMMARY
  // ----------------------------------------------------------

  private buildWeeklySummary(agents: Agent[], scores: ScoreBreakdown[], decisions: Decision[]): string {
    const avg   = scores.length ? (scores.reduce((s, sc) => s + sc.composite_score, 0) / scores.length).toFixed(1) : '0'
    const top   = scores.sort((a, b) => b.composite_score - a.composite_score)[0]
    const topName = agents.find(a => a.id === top?.agent_id)?.name ?? 'N/A'
    const counts = decisions.reduce((acc, d) => {
      acc[d.outcome] = (acc[d.outcome] ?? 0) + 1
      return acc
    }, {} as Record<string, number>)

    return [
      `Weekly cycle ${new Date().toISOString().split('T')[0]}`,
      `Portfolio avg score: ${avg}/100`,
      `Top: ${topName} (${top?.composite_score ?? 0})`,
      `Decisions: ${Object.entries(counts).map(([k, v]) => `${v}×${k}`).join(', ')}`,
    ].join(' | ')
  }

  // ----------------------------------------------------------
  // DB HELPERS
  // ----------------------------------------------------------

  private async startCycle(type: OrchestratorRun['cycle_type']): Promise<OrchestratorRun> {
    const { data } = await (await this.getDb()).from('orchestrator_runs').insert({ cycle_type: type }).select().single()
    return data!
  }

  private async completeCycle(id: string, updates: Partial<OrchestratorRun>): Promise<OrchestratorRun> {
    const { data } = await (await this.getDb()).from('orchestrator_runs')
      .update({ ...updates, status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', id).select().single()
    return data!
  }

  private async failCycle(id: string, error: string): Promise<void> {
    await (await this.getDb()).from('orchestrator_runs')
      .update({ status: 'failed', completed_at: new Date().toISOString(), summary: error })
      .eq('id', id)
  }

  private async freezeAgent(id: string, reason: string): Promise<void> {
    await (await this.getDb()).from('agents').update({ status: 'frozen' }).eq('id', id)
    await (await this.getDb()).from('decisions').insert({
      agent_id: id, outcome: 'hold', rationale: `Auto-frozen: ${reason}`,
      score_at_decision: 0, evidence: [reason], confidence: 1.0, made_by: 'mother_ai',
      effective_date: new Date().toISOString().split('T')[0],
    })
  }

  private async recordBudgetChange(agent: Agent, budget: Budget, delta: number, description: string): Promise<void> {
    if (delta > 0) {
      await (await this.getDb()).from('budgets').update({ allocated_eur: budget.allocated_eur + delta }).eq('id', budget.id)
    }
    await (await this.getDb()).from('transactions_ledger').insert({
      agent_id: agent.id, budget_id: budget.id,
      type: delta > 0 ? 'budget_allocation' : 'reclaim',
      amount_eur: delta,
      balance_after_eur: budget.available_eur + delta,
      description, approved_by: 'mother_ai',
      requires_approval: Math.abs(delta) > 30,
      approved_at: Math.abs(delta) <= 30 ? new Date().toISOString() : null,
    })
  }

  private async getActiveAgents(): Promise<Agent[]> {
    const { data } = await (await this.getDb()).from('agents').select('*').in('status', ['active', 'paused', 'frozen'])
    return (data ?? []) as Agent[]
  }

  private async getBudget(agentId: string): Promise<Budget | null> {
    const { data } = await (await this.getDb()).from('budgets').select('*').eq('agent_id', agentId).order('created_at', { ascending: false }).limit(1).single()
    return data as Budget | null
  }

  private async getLastReportValid(agentId: string): Promise<boolean | null> {
    const { data } = await (await this.getDb()).from('reports').select('is_valid').eq('agent_id', agentId).order('created_at', { ascending: false }).limit(1).single()
    return data ? (data as { is_valid: boolean }).is_valid : null
  }

  private async getLatestReport(agentId: string): Promise<ReportV1 | null> {
    const { data } = await (await this.getDb()).from('reports').select('*').eq('agent_id', agentId).order('created_at', { ascending: false }).limit(1).single()
    return data as ReportV1 | null
  }

  private async getMetrics(agentId: string, days = 30): Promise<MetricsDaily[]> {
    const since = new Date(Date.now() - days * 86400000).toISOString().split('T')[0]
    const { data } = await (await this.getDb()).from('metrics_daily').select('*').eq('agent_id', agentId).gte('date', since).order('date', { ascending: true })
    return (data ?? []) as MetricsDaily[]
  }

  private async getRuns(agentId: string, limit = 20): Promise<Run[]> {
    const { data } = await (await this.getDb()).from('runs').select('*').eq('agent_id', agentId).order('created_at', { ascending: false }).limit(limit)
    return (data ?? []) as Run[]
  }

  private async getLearnings(agentId: string): Promise<Learning[]> {
    const { data } = await (await this.getDb()).from('learnings').select('*').eq('agent_id', agentId)
    return (data ?? []) as Learning[]
  }

  private async getDecisions(agentId: string, limit = 5): Promise<Decision[]> {
    const { data } = await (await this.getDb()).from('decisions').select('*').eq('agent_id', agentId).order('created_at', { ascending: false }).limit(limit)
    return (data ?? []) as Decision[]
  }

  private async getWeeklySpent(budgetId: string): Promise<number> {
    const since = new Date(Date.now() - 7 * 86400000).toISOString()
    const { data } = await (await this.getDb()).from('transactions_ledger').select('amount_eur').eq('budget_id', budgetId).lt('amount_eur', 0).gte('created_at', since)
    return (data ?? []).reduce((s: number, r: { amount_eur: number }) => s + Math.abs(Number(r.amount_eur)), 0)
  }
}

export const orchestrator = new MotherAI()
