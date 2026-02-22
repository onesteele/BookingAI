// Supabase Edge Function: google-auth-init
// Generates the Google OAuth URL for an agent to authorize calendar access.
// Requires: authenticated admin session
//
// Input:  { agent_id: string }
// Output: { url: string }

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const { agent_id } = await req.json() as { agent_id: string }

  if (!agent_id) {
    return new Response(JSON.stringify({ error: 'agent_id required' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const clientId = Deno.env.get('GOOGLE_CLIENT_ID')!
  const appBaseUrl = Deno.env.get('APP_BASE_URL')!  // e.g. https://username.github.io/calendlyclone
  const redirectUri = `${appBaseUrl}/auth/google-callback.html`

  const scopes = [
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/calendar.events',
  ].join(' ')

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: scopes,
    access_type: 'offline',
    prompt: 'consent',       // Force re-consent to get refresh_token
    state: agent_id,         // Pass agent_id through the OAuth flow
  })

  const url = `https://accounts.google.com/o/oauth2/v2/auth?${params}`

  return new Response(JSON.stringify({ url }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
