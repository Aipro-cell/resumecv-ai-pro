// netlify/functions/generate-cover-letter.js
// Génère une lettre de motivation adaptée à l'offre d'emploi — réservé aux abonnés mensuels

const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');

exports.handler = async function(event, context) {
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
    // ── VÉRIFICATION ABONNEMENT ──
    const authHeader = event.headers.authorization || event.headers.Authorization || '';
    const token = authHeader.replace('Bearer ', '');

    if (!token) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'Non authentifié', message: 'Connectez-vous pour utiliser cette fonctionnalité.' })
      };
    }

    const supabaseUrl = process.env.SUPABASE_URL || 'https://ltndkrqdxvglslyipvrg.supabase.co';
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseServiceKey) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Configuration serveur manquante (SUPABASE_SERVICE_ROLE_KEY)' })
      };
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Vérifier le token JWT pour obtenir l'user ID
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'Session invalide', message: 'Reconnectez-vous.' })
      };
    }

    // Vérifier l'abonnement dans la table subscribers
    const { data: sub } = await supabase
      .from('subscribers')
      .select('plan, subscribed_until')
      .eq('id', user.id)
      .single();

    const now = new Date();
    const until = sub && sub.subscribed_until ? new Date(sub.subscribed_until) : null;
    const isMonthly = sub && sub.plan === 'monthly' && until && until > now;

    if (!isMonthly) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({
          error: 'Abonnement requis',
          message: 'La lettre de motivation est réservée aux abonnés mensuels (7,99€/mois).'
        })
      };
    }

    // ── DONNÉES CV + OFFRE ──
    const body = JSON.parse(event.body);
    const { cvText, jobOffer, targetJob, userName } = body;

    if (!cvText || cvText.trim().length < 30) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'CV manquant', message: 'Générez d\'abord votre CV avant de demander une lettre de motivation.' })
      };
    }

    if (!jobOffer || jobOffer.trim().length < 20) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Offre manquante', message: 'Collez l\'offre d\'emploi pour générer une lettre adaptée.' })
      };
    }

    // ── APPEL CLAUDE ──
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Clé API manquante' })
      };
    }

    const client = new Anthropic({ apiKey });

    const prompt = `Tu es un expert en rédaction de lettres de motivation professionnelles en français.

Voici les informations du candidat extraites de son CV :
---
${cvText.slice(0, 4000)}
---

${userName ? `Nom du candidat : ${userName}` : ''}
${targetJob ? `Poste visé : ${targetJob}` : ''}

Voici l'offre d'emploi à laquelle le candidat postule :
---
${jobOffer.slice(0, 2000)}
---

Rédige une lettre de motivation professionnelle et percutante qui :
1. S'adresse directement à l'entreprise mentionnée dans l'offre (ou "Madame, Monsieur" si non précisé)
2. Accroche dès la première phrase avec une référence précise à l'offre
3. Met en valeur 2-3 expériences/compétences du CV qui correspondent EXACTEMENT aux besoins de l'offre
4. Montre la motivation du candidat avec des arguments concrets et personnalisés
5. Conclut par une demande d'entretien naturelle et confiante
6. Fait environ 250-350 mots (1 page)
7. Utilise un ton professionnel mais naturel, pas robotique
8. NE PAS inventer des informations qui ne sont pas dans le CV

Réponds UNIQUEMENT avec un JSON valide :
{
  "companyName": "Nom de l'entreprise (extrait de l'offre ou 'l\\'entreprise')",
  "jobTitle": "Intitulé exact du poste dans l'offre",
  "coverLetter": "Le texte complet de la lettre de motivation avec des \\n pour les sauts de ligne",
  "keyMatches": ["Compétence/expérience 1 qui matche l'offre", "Compétence 2", "Compétence 3"]
}`;

    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }]
    });

    const raw = message.content[0].text;
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Réponse Claude invalide');

    const letterData = JSON.parse(jsonMatch[0]);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, letter: letterData })
    };

  } catch (err) {
    console.error('Erreur generate-cover-letter:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Erreur serveur', message: err.message })
    };
  }
};
