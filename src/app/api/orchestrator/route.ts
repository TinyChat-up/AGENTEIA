// ============================================================
// /api/orchestrator — Mother AI cycle triggers
// POST: trigger daily/weekly/biweekly cycle
// GET: recent runs + studio summary
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { orchestrator } from '@/lib/orchestrator/mother-ai'
import { createClient } from '@/lib/supabase/server'

export const maxDuration = 60

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-orchestrator-secret')
  if (secret !== process.env.ORCHESTRATOR_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body  = await req.json().catch(() => ({}))
  const cycle = body.cycle ?? 'daily'

  try {
    const result = cycle === 'weekly'
      ? await orchestrator.runWeeklyCycle()
      : await orchestrator.runDailyCycle()

    return NextResponse.json({ data: result })
  } catch (error) {
    console.error(`[Orchestrator] ${cycle} cycle error:`, error)
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const cycle = searchParams.get('cycle')

  // Vercel Cron trigger — uses Authorization: Bearer CRON_SECRET
  if (cycle) {
    const authHeader = req.headers.get('authorization')
    const cronSecret = process.env.CRON_SECRET
    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    try {
      const result = cycle === 'weekly'
        ? await orchestrator.runWeeklyCycle()
        : await orchestrator.runDailyCycle()
      return NextResponse.json({ data: result })
    } catch (error) {
      console.error(`[Orchestrator Cron] ${cycle} error:`, error)
      return NextResponse.json({ error: String(error) }, { status: 500 })
    }
  }

  // Dashboard read — no auth required
  const supabase = await createClient()

  const [orchResult, summaryResult] = await Promise.all([
    supabase.from('orchestrator_runs').select('*').order('created_at', { ascending: false }).limit(10),
    supabase.from('studio_summary').select('*').single(),
  ])

  return NextResponse.json({
    data: {
      recent_cycles: orchResult.data ?? [],
      studio_summary: summaryResult.data,
    }
  })
}
