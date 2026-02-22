// Supabase Edge Function: get-availability
// Returns available time slots for a given booking link slug and date.
//
// Input:  { slug: string, date: string (YYYY-MM-DD), timezone: string }
// Output: { slots: TimeSlot[], event_type: EventType, booking_link: BookingLink }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { slug, date, timezone = 'America/New_York' } = await req.json() as {
      slug: string
      date: string
      timezone?: string
    }

    if (!slug || !date) {
      return new Response(JSON.stringify({ error: 'slug and date are required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // 1. Resolve slug → booking link → event type
    const { data: link, error: linkErr } = await supabase
      .from('booking_links')
      .select('*, event_type:event_types(*)')
      .eq('slug', slug)
      .eq('is_active', true)
      .single()

    if (linkErr || !link) {
      return new Response(JSON.stringify({ error: 'Booking link not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const eventType = link.event_type as {
      id: string; duration_minutes: number; buffer_minutes: number; is_active: boolean
    }

    if (!eventType.is_active) {
      return new Response(JSON.stringify({ slots: [], event_type: eventType, booking_link: link }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 2. Get agents assigned to this event type
    const { data: etAgents } = await supabase
      .from('event_type_agents')
      .select('agent_id')
      .eq('event_type_id', eventType.id)

    const agentIds = (etAgents ?? []).map((r: { agent_id: string }) => r.agent_id)

    if (agentIds.length === 0) {
      return new Response(JSON.stringify({ slots: [], event_type: eventType, booking_link: link }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 3. Get active agents with their tokens
    const { data: agents } = await supabase
      .from('agents')
      .select('id, google_access_token, google_refresh_token, google_token_expiry, google_calendar_id')
      .in('id', agentIds)
      .eq('is_active', true)

    const activeAgents = (agents ?? []).filter((a: { google_refresh_token: string | null }) =>
      a.google_refresh_token !== null
    )

    if (activeAgents.length === 0) {
      return new Response(JSON.stringify({ slots: [], event_type: eventType, booking_link: link }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 4. Determine the day of week for the requested date
    const requestedDate = new Date(`${date}T00:00:00`)
    const dayOfWeek = requestedDate.getDay()

    // 5. Get availability schedules for this day
    const { data: schedules } = await supabase
      .from('availability')
      .select('*')
      .in('agent_id', agentIds)
      .eq('day_of_week', dayOfWeek)

    if (!schedules || schedules.length === 0) {
      return new Response(JSON.stringify({ slots: [], event_type: eventType, booking_link: link }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 6. Build the master list of possible slots from schedule(s)
    // Use the union of all agent schedules that day as the slot window
    // (Find earliest start, latest end across all agents scheduled that day)
    type Schedule = { agent_id: string; start_time: string; end_time: string; timezone: string }
    const scheduleMap = new Map<string, Schedule>()
    for (const s of schedules as Schedule[]) {
      scheduleMap.set(s.agent_id, s)
    }

    // Generate candidate slots (using the first scheduled agent's window as reference)
    const firstSchedule = schedules[0] as Schedule
    const [startH, startM] = firstSchedule.start_time.split(':').map(Number)
    const [endH, endM] = firstSchedule.end_time.split(':').map(Number)
    const schedTZ = firstSchedule.timezone || 'America/New_York'

    const slotDuration = eventType.duration_minutes
    const bufferMinutes = eventType.buffer_minutes

    // Build slot start times properly converted from schedule timezone to UTC
    const slotStarts: Date[] = []
    const windowStart = dateInTZ(date, `${String(startH).padStart(2,'0')}:${String(startM).padStart(2,'0')}:00`, schedTZ)
    const windowEnd   = dateInTZ(date, `${String(endH).padStart(2,'0')}:${String(endM).padStart(2,'0')}:00`, schedTZ)

    const stepMs = (slotDuration + bufferMinutes) * 60 * 1000
    const slotMs = slotDuration * 60 * 1000
    const now = new Date()

    let cursor = new Date(windowStart)
    while (cursor.getTime() + slotMs <= windowEnd.getTime()) {
      // Skip slots in the past
      if (cursor > now) {
        slotStarts.push(new Date(cursor))
      }
      cursor = new Date(cursor.getTime() + stepMs)
    }

    if (slotStarts.length === 0) {
      return new Response(JSON.stringify({ slots: [], event_type: eventType, booking_link: link }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 7. Check Google Calendar free/busy for all agents in one batch
    const timeMin = windowStart.toISOString()
    const timeMax = windowEnd.toISOString()

    // Refresh tokens if needed and get fresh access tokens
    const accessTokens = new Map<string, string>()

    for (const agent of activeAgents as {
      id: string
      google_access_token: string
      google_refresh_token: string
      google_token_expiry: string | null
      google_calendar_id: string
    }[]) {
      let accessToken = agent.google_access_token

      // Check if token is expired or will expire soon (within 5 min)
      if (agent.google_token_expiry) {
        const expiry = new Date(agent.google_token_expiry)
        const fiveMinFromNow = new Date(Date.now() + 5 * 60 * 1000)
        if (expiry < fiveMinFromNow) {
          // Refresh the token
          accessToken = await refreshGoogleToken(agent.id, agent.google_refresh_token, supabase)
        }
      }

      if (accessToken) accessTokens.set(agent.id, accessToken)
    }

    // Build freebusy request items
    const calendarItems = activeAgents
      .filter((a: { id: string }) => accessTokens.has(a.id))
      .map((a: { id: string; google_calendar_id: string }) => ({ id: a.google_calendar_id }))

    // Use the first agent's token to call freebusy (it's a multi-calendar query)
    // Actually we need per-agent calls if they have different accounts
    // Map agent id → busy periods
    const busyByAgent = new Map<string, { start: string; end: string }[]>()

    for (const agent of activeAgents as {
      id: string
      google_calendar_id: string
    }[]) {
      const token = accessTokens.get(agent.id)
      if (!token) continue

      const fbResp = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          timeMin,
          timeMax,
          items: [{ id: agent.google_calendar_id }],
        }),
      })

      if (!fbResp.ok) continue

      const fbData = await fbResp.json() as {
        calendars: Record<string, { busy: { start: string; end: string }[] }>
      }
      const calBusy = fbData.calendars[agent.google_calendar_id]?.busy ?? []
      busyByAgent.set(agent.id, calBusy)
    }

    // 8. Get existing bookings for this date (from our DB)
    const dayStart = dateInTZ(date, '00:00:00', schedTZ)
    const dayEnd   = dateInTZ(date, '23:59:59', schedTZ)

    const { data: existingBookings } = await supabase
      .from('bookings')
      .select('agent_id, start_time, end_time')
      .in('agent_id', agentIds)
      .eq('status', 'confirmed')
      .gte('start_time', dayStart.toISOString())
      .lte('start_time', dayEnd.toISOString())

    // 9. For each slot, count how many agents are free
    function isAgentFree(
      agentId: string,
      slotStart: Date,
      slotEnd: Date,
      schedule: Schedule | undefined,
      busyPeriods: { start: string; end: string }[],
      bookings: { agent_id: string; start_time: string; end_time: string }[],
    ): boolean {
      // Check schedule
      if (!schedule) return false

      const [sh, sm] = schedule.start_time.split(':').map(Number)
      const [eh, em] = schedule.end_time.split(':').map(Number)
      const tz = schedule.timezone || 'America/New_York'
      // Get the date in the schedule's timezone (the slot is already a correct UTC timestamp)
      const slotDateStr = new Intl.DateTimeFormat('sv-SE', { timeZone: tz }).format(slotStart)
      const schedStart = dateInTZ(slotDateStr, `${String(sh).padStart(2,'0')}:${String(sm).padStart(2,'0')}:00`, tz)
      const schedEnd   = dateInTZ(slotDateStr, `${String(eh).padStart(2,'0')}:${String(em).padStart(2,'0')}:00`, tz)

      if (slotStart < schedStart || slotEnd > schedEnd) return false

      // Check Google Calendar busy periods
      for (const busy of busyPeriods) {
        const busyStart = new Date(busy.start)
        const busyEnd = new Date(busy.end)
        if (slotStart < busyEnd && slotEnd > busyStart) return false
      }

      // Check existing DB bookings (already assigned)
      for (const b of bookings) {
        if (b.agent_id !== agentId) continue
        const bStart = new Date(b.start_time)
        const bEnd = new Date(b.end_time)
        if (slotStart < bEnd && slotEnd > bStart) return false
      }

      return true
    }

    const slots = slotStarts.map(slotStart => {
      const slotEnd = new Date(slotStart.getTime() + slotMs)

      let spotsLeft = 0
      for (const agent of activeAgents as { id: string }[]) {
        const agentSchedule = scheduleMap.get(agent.id)
        const busy = busyByAgent.get(agent.id) ?? []
        const bookings = (existingBookings ?? []) as { agent_id: string; start_time: string; end_time: string }[]

        if (isAgentFree(agent.id, slotStart, slotEnd, agentSchedule, busy, bookings)) {
          spotsLeft++
        }
      }

      return {
        start: slotStart.toISOString(),
        end: slotEnd.toISOString(),
        spots_left: spotsLeft,
      }
    })

    return new Response(
      JSON.stringify({ slots, event_type: eventType, booking_link: link }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('get-availability error:', err)
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})

// ─── Timezone-aware date construction ────────────────────────────────────────
// Returns a UTC Date representing dateStr + timeStr in the given IANA timezone.
// e.g. dateInTZ('2024-01-15', '09:00:00', 'America/New_York') → 2024-01-15T14:00:00Z
function dateInTZ(dateStr: string, timeStr: string, tz: string): Date {
  const naiveUTC = new Date(`${dateStr}T${timeStr}Z`)
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(naiveUTC)
  const get = (type: string) => parseInt(parts.find(p => p.type === type)!.value)
  const [dY, dM, dD] = dateStr.split('-').map(Number)
  const [tH, tMm, tS] = timeStr.split(':').map(Number)
  const gotMs  = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  const wantMs = Date.UTC(dY, dM - 1, dD, tH, tMm, tS || 0)
  return new Date(naiveUTC.getTime() + (wantMs - gotMs))
}

// ─── Token refresh helper ────────────────────────────────────────────────────

async function refreshGoogleToken(
  agentId: string,
  refreshToken: string,
  // deno-lint-ignore no-explicit-any
  supabase: any,
): Promise<string> {
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
