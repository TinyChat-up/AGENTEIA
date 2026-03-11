// ============================================================
// ORCHESTRATOR STATUS — Recent Mother AI runs
// ============================================================

'use client'

interface OrchestratorStatusProps {
  runs: Record<string, unknown>[]
}

export function OrchestratorStatus({ runs }: OrchestratorStatusProps) {
  return (
    <div className="bg-white/[0.02] border border-white/[0.05] rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-[10px] text-slate-500 tracking-[0.2em] uppercase">Mother AI</h3>
        <button
          onClick={() => {
            fetch('/api/orchestrator', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-orchestrator-secret': '',
              },
              body: JSON.stringify({ cycle: 'daily' }),
            })
          }}
          className="text-[10px] text-emerald-400/60 hover:text-emerald-400 
                     border border-emerald-400/20 hover:border-emerald-400/40
                     px-2 py-1 rounded transition-all"
        >
          ▶ Run Daily
        </button>
      </div>

      <div className="space-y-2">
        {runs.length === 0 ? (
          <div className="text-[11px] text-slate-600 py-2">No cycles run yet.</div>
        ) : (
          runs.map((run) => (
            <div
              key={String(run.id)}
              className="flex items-center justify-between py-1.5 
                         border-b border-white/[0.04] last:border-0"
            >
              <div className="flex items-center gap-2">
                <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                  run.status === 'completed' ? 'bg-emerald-400' :
                  run.status === 'failed' ? 'bg-red-400' :
                  'bg-amber-400 animate-pulse'
                }`} />
                <div>
                  <div className="text-[10px] text-white/70">
                    {run.cycle_type === 'weekly_decisions' ? '📊 Weekly' : '📈 Daily'}
                  </div>
                  <div className="text-[9px] text-slate-600">
                    {formatTimeAgo(String(run.created_at))}
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-[10px] text-slate-400">
                  {Number(run.agents_evaluated ?? 0)} agents
                </div>
                {Number(run.decisions_made ?? 0) > 0 && (
                  <div className="text-[9px] text-purple-400">
                    {run.decisions_made} decisions
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="pt-1 border-t border-white/[0.04]">
        <div className="text-[9px] text-slate-600">
          Next daily: <span className="text-slate-500">Midnight UTC</span> · 
          Weekly: <span className="text-slate-500">Sunday 00:00</span>
        </div>
      </div>
    </div>
  )
}

// ============================================================
// FINANCIAL PANEL — Studio-level P&L summary
// ============================================================

interface FinancialPanelProps {
  summary: Record<string, unknown> | null
}

export function FinancialPanel({ summary }: FinancialPanelProps) {
  const rows = [
    { label: 'Allocated', value: `€${Number(summary?.total_budget_allocated ?? 0).toFixed(2)}`, color: 'text-slate-300' },
    { label: 'Deployed', value: `€${Number(summary?.total_budget_spent ?? 0).toFixed(2)}`, color: 'text-amber-400' },
    { label: 'Remaining', value: `€${(Number(summary?.total_budget_allocated ?? 0) - Number(summary?.total_budget_spent ?? 0)).toFixed(2)}`, color: 'text-emerald-400' },
    { label: 'Revenue', value: `€${Number(summary?.monthly_revenue ?? 0).toFixed(2)}`, color: 'text-blue-400' },
    { label: 'Net Profit', value: `€${Number(summary?.monthly_profit ?? 0).toFixed(2)}`, color: Number(summary?.monthly_profit ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400' },
  ]

  const utilization = Number(summary?.total_budget_allocated ?? 1) > 0
    ? (Number(summary?.total_budget_spent ?? 0) / Number(summary?.total_budget_allocated ?? 1)) * 100
    : 0

  return (
    <div className="bg-white/[0.02] border border-white/[0.05] rounded-xl p-4 space-y-3">
      <h3 className="text-[10px] text-slate-500 tracking-[0.2em] uppercase">Financials</h3>

      <div className="space-y-2">
        {rows.map((row) => (
          <div key={row.label} className="flex justify-between items-center">
            <span className="text-[11px] text-slate-600">{row.label}</span>
            <span className={`text-[11px] font-mono ${row.color}`}>{row.value}</span>
          </div>
        ))}
      </div>

      <div className="pt-2 border-t border-white/[0.04]">
        <div className="flex justify-between text-[9px] text-slate-600 mb-1">
          <span>Budget utilization</span>
          <span>{utilization.toFixed(1)}%</span>
        </div>
        <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${
              utilization > 80 ? 'bg-red-400' : 
              utilization > 60 ? 'bg-amber-400' : 
              'bg-emerald-400'
            }`}
            style={{ width: `${Math.min(100, utilization)}%` }}
          />
        </div>
      </div>
    </div>
  )
}

// ============================================================
// PENDING APPROVALS — Transactions awaiting human review
// ============================================================

interface PendingApprovalsProps {
  items: Record<string, unknown>[]
}

export function PendingApprovals({ items }: PendingApprovalsProps) {
  const handleApprove = async (txId: string) => {
    await fetch('/api/ledger', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transaction_id: txId, reviewer_id: 'human' }),
    })
    window.location.reload()
  }

  return (
    <div className="bg-white/[0.02] border border-white/[0.05] rounded-xl p-4 space-y-3">
      <div className="flex items-center gap-2">
        <h3 className="text-[10px] text-slate-500 tracking-[0.2em] uppercase">Pending Approvals</h3>
        {items.length > 0 && (
          <span className="text-[9px] bg-red-500/20 text-red-400 border border-red-500/30 
                           px-1.5 py-0.5 rounded-full">
            {items.length}
          </span>
        )}
      </div>

      {items.length === 0 ? (
        <div className="text-[11px] text-slate-600 py-2">All clear ✓</div>
      ) : (
        <div className="space-y-2">
          {items.map((tx) => (
            <div
              key={String(tx.id)}
              className="bg-red-950/20 border border-red-500/20 rounded-lg p-3 space-y-2"
            >
              <div className="flex justify-between items-start">
                <div>
                  <div className="text-[10px] text-white/80">
                    {(tx.agents as Record<string, unknown> | null)?.name as string ?? 'Unknown agent'}
                  </div>
                  <div className="text-[9px] text-slate-500 mt-0.5">
                    {String(tx.description)}
                  </div>
                </div>
                <div className="text-sm font-mono text-red-400">
                  €{Math.abs(Number(tx.amount_eur)).toFixed(2)}
                </div>
              </div>
              <button
                onClick={() => handleApprove(String(tx.id))}
                className="w-full text-[10px] text-emerald-400 border border-emerald-400/30
                           py-1 rounded hover:bg-emerald-400/10 transition-colors"
              >
                ✓ Approve
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ============================================================
// HELPERS
// ============================================================

function formatTimeAgo(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}
