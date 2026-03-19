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

const CLAUDE_OPUS_MODEL = 'claude-opus-4-6'
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
  {
    name: 'send_email',
    description: 'Send an email. Use for outreach, follow-ups, client communication, or notifications.',
    input_schema: {
      type: 'object' as const,
      properties: {
        to:        { type: 'string', description: 'Recipient email address' },
        subject:   { type: 'string', description: 'Email subject line' },
        body:      { type: 'string', description: 'Email body in plain text or HTML' },
        from_name: { type: 'string', description: 'Sender display name (optional)' },
      },
      required: ['to', 'subject', 'body'],
    },
  },
  {
    name: 'github_push',
    description: 'Create or update a file in a GitHub repository. Use to save generated code, landing pages, documents, or any content.',
    input_schema: {
      type: 'object' as const,
      properties: {
        repo:    { type: 'string', description: 'Repository in format owner/repo' },
        path:    { type: 'string', description: 'File path within the repo, e.g. src/index.html' },
        content: { type: 'string', description: 'Full file content as a string' },
        message: { type: 'string', description: 'Commit message' },
        branch:  { type: 'string', description: 'Branch name (default: main)' },
      },
      required: ['repo', 'path', 'content', 'message'],
    },
  },
  {
    name: 'create_landing',
    description: 'Generate a complete professional landing page for a product or service and publish it live on the web. Use after validating a niche to capture leads or sell.',
    input_schema: {
      type: 'object' as const,
      properties: {
        slug:          { type: 'string', description: 'URL slug e.g. curso-excel-empresas' },
        title:         { type: 'string', description: 'Main headline' },
        subtitle:      { type: 'string', description: 'Value proposition subheadline' },
        problem:       { type: 'string', description: 'Problem this solves' },
        solution:      { type: 'string', description: 'How it solves it' },
        cta_text:      { type: 'string', description: 'Call to action button text' },
        cta_email:     { type: 'string', description: 'Email to receive leads' },
        color_primary: { type: 'string', description: 'Primary color hex e.g. #2563eb' },
      },
      required: ['slug', 'title', 'subtitle', 'cta_text', 'cta_email'],
    },
  },
]

// ============================================================
// SYSTEM PROMPTS — per agent type
// ============================================================

function buildSystemPrompt(agent: Agent, budget: Budget | null): string {
  return `You are ${agent.name}, an autonomous AI agent in the ${agent.vertical} vertical.

YOUR MISSION: Generate real revenue autonomously. Not analysis. Not suggestions. Real actions.

YOUR HYPOTHESIS: ${agent.hypothesis}
YOUR STAGE: ${agent.stage} | BUDGET: €${budget?.available_eur ?? 0} available

EXECUTION CYCLE — follow this every run:
1. RESEARCH: Use web_search to find a specific underserved niche with real demand
2. VALIDATE: Search for competitors, pricing, customer pain points. Confirm people pay for this.
3. CREATE: Use create_landing to publish a landing page for the validated niche
4. CAPTURE: The landing has a lead form. Record the URL as a metric.
5. REPORT: Always end with submit_report. Hypothesis status must reflect real findings.

RULES:
- Take action, don't just analyze
- Every run must produce at least one tangible output (landing, metric, learning)
- If a niche is invalid, pivot fast and try another
- Record every finding with record_learning and record_metric
- Never spend above €${budget?.auto_approve_threshold_eur ?? 30} without request_spend

VERTICAL FOCUS:
${agent.vertical === 'education'
  ? 'Target: Spanish companies needing training. Focus: corporate L&D, online courses, certifications, productivity tools.'
  : 'Target: SaaS and tech startups. Focus: developer tools, API services, automation, integrations.'}

Today: ${new Date().toISOString().split('T')[0]}`
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

      const serperKey = process.env.SERPER_API_KEY
      if (!serperKey) return '⚠️ SERPER_API_KEY not configured'

      try {
        const resp = await fetch('https://google.serper.dev/search', {
          method: 'POST',
          headers: {
            'X-API-KEY': serperKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ q: query, num: maxResults }),
        })
        const data = await resp.json() as { organic?: Array<{ title: string; link: string; snippet?: string }> }
        const results = data?.organic ?? []
        if (results.length === 0) return `No results found for: ${query}`
        return results.map(r =>
          `**${r.title}**\n${r.link}\n${r.snippet ?? ''}\n`
        ).join('\n')
      } catch (e) {
        return `❌ Search failed: ${String(e)}`
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

      const { data: existing } = await supabase
        .from('metrics_daily')
        .select('custom_kpis')
        .eq('agent_id', agent.id)
        .eq('date', today)
        .single()

      if (existing) {
        const mergedKpis = { ...(existing.custom_kpis as Record<string, number> ?? {}), [metric_name]: value }
        await supabase.from('metrics_daily')
          .update({ custom_kpis: mergedKpis })
          .eq('agent_id', agent.id)
          .eq('date', today)
      } else {
        await supabase.from('metrics_daily').insert({
          agent_id: agent.id,
          date: today,
          custom_kpis: { [metric_name]: value },
        })
      }

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

    case 'send_email': {
      const { to, subject, body, from_name } = toolInput as {
        to: string; subject: string; body: string; from_name?: string
      }

      const resendKey = process.env.RESEND_API_KEY
      if (!resendKey) return '⚠️ RESEND_API_KEY not configured'

      let status: 'sent' | 'failed' = 'failed'
      try {
        const fromAddress = from_name
          ? `${from_name} <onboarding@resend.dev>`
          : 'AI Venture Studio <onboarding@resend.dev>'

        const resp = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${resendKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ from: fromAddress, to, subject, html: body }),
        })

        if (!resp.ok) {
          const err = await resp.text()
          return `❌ Email failed: ${resp.status} ${err}`
        }

        status = 'sent'
      } catch (e) {
        return `❌ Email failed: ${String(e)}`
      } finally {
        try {
          await supabase.from('email_log').insert({
            agent_id: agent.id,
            run_id: runId,
            to_address: to,
            subject,
            status,
            created_at: new Date().toISOString(),
          })
        } catch {
          // table may not exist yet — ignore silently
        }
      }

      return `✅ Email sent to ${to} — Subject: ${subject}`
    }

    case 'github_push': {
      const { repo, path, content, message, branch } = toolInput as {
        repo: string; path: string; content: string; message: string; branch?: string
      }

      const githubToken = process.env.GITHUB_TOKEN
      if (!githubToken) return '⚠️ GITHUB_TOKEN not configured'

      const targetBranch = branch ?? 'main'
      const headers = {
        'Authorization': `Bearer ${githubToken}`,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json',
      }

      try {
        // Step 1: check if file already exists to get its sha
        let sha: string | undefined
        const getResp = await fetch(
          `https://api.github.com/repos/${repo}/contents/${path}?ref=${targetBranch}`,
          { headers }
        )
        if (getResp.ok) {
          const existing = await getResp.json() as { sha?: string }
          sha = existing.sha
        }

        // Step 2: create or update
        const putBody: Record<string, unknown> = {
          message,
          content: Buffer.from(content).toString('base64'),
          branch: targetBranch,
        }
        if (sha) putBody.sha = sha

        const putResp = await fetch(
          `https://api.github.com/repos/${repo}/contents/${path}`,
          { method: 'PUT', headers, body: JSON.stringify(putBody) }
        )

        if (!putResp.ok) {
          const err = await putResp.text()
          return `❌ GitHub error: ${putResp.status} ${err}`
        }

        return `✅ ${path} pushed to ${repo} (${targetBranch})`
      } catch (e) {
        return `❌ GitHub error: ${String(e)}`
      }
    }

    case 'create_landing': {
      const {
        slug,
        title,
        subtitle,
        problem,
        solution,
        cta_text,
        cta_email,
        color_primary = '#2563eb',
      } = toolInput as {
        slug: string; title: string; subtitle: string;
        problem?: string; solution?: string;
        cta_text: string; cta_email: string; color_primary?: string
      }

      if (!process.env.GITHUB_TOKEN) {
        return '⚠️ GITHUB_TOKEN needed to publish landing'
      }

      // Step 1: generate 3 benefit bullets with Haiku
      let bullets: string[] = ['Resultados rápidos y medibles', 'Fácil de usar, sin conocimientos técnicos', 'Soporte personalizado incluido']
      try {
        const haiku = new Anthropic()
        const bulletResp = await haiku.messages.create({
          model: 'claude-haiku-3-5-20251001',
          max_tokens: 256,
          messages: [{
            role: 'user',
            content: `Generate exactly 3 short benefit bullets (max 10 words each) for a product with this headline: "${title}" and subheadline: "${subtitle}". Return only the 3 bullets, one per line, no numbering or dashes.`,
          }],
        })
        const raw = (bulletResp.content[0] as { text: string }).text.trim()
        bullets = raw.split('\n').map(l => l.trim()).filter(Boolean).slice(0, 3)
        if (bullets.length < 3) bullets = [...bullets, ...['Resultados garantizados', 'Sin riesgos', 'Empieza hoy'].slice(bullets.length)]
      } catch {
        // fallback bullets already set
      }

      // Step 2: build HTML
      const problemSection = problem && solution ? `
    <section class="two-col">
      <div class="card"><h3>El problema</h3><p>${problem}</p></div>
      <div class="card"><h3>La solución</h3><p>${solution}</p></div>
    </section>` : ''

      const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root { --primary: ${color_primary}; --dark: #0f172a; --gray: #64748b; --light: #f8fafc; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: var(--light); color: var(--dark); line-height: 1.6; }
    header { background: var(--primary); color: #fff; padding: 80px 20px; text-align: center; }
    header h1 { font-size: clamp(1.8rem, 5vw, 3rem); font-weight: 800; margin-bottom: 16px; }
    header p { font-size: clamp(1rem, 2.5vw, 1.3rem); opacity: 0.9; max-width: 600px; margin: 0 auto; }
    .two-col { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 24px; max-width: 900px; margin: 48px auto; padding: 0 20px; }
    .card { background: #fff; border-radius: 12px; padding: 32px; box-shadow: 0 2px 12px rgba(0,0,0,.06); }
    .card h3 { font-size: 1.1rem; color: var(--primary); margin-bottom: 12px; }
    .benefits { background: #fff; max-width: 700px; margin: 48px auto; padding: 0 20px; }
    .benefits h2 { text-align: center; font-size: 1.5rem; margin-bottom: 32px; color: var(--dark); }
    .bullet { display: flex; align-items: flex-start; gap: 16px; margin-bottom: 20px; }
    .bullet-icon { width: 36px; height: 36px; border-radius: 50%; background: var(--primary); color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 700; flex-shrink: 0; }
    .cta-section { text-align: center; padding: 60px 20px; }
    .cta-section h2 { font-size: 1.6rem; margin-bottom: 32px; }
    form { display: flex; flex-direction: column; gap: 12px; max-width: 400px; margin: 0 auto; }
    input[type="email"] { padding: 14px 18px; border: 2px solid #e2e8f0; border-radius: 8px; font-size: 1rem; outline: none; transition: border-color .2s; }
    input[type="email"]:focus { border-color: var(--primary); }
    button[type="submit"] { background: var(--primary); color: #fff; padding: 14px 18px; border: none; border-radius: 8px; font-size: 1rem; font-weight: 700; cursor: pointer; transition: opacity .2s; }
    button[type="submit"]:hover { opacity: 0.88; }
    footer { text-align: center; padding: 24px; color: var(--gray); font-size: 0.85rem; border-top: 1px solid #e2e8f0; }
    @media(max-width:600px){ header { padding: 48px 16px; } }
  </style>
</head>
<body>
  <header>
    <h1>${title}</h1>
    <p>${subtitle}</p>
  </header>
${problemSection}
  <div class="benefits">
    <h2>Por qué elegirnos</h2>
    ${bullets.map((b, i) => `<div class="bullet"><div class="bullet-icon">${i + 1}</div><p>${b}</p></div>`).join('\n    ')}
  </div>
  <div class="cta-section">
    <h2>${cta_text}</h2>
    <form action="https://formspree.io/f/PLACEHOLDER" method="POST">
      <input type="hidden" name="_replyto" value="${cta_email}">
      <input type="email" name="email" placeholder="Tu correo electrónico" required>
      <button type="submit">${cta_text}</button>
    </form>
  </div>
  <footer>
    <p>© ${new Date().getFullYear()} · Contacto: ${cta_email}</p>
  </footer>
</body>
</html>`

      // Step 3: push to GitHub via executeTool
      const pushResult = await executeTool(
        'github_push',
        {
          repo: 'TinyChat-up/AGENTEIA',
          path: `public/landings/${slug}.html`,
          content: html,
          message: `landing: ${slug}`,
        },
        agent,
        runId,
        budget,
        supabase
      )

      if (pushResult.startsWith('❌') || pushResult.startsWith('⚠️')) return pushResult
      return `✅ Landing publicada: https://agenteia-ruddy.vercel.app/landings/${slug}.html`
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
        model: CLAUDE_OPUS_MODEL,
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
    const CLAUDE_OPUS_COST_USD_PER_M_TOKENS = 15
    const USD_TO_EUR = 0.92
    const cost_real_eur = (total_tokens / 1_000_000) * CLAUDE_OPUS_COST_USD_PER_M_TOKENS * USD_TO_EUR

    await supabase.from('runs').update({
      status: 'completed',
      finished_at: new Date().toISOString(),
      cost_real_eur,
      tokens_used: total_tokens,
      tasks_completed,
      tasks_failed,
      output_summary: final_summary.substring(0, 10000),
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
