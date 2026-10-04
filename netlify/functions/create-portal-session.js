// netlify/functions/create-portal-session.js
// Crée une session Stripe Customer Portal pour que le client gère son abonnement

const stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

exports.handler = async function(event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Méthode non autorisée' }) };
  }

  try {
    // Vérifier l'authentification
    const authHeader = event.headers.authorization || event.headers.Authorization || '';
    const token = authHeader.replace('Bearer ', '');

    if (!token) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'Non authentifié' })
      };
    }

    const supabaseUrl = process.env.SUPABASE_URL || 'https://ltndkrqdxvglslyipvrg.supabase.co';
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;

    if (!supabaseServiceKey || !stripeSecretKey) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Configuration serveur manquante' })
      };
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Vérifier le token JWT
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'Session invalide' })
      };
    }

    // Récupérer le stripe_customer_id
    const { data: sub } = await supabase
      .from('subscribers')
      .select('stripe_customer_id')
      .eq('id', user.id)
      .single();

    if (!sub || !sub.stripe_customer_id) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Aucun abonnement trouvé' })
      };
    }

    // Créer la session du portail client Stripe
    const stripeClient = stripe(stripeSecretKey);
    const portalSession = await stripeClient.billingPortal.sessions.create({
      customer: sub.stripe_customer_id,
      return_url: 'https://resumecvaipro.netlify.app'
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ url: portalSession.url })
    };

  } catch (err) {
    console.error('Erreur create-portal-session:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Erreur serveur', message: err.message })
    };
  }
};
