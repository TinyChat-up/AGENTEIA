// ============================================================
// AGENT GRID — Portfolio view of all agents
// ============================================================

'use client'

import Link from 'next/link'

const VERTICAL_LABELS: Record<string, string> = {
  education: 'EDU',
  b2b_tech: 'B2B',
}

const MODE_COLORS: Record<string, string> = {
  explorer:  'text-blue-400 border-blue-400/30 bg-blue-400/5',
  exploiter: 'text-purple-400 border-purple-400/30 bg-purple-400/5',
}

const STATUS_DOT: Record<string, string> = {
  active:      'bg-emerald-400',
  paused:      'bg-amber-400',
  terminated:  'bg-red-400',
  graduating:  'bg-purple-400 animate-pulse',
}

const SCORE_COLOR = (score: number): string => {
  if (score >= 75) return 'text-emerald-400'
  if (score >= 50) return 'text-blue-400'
  if (score >= 30) return 'text-amber-400'
  return 'text-red-400'
}

const SCORE_BAR_COLOR = (score: number): string => {
  if (score >= 75) return 'bg-emerald-400'
  if (score >= 50) return 'bg-blue-400'
  if (score >= 30) return 'bg-amber-400'
  return 'bg-red-400'
}

interface AgentGridProps {
  agents: Record<string, unknown>[]
}

export function AgentGrid({ agents }: AgentGridProps) {
  if (agents.length === 0) {
    return (
      <div className="bg-white/[0.02] border border-white/[0.05] rounded-xl p-12 text-center">
        <div className="text-slate-600 text-sm">No agents deployed yet.</div>
        <Link
          href="/dashboard/agents/new"
          className="mt-4 inline-block px-4 py-2 border border-emerald-500/30 
                     text-emerald-400 text-xs rounded hover:bg-emerald-400/10 transition-colors"
        >
          + Deploy First Agent
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-xs text-slate-500 tracking-[0.2em] uppercase">Agent Portfolio</h2>
        <Link
          href="/dashboard/agents"
          className="text-xs text-emerald-400/70 hover:text-emerald-400 transition-colors"
        >
          View all →
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-3">
        {agents.map((agent) => {
          const score = Number(agent.current_score ?? 0)
          const available = Number(agent.available ?? 0)
          const allocated = Number(agent.total_allocated ?? 1)
          const budgetPct = allocated > 0 ? ((allocated - available) / allocated) * 100 : 0

          return (
            <Link
              key={String(agent.id)}
              href={`/dashboard/agents/${agent.id}`}
              className="block bg-white/[0.02] border border-white/[0.05] rounded-xl p-4
                         hover:border-white/[0.10] hover:bg-white/[0.04] transition-all group"
            >
              <div className="flex items-start justify-between gap-4">
                {/* Left: Agent info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <div className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[String(agent.status)] ?? 'bg-slate-500'}`} />
                    <span className="text-sm font-medium text-white truncate group-hover:text-emerald-400 transition-colors">
                      {String(agent.name)}
                    </span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border font-mono ${MODE_COLORS[String(agent.mode)] ?? ''}`}>
                      {String(agent.mode).toUpperCase()}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-slate-400">
                      {VERTICAL_LABELS[String(agent.vertical)] ?? agent.vertical}
                    </span>
                  </div>

                  <p className="text-xs text-slate-500 line-clamp-1 mb-3">
                    {String(agent.hypothesis)}
                  </p>

                  {/* Score bar */}
                  <div className="space-y-1">
                    <div className="flex justify-between items-center">
                      <span className="text-[10px] text-slate-600">PERFORMANCE</span>
                      <span className={`text-[10px] font-mono ${SCORE_COLOR(score)}`}>
                        {score.toFixed(1)}/100
                      </span>
                    </div>
                    <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${SCORE_BAR_COLOR(score)}`}
                        style={{ width: `${score}%` }}
                      />
                    </div>
                  </div>
                </div>

                {/* Right: Metrics */}
                <div className="flex-shrink-0 text-right space-y-3">
                  <div>
                    <div className="text-[10px] text-slate-600 uppercase tracking-wider">Revenue</div>
                    <div className="text-sm font-mono text-white">
                      €{Number(agent.last_revenue ?? 0).toFixed(0)}
                    </div>
                  </div>

                  <div>
                    <div className="text-[10px] text-slate-600 uppercase tracking-wider">Budget</div>
                    <div className="text-xs text-slate-400">
                      €{available.toFixed(0)} left
                    </div>
                    <div className="h-0.5 w-16 bg-white/5 rounded mt-1">
                      <div
                        className="h-full bg-amber-400/60 rounded"
                        style={{ width: `${Math.min(100, budgetPct)}%` }}
                      />
                    </div>
                  </div>

                  <div>
                    <div className={`text-[10px] uppercase tracking-wider ${
                      agent.last_run_status === 'completed' ? 'text-emerald-600' :
                      agent.last_run_status === 'failed' ? 'text-red-600' :
                      'text-slate-600'
                    }`}>
                      {String(agent.last_run_status ?? 'no runs')}
                    </div>
                  </div>
                </div>
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
