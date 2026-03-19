// ============================================================
// Unfreeze all non-mother agents — reset status to active
// Usage: node scripts/unfreeze-agents.js
// ============================================================

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function unfreezeAgents() {
  const { data, error } = await supabase
    .from('agents')
    .update({
      status: 'active',
      consecutive_failures: 0,
      last_report_at: new Date().toISOString(),
    })
    .neq('type', 'mother')
    .select('name, type, status, stage')

  if (error) {
    console.error('❌ Error unfreezing agents:', error.message)
    process.exit(1)
  }

  if (!data || data.length === 0) {
    console.log('⚠️  No non-mother agents found to unfreeze.')
    return
  }

  console.log(`✅ ${data.length} agent(s) unfrozen:\n`)
  for (const agent of data) {
    console.log(`  → ${agent.name} (${agent.type}) | stage: ${agent.stage} | status: ${agent.status}`)
  }
}

unfreezeAgents()
