// ============================================================
// AI VENTURE STUDIO — Agent Runner v1
// Executes real tasks for explorer/exploiter agents
// Tools: web_search, web_scrape, email_send, report_submit
// ============================================================

import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase/server'
import { validateReport } from '@/lib/reports/validator'
import { checkHardLimit, checkApprovalThreshold } from '@/lib/policies/governance'
import type { Agent, Budget, Run, ReportV1, AgentStage } from '@/types'

const anthropic = new Anthropic()

// ============================================================
// TOOL DEFINITIONS — what agents can actually do
// ============================================================

const AGENT_TOOLS: Anthropic.Tool[] = [
  {
    name: 'web_search',
    description: 'Search the web for information about markets, competitors, customers, or any topic relevant to the hypothesis.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search query' },
        max_results: { type: 'number', description: 'Max results to return (default 5)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'web_scrape',
    description: 'Scrape the content of a specific URL to extract information.',
    input_schema: {
      type: 'object' as const,
      properties: {
        url: { type: 'string', description: 'URL to scrape' },
        extract: { type: 'string', description: 'What to extract: text|links|structured' },
      },
      required: ['url'],
    },
  },
  {
    name: 'record_metric',
    description: 'Record a business metric or observation for today.',
    input_schema: {
      type: 'object' as const,
      properties: {
        metric_name: { type: 'string', description: 'Name of the metric' },
        value: { type: 'number', description: 'Numeric value' },
        unit: { type: 'string', description: 'Unit: eur, count, percent, days' },
        notes: { type: 'string', description: 'Context or explanation' },
      },
      required: ['metric_name', 'value', 'unit'],
    },
  },
  {
    name: 'record_learning',
    description: 'Save a learning or insight discovered during this run.',
    input_schema: {
      type: 'object' as const,
      properties: {
        hypothesis: { type: 'string', description: 'What was being tested' },
        result: { type: 'string', description: 'What happened' },
        analysis: { type: 'string', description: 'Why it happened and what it means' },
        is_transferable: { type: 'boolean', description: 'Can other agents use this learning?' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Tags for categorization' },
      },
      required: ['hypothesis', 'result', 'analysis'],
    },
  },
  {
    name: 'submit_report',
    description: 'Submit the mandatory ReportV1 to the Mother AI. Must be called at end of every run.',
    input_schema: {
      type: 'object' as const,
      properties: {
        period_start: { type: 'string', description: 'YYYY-MM-DD' },
        period_end: { type: 'string', description: 'YYYY-MM-DD' },
        kpis: {
          type: 'object',
          properties: {
            revenue_eur: { type: 'number' },
            net_profit_eur: { type: 'number' },
            margin: { type: 'number', description: '-1 to 1' },
            cac_eur: { type: 'number' },
            ltv_eur: { type: 'number' },
            payback_days: { type: 'number' },
          },
          required: ['revenue_eur', 'net_profit_eur', 'margin'],
        },
        spend: {
          type: 'object',
          properties: {
            ad_spend_eur: { type: 'number' },
            tools_spend_eur: { type: 'number' },
            other_spend_eur: { type: 'number' },
            total_eur: { type: 'number' },
          },
          required: ['total_eur'],
        },
        ops: {
          type: 'object',
          properties: {
            tasks_done: { type: 'number' },
            blockers: { type: 'array', items: { type: 'string' } },
            automation_level: { type: 'number', description: '0 to 1' },
          },
          required: ['tasks_done', 'blockers', 'automation_level'],
        },
        risk: {
          type: 'object',
          properties: {
            legal: { type: 'number' },
            platform_dependency: { type: 'number' },
            reputation: { type: 'number' },
            injection_exposure: { type: 'number' },
            overall: { type: 'number' },
          },
          required: ['legal', 'platform_dependency', 'reputation', 'injection_exposure', 'overall'],
        },
        next_actions: { type: 'array', items: { type: 'string' } },
        evidence: { type: 'array', items: { type: 'string' } },
        hypothesis_status: {
          type: 'string',
          enum: ['validating', 'validated', 'invalidated', 'pivoting'],
        },
        notes: { type: 'string' },
      },
      required: ['period_start', 'period_end', 'kpis', 'spend', 'ops', 'risk', 'next_actions', 'hypothesis_status'],
    },
  },
  {
    name: 'request_spend',
    description: 'Request budget spend for a tool, service, or action. Amounts above €30 require human approval.',
    input_schema: {
      type: 'object' as const,
      properties: {
        amount_eur: { type: 'number', description: 'Amount to spend in EUR' },
        vendor: { type: 'string', description: 'Who is being paid' },
        description: { type: 'string', description: 'What this is for' },
        evidence_url: { type: 'string', description: 'Link to invoice or proof' },
      },
      required: ['amount_eur', 'vendor', 'description'],
    },
  },
]

// ============================================================
// SYSTEM PROMPTS — per agent type
// ============================================================

function buildSystemPrompt(agent: Agent, budget: Budget | null): string {
  return `You are ${agent.name}, an AI agent in the ${agent.vertical} vertical of an AI Venture Studio.

YOUR HYPOTHESIS: ${agent.hypothesis}

YOUR STAGE: ${agent.stage} | YOUR STATUS: ${agent.status}
YOUR BUDGET: €${budget?.available_eur ?? 0} available | Hard limit: €${budget?.hard_limit_eur ?? 0}

YOUR MISSION THIS RUN:
1. Use your tools to make real progress on validating your hypothesis
2. Search for evidence, competitors, customer pain points, pricing signals
3. Record concrete learnings with specific data
4. Track any metrics you discover
5. Always end the run by submitting a ReportV1 using the submit_report tool

STRICT RULES:
- Never spend more than €${budget?.auto_approve_threshold_eur ?? 30} without using request_spend first
- Every claim must have evidence (URLs, screenshots, data)
- Be specific — no vague observations
- If you find the hypothesis is wrong, say so clearly in the report
- You MUST call submit_report before finishing

VERTICAL CONTEXT:
${agent.vertical === 'education'
  ? 'Focus on: corporate L&D buyers, training costs, learning outcomes, LMS market, edtech pricing'
  : 'Focus on: developer tools, SaaS pricing, API ecosystems, technical buyer behavior, integration pain points'
}

Today is ${new Date().toISOString().split('T')[0]}.`
}

// ============================================================
// TOOL EXECUTOR — handles each tool call
// ============================================================

async function executeTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  agent: Agent,
  runId: string,
  budget: Budget | null,
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<string> {
  switch (toolName) {

    case 'web_search': {
      const query = toolInput.query as string
      const maxResults = (toolInput.max_results as number) ?? 5

      // Use Anthropic's built-in web search via a sub-call
      try {
        const searchResp = await anthropic.messages.create({
          model: 'claude-opus-4-5',
          max_tokens: 1000,
          tools: [{ type: 'web_search_20250305' as any, name: 'web_search' }],
          messages: [{
            role: 'user',
            content: `Search for: ${query}. Return the top ${maxResults} results with titles, URLs, and brief summaries.`
          }]
        })

        const results = searchResp.content
          .filter(b => b.type === 'text')
          .map(b => (b as any).text)
          .join('\n')

        return results || `Search completed for: ${query}`
      } catch {
        return `Web search for "${query}" — Note: configure SERP API for production searches`
      }
    }

    case 'web_scrape': {
      const url = toolInput.url as string
      try {
        const resp = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; VentureStudioBot/1.0)' }
        })
        const html = await resp.text()
        // Basic text extraction
        const text = html
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .substring(0, 3000)
        return `Scraped ${url}:\n${text}`
      } catch (e) {
        return `Failed to scrape ${url}: ${String(e)}`
      }
    }

    case 'record_metric': {
      const { metric_name, value, unit, notes } = toolInput as {
        metric_name: string; value: number; unit: string; notes?: string
      }

      const today = new Date().toISOString().split('T')[0]
      const customKpi = { [metric_name]: value }

      await supabase.from('metrics_daily').upsert({
        agent_id: agent.id,
        date: today,
        custom_kpis: customKpi,
      }, { onConflict: 'agent_id,date', ignoreDuplicates: false })

      return `Metric recorded: ${metric_name} = ${value} ${unit}${notes ? ` (${notes})` : ''}`
    }

    case 'record_learning': {
      const { hypothesis, result, analysis, is_transferable, tags } = toolInput as {
        hypothesis: string; result: string; analysis: string;
        is_transferable?: boolean; tags?: string[]
      }

      await supabase.from('learnings').insert({
        agent_id: agent.id,
        run_id: runId,
        hypothesis,
        result,
        analysis,
        vertical: agent.vertical,
        stage: agent.stage,
        is_transferable: is_transferable ?? false,
        confidence: 0.7,
        tags: tags ?? [],
      })

      return `Learning saved: "${hypothesis}" → "${result}"`
    }

    case 'submit_report': {
      const reportData = toolInput as Partial<ReportV1>
      reportData.agent_id = agent.id
      reportData.run_id = runId
      reportData.stage = agent.stage
      reportData.format_version = 'v1'

      const validation = validateReport(reportData)

      await supabase.from('reports').insert({
        agent_id: agent.id,
        run_id: runId,
        period_start: reportData.period_start,
        period_end: reportData.period_end,
        stage: agent.stage,
        format_version: 'v1',
        kpi_revenue_eur: reportData.kpis?.revenue_eur ?? 0,
        kpi_net_profit_eur: reportData.kpis?.net_profit_eur ?? 0,
        kpi_margin: reportData.kpis?.margin ?? 0,
        kpi_cac_eur: reportData.kpis?.cac_eur ?? 0,
        kpi_ltv_eur: reportData.kpis?.ltv_eur ?? 0,
        kpi_payback_days: reportData.kpis?.payback_days ?? 0,
        spend_ad_eur: reportData.spend?.ad_spend_eur ?? 0,
        spend_tools_eur: reportData.spend?.tools_spend_eur ?? 0,
        spend_other_eur: reportData.spend?.other_spend_eur ?? 0,
        spend_total_eur: reportData.spend?.total_eur ?? 0,
        ops_tasks_done: reportData.ops?.tasks_done ?? 0,
        ops_blockers: reportData.ops?.blockers ?? [],
        ops_automation: reportData.ops?.automation_level ?? 0,
        risk_legal: reportData.risk?.legal ?? 0,
        risk_platform: reportData.risk?.platform_dependency ?? 0,
        risk_reputation: reportData.risk?.reputation ?? 0,
        risk_injection: reportData.risk?.injection_exposure ?? 0,
        risk_overall: reportData.risk?.overall ?? 0,
        next_actions: reportData.next_actions ?? [],
        evidence: reportData.evidence ?? [],
        hypothesis_status: reportData.hypothesis_status ?? 'validating',
        notes: reportData.notes ?? null,
        is_valid: validation.is_valid,
        validation_errors: validation.errors,
      })

      // Update agent last_report_at
      await supabase.from('agents').update({
        last_report_at: new Date().toISOString(),
        status: validation.is_valid ? 'active' : 'frozen',
      }).eq('id', agent.id)

      return validation.is_valid
        ? `✅ Report submitted successfully. Hypothesis status: ${reportData.hypothesis_status}`
        : `⚠️ Report submitted with ${validation.errors.length} validation errors: ${validation.errors.join(', ')}`
    }

    case 'request_spend': {
      const { amount_eur, vendor, description, evidence_url } = toolInput as {
        amount_eur: number; vendor: string; description: string; evidence_url?: string
      }

      if (!budget) return 'ERROR: No active budget found for this agent'

      const limitCheck = checkHardLimit({ budget: budget as any, requested_eur: amount_eur })
      if (limitCheck.triggered) return `BLOCKED: ${limitCheck.reason}`

      const approvalCheck = checkApprovalThreshold({ amount_eur })
      const requires_approval = approvalCheck.triggered

      await supabase.from('transactions_ledger').insert({
        agent_id: agent.id,
        budget_id: budget.id,
        type: 'spend',
        amount_eur: -Math.abs(amount_eur),
        balance_after_eur: Number(budget.available_eur) - amount_eur,
        description,
        vendor,
        evidence_url: evidence_url ?? null,
        approved_by: requires_approval ? 'pending' : 'auto',
        requires_approval,
        approved_at: requires_approval ? null : new Date().toISOString(),
        run_id: runId,
      })

      return requires_approval
        ? `⏳ Spend request of €${amount_eur} to ${vendor} queued for human approval (above €30 threshold)`
        : `✅ Spend of €${amount_eur} to ${vendor} auto-approved and recorded`
    }

    default:
      return `Unknown tool: ${toolName}`
  }
}

// ============================================================
// MAIN RUN FUNCTION
// ============================================================

export async function runAgent(params: {
  agentId: string
  goal: string
  maxIterations?: number
}): Promise<{ run: Run; summary: string; report_submitted: boolean }> {
  const { agentId, goal, maxIterations = 10 } = params
  const supabase = await createClient()

  // Load agent
  const { data: agent } = await supabase.from('agents').select('*').eq('id', agentId).single()
  if (!agent) throw new Error(`Agent ${agentId} not found`)

  if (!['active'].includes(agent.status)) {
    throw new Error(`Agent is ${agent.status} — cannot run. Must be active.`)
  }

  // Load budget
  const { data: budget } = await supabase
    .from('budgets').select('*').eq('agent_id', agentId)
    .order('created_at', { ascending: false }).limit(1).single()

  // Create run record
  const { data: run } = await supabase.from('runs').insert({
    agent_id: agentId,
    goal,
    status: 'running',
    started_at: new Date().toISOString(),
    cost_estimated_eur: 0.50,
  }).select().single()

  if (!run) throw new Error('Failed to create run record')

  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: goal }
  ]

  let iterations = 0
  let report_submitted = false
  let total_tokens = 0
  let tasks_completed = 0
  let tasks_failed = 0
  let final_summary = ''

  try {
    // Agentic loop
    while (iterations < maxIterations) {
      iterations++

      const response = await anthropic.messages.create({
        model: 'claude-opus-4-5',
        max_tokens: 2048,
        system: buildSystemPrompt(agent as Agent, budget as Budget | null),
        tools: AGENT_TOOLS,
        messages,
      })

      total_tokens += response.usage.input_tokens + response.usage.output_tokens

      // Collect text for summary
      const textBlocks = response.content.filter(b => b.type === 'text')
      if (textBlocks.length > 0) {
        final_summary = (textBlocks[0] as any).text
      }

      // If no tool use, agent is done
      if (response.stop_reason === 'end_turn' || !response.content.some(b => b.type === 'tool_use')) {
        break
      }

      // Process tool calls
      const toolUseBlocks = response.content.filter(b => b.type === 'tool_use')
      const toolResults: Anthropic.ToolResultBlockParam[] = []

      for (const block of toolUseBlocks) {
        if (block.type !== 'tool_use') continue

        const result = await executeTool(
          block.name,
          block.input as Record<string, unknown>,
          agent as Agent,
          run.id,
          budget as Budget | null,
          supabase
        )

        if (block.name === 'submit_report') report_submitted = true
        if (result.startsWith('✅') || result.startsWith('Metric') || result.startsWith('Learning')) {
          tasks_completed++
        } else if (result.startsWith('BLOCKED') || result.startsWith('ERROR') || result.startsWith('Failed')) {
          tasks_failed++
        } else {
          tasks_completed++
        }

        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: result,
        })
      }

      // Continue conversation
      messages.push({ role: 'assistant', content: response.content })
      messages.push({ role: 'user', content: toolResults })
    }

    // Complete run
    const cost_real_eur = (total_tokens / 1_000_000) * 15 // claude opus pricing ~$15/M tokens

    await supabase.from('runs').update({
      status: 'completed',
      finished_at: new Date().toISOString(),
      cost_real_eur,
      tokens_used: total_tokens,
      tasks_completed,
      tasks_failed,
      output_summary: final_summary.substring(0, 1000),
    }).eq('id', run.id)

    // Update consecutive_failures counter
    await supabase.from('agents').update({ consecutive_failures: 0 }).eq('id', agentId)

    return { run: { ...run, status: 'completed' } as Run, summary: final_summary, report_submitted }

  } catch (error) {
    await supabase.from('runs').update({
      status: 'failed',
      finished_at: new Date().toISOString(),
      error_message: String(error),
      tokens_used: total_tokens,
    }).eq('id', run.id)

    // Increment failure counter
    await supabase.from('agents')
      .update({ consecutive_failures: (agent.consecutive_failures ?? 0) + 1 })
      .eq('id', agentId)

    throw error
  }
}
