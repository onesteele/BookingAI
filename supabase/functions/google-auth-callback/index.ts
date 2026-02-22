// Supabase Edge Function: google-auth-callback
// Exchanges the OAuth code for access/refresh tokens and stores them.
//
// Input:  { code: string, agent_id: string }
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
    const { code, agent_id } = await req.json() as { code: string; agent_id: string }

    if (!code || !agent_id) {
      return new Response(JSON.stringify({ error: 'code and agent_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const clientId = Deno.env.get('GOOGLE_CLIENT_ID')!
    const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET')!
    const appBaseUrl = Deno.env.get('APP_BASE_URL')!
    const redirectUri = `${appBaseUrl}/auth/google-callback.html`

    // Exchange code for tokens
    const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    })

    if (!tokenResp.ok) {
      const err = await tokenResp.text()
      return new Response(JSON.stringify({ error: `Token exchange failed: ${err}` }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const tokens = await tokenResp.json() as {
      access_token: string
      refresh_token: string
      expires_in: number
    }

    // Store tokens in the agents table
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const expiry = new Date(Date.now() + tokens.expires_in * 1000)

    const { error: updateErr } = await supabase
      .from('agents')
      .update({
        google_access_token: tokens.access_token,
        google_refresh_token: tokens.refresh_token,
        google_token_expiry: expiry.toISOString(),
      })
      .eq('id', agent_id)

    if (updateErr) {
      return new Response(JSON.stringify({ error: updateErr.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('google-auth-callback error:', err)
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
