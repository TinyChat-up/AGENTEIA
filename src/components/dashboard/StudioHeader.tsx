// ============================================================
// STUDIO HEADER — KPI bar at the top of the dashboard
// ============================================================

'use client'

interface StudioHeaderProps {
  summary: Record<string, unknown> | null
}

export function StudioHeader({ summary }: StudioHeaderProps) {
  const kpis = [
    {
      label: 'ACTIVE AGENTS',
      value: summary?.active_agents ?? 0,
      sub: `of ${summary?.total_agents ?? 0} total`,
      color: 'text-emerald-400',
    },
    {
      label: 'PORTFOLIO SCORE',
      value: `${Number(summary?.avg_score ?? 0).toFixed(1)}`,
      sub: 'avg composite',
      color: 'text-blue-400',
    },
    {
      label: 'MONTHLY REVENUE',
      value: `€${Number(summary?.monthly_revenue ?? 0).toFixed(0)}`,
      sub: `profit: €${Number(summary?.monthly_profit ?? 0).toFixed(0)}`,
      color: Number(summary?.monthly_profit ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400',
    },
    {
      label: 'BUDGET DEPLOYED',
      value: `€${Number(summary?.total_budget_spent ?? 0).toFixed(0)}`,
      sub: `of €${Number(summary?.total_budget_allocated ?? 0).toFixed(0)} allocated`,
      color: 'text-amber-400',
    },
    {
      label: 'PENDING APPROVALS',
      value: summary?.pending_approvals ?? 0,
      sub: 'awaiting review',
      color: Number(summary?.pending_approvals ?? 0) > 0 ? 'text-red-400' : 'text-slate-500',
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
            <span className="text-xs text-emerald-400 tracking-[0.3em] uppercase">
              Mother AI Online
            </span>
          </div>
          <h1 className="text-3xl font-light tracking-tight mt-1">
            Venture <span className="text-emerald-400">Studio</span>
          </h1>
        </div>
        <div className="text-right">
          <div className="text-xs text-slate-500 tracking-widest uppercase">
            {new Date().toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </div>
          <div className="text-xs text-slate-600 mt-1">
            W{getWeekNumber(new Date())} · Decisions cycle:{' '}
            <span className="text-amber-400">Sunday</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-5 gap-3">
        {kpis.map((kpi) => (
          <div
            key={kpi.label}
            className="bg-white/[0.03] border border-white/[0.06] rounded-lg px-4 py-3
                       hover:border-white/[0.12] transition-colors"
          >
            <div className="text-[10px] text-slate-500 tracking-[0.2em] uppercase mb-1">
              {kpi.label}
            </div>
            <div className={`text-2xl font-light ${kpi.color}`}>
              {kpi.value}
            </div>
            <div className="text-[10px] text-slate-600 mt-1">{kpi.sub}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function getWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
}
