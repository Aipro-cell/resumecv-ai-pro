// netlify/functions/stripe-webhook.js
// Reçoit les événements Stripe et met à jour la table "subscribers" dans Supabase
// Pour que l'abonnement mensuel se synchronise automatiquement

const stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

exports.handler = async function(event) {
  const headers = {
    'Content-Type': 'application/json'
  };

  // Stripe envoie toujours en POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // ── Variables d'environnement requises ──
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const supabaseUrl = 'https://ltndkrqdxvglslyipvrg.supabase.co';
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!stripeSecretKey || !webhookSecret || !supabaseServiceKey) {
    console.error('Variables manquantes: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, ou SUPABASE_SERVICE_ROLE_KEY');
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Configuration serveur manquante' }) };
  }

  // ── Vérification signature Stripe ──
  let stripeEvent;
  try {
    const stripeClient = stripe(stripeSecretKey);
    const sig = event.headers['stripe-signature'];
    stripeEvent = stripeClient.webhooks.constructEvent(event.body, sig, webhookSecret);
  } catch (err) {
    console.error('Signature Stripe invalide:', err.message);
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Signature invalide' }) };
  }

  // ── Connexion Supabase (service role = accès admin) ──
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    switch (stripeEvent.type) {

      // ═══════════════════════════════════════════
      // 1. NOUVEAU PAIEMENT ABONNEMENT RÉUSSI
      // ═══════════════════════════════════════════
      case 'checkout.session.completed': {
        const session = stripeEvent.data.object;

        if (session.mode === 'subscription') {
          // client_reference_id = l'ID Supabase de l'utilisateur (passé depuis le frontend)
          const userId = session.client_reference_id;
          const customerEmail = session.customer_details?.email || session.customer_email;

          if (userId) {
            // Abonnement actif pour 1 mois
            const subscribedUntil = new Date();
            subscribedUntil.setMonth(subscribedUntil.getMonth() + 1);

            const { error } = await supabase.from('subscribers').upsert({
              id: userId,
              plan: 'monthly',
              subscribed_until: subscribedUntil.toISOString(),
              stripe_customer_id: session.customer,
              email: customerEmail
            });

            if (error) {
              console.error('Erreur upsert subscribers:', error);
            } else {
              console.log('Abonnement activé pour', userId, '→ jusqu\'au', subscribedUntil.toISOString());
            }
          } else {
            console.warn('checkout.session.completed sans client_reference_id — abonnement non lié');
          }
        }

        // Paiement unitaire (mode = 'payment') : enregistrer dans Supabase
        if (session.mode === 'payment') {
          const unitUserId = session.client_reference_id;
          const unitEmail = session.customer_details?.email || session.customer_email;

          if (unitUserId) {
            const { error } = await supabase.from('subscribers').upsert({
              id: unitUserId,
              plan: 'unit',
              stripe_customer_id: session.customer,
              email: unitEmail
            });

            if (error) {
              console.error('Erreur upsert paiement unitaire:', error);
            } else {
              console.log('Paiement unitaire enregistré pour', unitUserId);
            }
          } else {
            console.warn('checkout.session.completed (payment) sans client_reference_id');
          }
        }
        break;
      }

      // ═══════════════════════════════════════════
      // 2. RENOUVELLEMENT MENSUEL AUTOMATIQUE
      // ═══════════════════════════════════════════
      case 'invoice.paid': {
        const invoice = stripeEvent.data.object;

        // Ne traiter que les renouvellements (pas le premier paiement, déjà géré ci-dessus)
        if (invoice.billing_reason === 'subscription_cycle') {
          const customerId = invoice.customer;

          // Retrouver l'utilisateur via son stripe_customer_id
          const { data: subscriber, error: findErr } = await supabase
            .from('subscribers')
            .select('id')
            .eq('stripe_customer_id', customerId)
            .single();

          if (findErr || !subscriber) {
            console.warn('Renouvellement: abonné introuvable pour customer', customerId);
            break;
          }

          // Prolonger l'abonnement d'1 mois
          const subscribedUntil = new Date();
          subscribedUntil.setMonth(subscribedUntil.getMonth() + 1);

          await supabase.from('subscribers').update({
            plan: 'monthly',
            subscribed_until: subscribedUntil.toISOString()
          }).eq('id', subscriber.id);

          console.log('Renouvellement OK pour', subscriber.id, '→ jusqu\'au', subscribedUntil.toISOString());
        }
        break;
      }

      // ═══════════════════════════════════════════
      // 3. ABONNEMENT ANNULÉ
      // ═══════════════════════════════════════════
      case 'customer.subscription.deleted': {
        const subscription = stripeEvent.data.object;
        const customerId = subscription.customer;

        const { data: subscriber } = await supabase
          .from('subscribers')
          .select('id')
          .eq('stripe_customer_id', customerId)
          .single();

        if (subscriber) {
          await supabase.from('subscribers').update({
            plan: 'free'
          }).eq('id', subscriber.id);

          console.log('Abonnement annulé pour', subscriber.id);
        }
        break;
      }

      default:
        // Événement non géré — on l'ignore silencieusement
        console.log('Événement Stripe non géré:', stripeEvent.type);
    }
  } catch (err) {
    console.error('Erreur traitement webhook:', err);
    // On retourne 200 quand même pour que Stripe ne réessaye pas
    return { statusCode: 200, headers, body: JSON.stringify({ received: true, error: err.message }) };
  }

  return { statusCode: 200, headers, body: JSON.stringify({ received: true }) };
};
