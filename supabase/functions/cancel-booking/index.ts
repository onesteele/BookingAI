// Supabase Edge Function: cancel-booking
// Cancels a booking and deletes the Google Calendar event.
// Requires: authenticated admin session
//
// Input:  { booking_id: string }
// Output: { success: true }

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
    const { booking_id } = await req.json() as { booking_id: string }

    if (!booking_id) {
      return new Response(JSON.stringify({ error: 'booking_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Fetch the booking + agent info
    const { data: booking, error: fetchErr } = await supabase
      .from('bookings')
      .select('*, agent:agents(google_access_token, google_refresh_token, google_token_expiry, google_calendar_id)')
      .eq('id', booking_id)
      .single()

    if (fetchErr || !booking) {
      return new Response(JSON.stringify({ error: 'Booking not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if ((booking as { status: string }).status === 'cancelled') {
      return new Response(JSON.stringify({ error: 'Booking already cancelled' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const typedBooking = booking as {
      id: string
      google_event_id: string | null
      agent: {
        google_access_token: string
        google_refresh_token: string
        google_token_expiry: string | null
        google_calendar_id: string
      } | null
    }

    // Delete Google Calendar event if it exists
    if (typedBooking.google_event_id && typedBooking.agent) {
      const agent = typedBooking.agent
      let accessToken = agent.google_access_token

      // Refresh token if needed
      if (agent.google_token_expiry) {
        const expiry = new Date(agent.google_token_expiry)
        if (expiry < new Date(Date.now() + 5 * 60 * 1000)) {
          try {
            const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams({
                client_id: Deno.env.get('GOOGLE_CLIENT_ID')!,
                client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET')!,
                refresh_token: agent.google_refresh_token,
                grant_type: 'refresh_token',
              }),
            })
            if (tokenResp.ok) {
              const tokenData = await tokenResp.json() as { access_token: string }
              accessToken = tokenData.access_token
            }
          } catch {
            // Proceed anyway; booking will still be marked cancelled
          }
        }
      }

      // Delete the event (send cancellation notification to attendees)
      await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(agent.google_calendar_id)}/events/${typedBooking.google_event_id}?sendNotifications=true`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      ).catch(err => console.error('Failed to delete GCal event:', err))
    }

    // Mark booking as cancelled in DB
    const { error: cancelErr } = await supabase
      .from('bookings')
      .update({ status: 'cancelled' })
      .eq('id', booking_id)

    if (cancelErr) {
      return new Response(JSON.stringify({ error: cancelErr.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('cancel-booking error:', err)
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
