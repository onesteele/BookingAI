// Supabase Edge Function: create-booking
// Creates a booking, assigns via round-robin, and creates Google Calendar event.
//
// Input:  { slug, start_time, customer_name, customer_email, notes? }
// Output: { booking, agent_name }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface BookingRequest {
  slug: string
  start_time: string
  customer_name: string
  customer_email: string
  notes?: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { slug, start_time, customer_name, customer_email, notes } =
      await req.json() as BookingRequest

    if (!slug || !start_time || !customer_name || !customer_email) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // 1. Resolve slug → link → event type
    const { data: link, error: linkErr } = await supabase
      .from('booking_links')
      .select('*, event_type:event_types(*)')
      .eq('slug', slug)
      .eq('is_active', true)
      .single()

    if (linkErr || !link) {
      return new Response(JSON.stringify({ error: 'Booking link not found or inactive' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const eventType = link.event_type as {
      id: string; name: string; duration_minutes: number; buffer_minutes: number; location: string | null
    }

    const slotStart = new Date(start_time)
    const slotEnd = new Date(slotStart.getTime() + eventType.duration_minutes * 60 * 1000)

    // 2. Get agents for this event type
    const { data: etAgents } = await supabase
      .from('event_type_agents')
      .select('agent_id')
      .eq('event_type_id', eventType.id)

    const agentIds = (etAgents ?? []).map((r: { agent_id: string }) => r.agent_id)

    if (agentIds.length === 0) {
      return new Response(JSON.stringify({ error: 'No agents configured for this event type' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 3. Get active agents with tokens
    const { data: agents } = await supabase
      .from('agents')
      .select('id, name, email, google_access_token, google_refresh_token, google_token_expiry, google_calendar_id')
      .in('id', agentIds)
      .eq('is_active', true)

    const activeAgents = (agents ?? []).filter((a: { google_refresh_token: string | null }) =>
      a.google_refresh_token !== null
    ) as {
      id: string; name: string; email: string
      google_access_token: string; google_refresh_token: string
      google_token_expiry: string | null; google_calendar_id: string
    }[]

    // 4. Check existing bookings at this exact slot to find already-booked agents
    const { data: existingBookings } = await supabase
      .from('bookings')
      .select('agent_id')
      .in('agent_id', agentIds)
      .eq('status', 'confirmed')
      .lt('start_time', slotEnd.toISOString())
      .gt('end_time', slotStart.toISOString())

    const bookedAgentIds = new Set((existingBookings ?? []).map((b: { agent_id: string }) => b.agent_id))

    // 5. Refresh tokens and check Google Calendar conflicts
    const availableAgents: typeof activeAgents = []

    for (const agent of activeAgents) {
      // Skip if already booked in our DB
      if (bookedAgentIds.has(agent.id)) continue

      // Refresh token if needed
      let accessToken = agent.google_access_token
      if (agent.google_token_expiry) {
        const expiry = new Date(agent.google_token_expiry)
        if (expiry < new Date(Date.now() + 5 * 60 * 1000)) {
          try {
            accessToken = await refreshGoogleToken(agent.id, agent.google_refresh_token, supabase)
          } catch {
            continue // Skip agent if we can't refresh token
          }
        }
      }

      // Check Google Calendar for conflicts
      const fbResp = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          timeMin: slotStart.toISOString(),
          timeMax: slotEnd.toISOString(),
          items: [{ id: agent.google_calendar_id }],
        }),
      })

      if (fbResp.ok) {
        const fbData = await fbResp.json() as {
          calendars: Record<string, { busy: { start: string; end: string }[] }>
        }
        const busy = fbData.calendars[agent.google_calendar_id]?.busy ?? []
        if (busy.length === 0) {
          availableAgents.push({ ...agent, google_access_token: accessToken })
        }
      }
    }

    if (availableAgents.length === 0) {
      return new Response(JSON.stringify({ error: 'No agents available at the selected time. Please choose another slot.' }), {
        status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 6. Round-robin: get the next agent in rotation
    const { data: rrState } = await supabase
      .from('round_robin_state')
      .select('last_agent_id')
      .eq('event_type_id', eventType.id)
      .single()

    const lastAgentId = rrState?.last_agent_id ?? null
    const assignedAgent = roundRobinSelect(availableAgents, lastAgentId)

    // 7. Insert booking record
    const { data: booking, error: bookingErr } = await supabase
      .from('bookings')
      .insert({
        event_type_id: eventType.id,
        agent_id: assignedAgent.id,
        booking_link_id: link.id,
        customer_name,
        customer_email,
        start_time: slotStart.toISOString(),
        end_time: slotEnd.toISOString(),
        notes: notes ?? null,
        status: 'confirmed',
      })
      .select()
      .single()

    if (bookingErr) {
      return new Response(JSON.stringify({ error: bookingErr.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 8. Create Google Calendar event
    let googleEventId: string | null = null
    try {
      const gcalEvent = await createGoogleCalendarEvent({
        accessToken: assignedAgent.google_access_token,
        calendarId: assignedAgent.google_calendar_id,
        summary: `${eventType.name} with ${customer_name}`,
        description: notes ?? '',
        location: eventType.location ?? '',
        start: slotStart.toISOString(),
        end: slotEnd.toISOString(),
        attendees: [
          { email: customer_email, displayName: customer_name },
          { email: assignedAgent.email, displayName: assignedAgent.name },
        ],
      })
      googleEventId = gcalEvent.id

      // Update booking with Google event ID
      await supabase
        .from('bookings')
        .update({ google_event_id: googleEventId })
        .eq('id', (booking as { id: string }).id)
    } catch (err) {
      console.error('Google Calendar event creation failed (booking still confirmed):', err)
    }

    // 9. Update round-robin state
    await supabase
      .from('round_robin_state')
      .upsert({
        event_type_id: eventType.id,
        last_agent_id: assignedAgent.id,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'event_type_id' })

    return new Response(
      JSON.stringify({
        booking: { ...booking, google_event_id: googleEventId },
        agent_name: assignedAgent.name,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('create-booking error:', err)
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})

// ─── Round-robin selection ────────────────────────────────────────────────────

function roundRobinSelect<T extends { id: string }>(agents: T[], lastAgentId: string | null): T {
  if (!lastAgentId) return agents[0]

  const lastIdx = agents.findIndex(a => a.id === lastAgentId)
  if (lastIdx === -1) return agents[0]

  // Return the agent after the last assigned one (circular)
  return agents[(lastIdx + 1) % agents.length]
}

// ─── Google Calendar event creation ──────────────────────────────────────────

async function createGoogleCalendarEvent(opts: {
  accessToken: string
  calendarId: string
  summary: string
  description: string
  location: string
  start: string
  end: string
  attendees: { email: string; displayName?: string }[]
}): Promise<{ id: string }> {
  const resp = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(opts.calendarId)}/events?sendNotifications=true`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${opts.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        summary: opts.summary,
        description: opts.description,
        location: opts.location,
        start: { dateTime: opts.start, timeZone: 'America/New_York' },
        end: { dateTime: opts.end, timeZone: 'America/New_York' },
        attendees: opts.attendees,
        reminders: {
          useDefault: false,
          overrides: [
            { method: 'email', minutes: 60 },
            { method: 'popup', minutes: 10 },
          ],
        },
      }),
    }
  )

  if (!resp.ok) {
    const body = await resp.text()
    throw new Error(`Google Calendar API error: ${resp.status} ${body}`)
  }

  return resp.json() as Promise<{ id: string }>
}

// ─── Token refresh helper ────────────────────────────────────────────────────

// deno-lint-ignore no-explicit-any
async function refreshGoogleToken(agentId: string, refreshToken: string, supabase: any): Promise<string> {
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: Deno.env.get('GOOGLE_CLIENT_ID')!,
      client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET')!,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })

  if (!resp.ok) throw new Error('Failed to refresh Google token')

  const data = await resp.json() as { access_token: string; expires_in: number }
  const expiry = new Date(Date.now() + data.expires_in * 1000)

  await supabase
    .from('agents')
    .update({ google_access_token: data.access_token, google_token_expiry: expiry.toISOString() })
    .eq('id', agentId)

  return data.access_token
}
