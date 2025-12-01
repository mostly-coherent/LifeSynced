import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// GET - List all ignored base IDs
export async function GET() {
  try {
    const { data, error } = await supabase
      .from('ignored_base_ids')
      .select('*')
      .order('ignored_at', { ascending: false })
    
    if (error) {
      console.error('Error fetching ignored base IDs:', error)
      return NextResponse.json({ error: 'Failed to fetch ignored base IDs' }, { status: 500 })
    }
    
    return NextResponse.json(data || [])
  } catch (error: unknown) {
    console.error('Error in ignored-base-ids GET:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: 'Internal server error', details: message }, { status: 500 })
  }
}

// POST - Add a new ignored base ID
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { base_id, subject, reason } = body
    
    if (!base_id) {
      return NextResponse.json({ error: 'base_id is required' }, { status: 400 })
    }
    
    const { error } = await supabase
      .from('ignored_base_ids')
      .upsert({
        base_id,
        subject: subject || '',
        reason: reason || 'User ignored',
        ignored_at: new Date().toISOString()
      })
    
    if (error) {
      console.error('Error adding ignored base ID:', error)
      return NextResponse.json({ error: 'Failed to add ignored base ID' }, { status: 500 })
    }
    
    return NextResponse.json({ success: true })
  } catch (error: unknown) {
    console.error('Error in ignored-base-ids POST:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: 'Internal server error', details: message }, { status: 500 })
  }
}

// DELETE - Remove an ignored base ID
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const base_id = searchParams.get('base_id')
    
    if (!base_id) {
      return NextResponse.json({ error: 'base_id is required' }, { status: 400 })
    }
    
    const { error } = await supabase
      .from('ignored_base_ids')
      .delete()
      .eq('base_id', base_id)
    
    if (error) {
      console.error('Error removing ignored base ID:', error)
      return NextResponse.json({ error: 'Failed to remove ignored base ID' }, { status: 500 })
    }
    
    return NextResponse.json({ success: true })
  } catch (error: unknown) {
    console.error('Error in ignored-base-ids DELETE:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: 'Internal server error', details: message }, { status: 500 })
  }
}
