import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// GET - List all ignored event IDs
export async function GET() {
  try {
    const { data, error } = await supabase
      .from('ignored_event_ids')
      .select('*')
      .order('ignored_at', { ascending: false })
    
    if (error) {
      console.error('Error fetching ignored event IDs:', error)
      return NextResponse.json({ error: 'Failed to fetch ignored event IDs' }, { status: 500 })
    }
    
    return NextResponse.json(data || [])
  } catch (error: unknown) {
    console.error('Error in ignored-event-ids GET:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: 'Internal server error', details: message }, { status: 500 })
  }
}

// POST - Add a new ignored event ID
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { event_id, subject, start_time, reason } = body
    
    if (!event_id) {
      return NextResponse.json({ error: 'event_id is required' }, { status: 400 })
    }
    
    const { error } = await supabase
      .from('ignored_event_ids')
      .upsert({
        event_id,
        subject: subject || '',
        start_time: start_time || '',
        reason: reason || 'User ignored',
        ignored_at: new Date().toISOString()
      })
    
    if (error) {
      console.error('Error adding ignored event ID:', error)
      return NextResponse.json({ error: 'Failed to add ignored event ID' }, { status: 500 })
    }
    
    return NextResponse.json({ success: true })
  } catch (error: unknown) {
    console.error('Error in ignored-event-ids POST:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: 'Internal server error', details: message }, { status: 500 })
  }
}

// DELETE - Remove an ignored event ID
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const event_id = searchParams.get('event_id')
    
    if (!event_id) {
      return NextResponse.json({ error: 'event_id is required' }, { status: 400 })
    }
    
    const { error } = await supabase
      .from('ignored_event_ids')
      .delete()
      .eq('event_id', event_id)
    
    if (error) {
      console.error('Error removing ignored event ID:', error)
      return NextResponse.json({ error: 'Failed to remove ignored event ID' }, { status: 500 })
    }
    
    return NextResponse.json({ success: true })
  } catch (error: unknown) {
    console.error('Error in ignored-event-ids DELETE:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: 'Internal server error', details: message }, { status: 500 })
  }
}
