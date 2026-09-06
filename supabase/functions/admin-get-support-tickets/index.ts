import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

interface RequestBody {
  adminId: string;
  statusFilter?: 'Open' | 'In Progress' | 'On Hold' | 'Waiting For More Details' | 'Resolved' | 'Closed';
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { adminId, statusFilter }: RequestBody = await req.json();

    if (!adminId) {
      return new Response(
        JSON.stringify({ error: 'Admin ID is required' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const { data: adminUser, error: adminError } = await supabase
      .from('admin_users')
      .select('id, is_active')
      .eq('id', adminId)
      .maybeSingle();

    if (adminError || !adminUser) {
      return new Response(
        JSON.stringify({ error: 'Invalid admin user' }),
        {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    if (!adminUser.is_active) {
      return new Response(
        JSON.stringify({ error: 'Admin account is disabled' }),
        {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    let query = supabase
      .from('support_tickets')
      .select(`
        id,
        ticket_number,
        user_id,
        category,
        sub_category,
        description,
        status,
        priority,
        created_at,
        updated_at,
        last_reply_at,
        users!support_tickets_user_id_fkey (
          email,
          first_name,
          last_name,
          mobile_number
        )
      `)
      .order('created_at', { ascending: false });

    if (statusFilter) {
      query = query.eq('status', statusFilter);
    }

    const { data: tickets, error: ticketsError } = await query;

    if (ticketsError) {
      console.error('Error fetching tickets:', ticketsError);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch tickets' }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const ticketsWithCounts = await Promise.all(
      (tickets || []).map(async (ticket: any) => {
        const { count } = await supabase
          .from('support_ticket_replies')
          .select('*', { count: 'exact', head: true })
          .eq('ticket_id', ticket.id);

        const userFirstName = ticket.users?.first_name || '';
        const userLastName = ticket.users?.last_name || '';
        const userFullName = `${userFirstName} ${userLastName}`.trim();

        return {
          ticket_id: ticket.id,
          ticket_number: ticket.ticket_number,
          user_id: ticket.user_id,
          user_email: ticket.users?.email || '',
          user_name: userFullName || 'Unknown User',
          user_mobile: ticket.users?.mobile_number || '',
          category: ticket.category,
          sub_category: ticket.sub_category,
          description: ticket.description,
          status: ticket.status,
          priority: ticket.priority,
          created_at: ticket.created_at,
          updated_at: ticket.updated_at,
          last_reply_at: ticket.last_reply_at,
          reply_count: count || 0,
        };
      })
    );

    return new Response(
      JSON.stringify({ tickets: ticketsWithCounts }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Error in admin-get-support-tickets:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});


// redeploy
