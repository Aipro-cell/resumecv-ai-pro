// netlify/functions/use-unit-credit.js
// Appelé après le premier téléchargement d'un CV par un utilisateur unitaire (2.99€)
// Marque le crédit comme consommé : plan → 'used'

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

    if (!supabaseServiceKey) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Configuration serveur manquante' })
      };
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Vérifier le token JWT pour obtenir l'user ID
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'Session invalide' })
      };
    }

    // Vérifier que le plan est bien 'unit' (pas déjà 'used' ou 'monthly')
    const { data: sub } = await supabase
      .from('subscribers')
      .select('plan')
      .eq('id', user.id)
      .single();

    if (!sub || sub.plan !== 'unit') {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Aucun crédit unitaire actif' })
      };
    }

    // Marquer le crédit comme consommé
    const { error: updateError } = await supabase
      .from('subscribers')
      .update({ plan: 'used' })
      .eq('id', user.id);

    if (updateError) {
      console.error('Erreur update plan:', updateError);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Erreur serveur' })
      };
    }

    console.log('Crédit unitaire consommé pour', user.id);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, message: 'Crédit unitaire consommé' })
    };

  } catch (err) {
    console.error('Erreur use-unit-credit:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Erreur serveur', message: err.message })
    };
  }
};
