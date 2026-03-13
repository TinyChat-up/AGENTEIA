// ============================================================
// /api/telegram — Telegram webhook endpoint
// Receives updates from Telegram and processes commands
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { handleTelegramWebhook } from '@/lib/telegram/bot'

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-telegram-bot-api-secret-token')

  // Verify webhook secret
  if (process.env.TELEGRAM_WEBHOOK_SECRET && secret !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json()

  // Process async — respond immediately to Telegram
  handleTelegramWebhook(body).catch(err => {
    console.error('[Telegram webhook]', err)
  })

  return NextResponse.json({ ok: true })
}

// GET — setup instructions
export async function GET() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  return NextResponse.json({
    info: 'Telegram webhook endpoint',
    setup: `Set webhook with: curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=${appUrl}/api/telegram&secret_token=<WEBHOOK_SECRET>"`,
    status: process.env.TELEGRAM_BOT_TOKEN ? 'configured' : 'not configured',
  })
}
