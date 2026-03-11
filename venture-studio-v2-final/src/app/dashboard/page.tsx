// ============================================================
// AI VENTURE STUDIO — Main Dashboard Page
// ============================================================

import { createClient } from '@/lib/supabase/server'
import { StudioHeader } from '@/components/dashboard/StudioHeader'
import { AgentGrid } from '@/components/dashboard/AgentGrid'
import { FinancialPanel } from '@/components/dashboard/FinancialPanel'
import { OrchestratorStatus } from '@/components/dashboard/OrchestratorStatus'
import { PendingApprovals } from '@/components/dashboard/PendingApprovals'

export const dynamic = 'force-dynamic'
export const revalidate = 0

async function getStudioData() {
  const supabase = createClient()

  const [summaryResult, agentsResult, orchResult, pendingResult] = await Promise.all([
    supabase.from('studio_summary').select('*').single(),
    supabase
      .from('agent_full_status')
      .select('*')
      .order('current_score', { ascending: false })
      .limit(12),
    supabase
      .from('orchestrator_runs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(5),
    supabase
      .from('transactions_ledger')
      .select('*, agents(name, vertical)')
      .eq('requires_approval', true)
      .is('approved_at', null)
      .order('created_at', { ascending: false }),
  ])

  return {
    summary:  summaryResult.data,
    agents:   agentsResult.data ?? [],
    orchRuns: orchResult.data ?? [],
    pending:  pendingResult.data ?? [],
  }
}

export default async function DashboardPage() {
  const { summary, agents, orchRuns, pending } = await getStudioData()

  return (
    <div className="min-h-screen bg-[#080C14] text-white font-mono">
      {/* Ambient background */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-emerald-500/5 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-blue-500/5 rounded-full blur-3xl" />
        <div
          className="absolute inset-0 opacity-[0.015]"
          style={{
            backgroundImage: `repeating-linear-gradient(0deg, transparent, transparent 39px, #10b98133 39px, #10b98133 40px),
                             repeating-linear-gradient(90deg, transparent, transparent 39px, #10b98133 39px, #10b98133 40px)`,
          }}
        />
      </div>

      <div className="relative z-10 max-w-[1600px] mx-auto px-6 py-8 space-y-8">
        <StudioHeader summary={summary} />

        <div className="grid grid-cols-12 gap-6">
          {/* Main: Agent Grid */}
          <div className="col-span-12 lg:col-span-8 space-y-6">
            <AgentGrid agents={agents} />
          </div>

          {/* Sidebar */}
          <div className="col-span-12 lg:col-span-4 space-y-6">
            <OrchestratorStatus runs={orchRuns} />
            <PendingApprovals items={pending} />
            <FinancialPanel summary={summary} />
          </div>
        </div>
      </div>
    </div>
  )
}
