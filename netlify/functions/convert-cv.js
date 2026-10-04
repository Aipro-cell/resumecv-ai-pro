// netlify/functions/convert-cv.js
// Cette fonction reçoit un PDF en base64, extrait le texte, puis appelle Claude pour le convertir en ATS

const pdfParse = require('pdf-parse');
const Anthropic = require('@anthropic-ai/sdk');

exports.handler = async function(event, context) {
  // CORS headers — autorise ton domaine Netlify
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  // Preflight CORS
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Méthode non autorisée' }) };
  }

  try {
    const body = JSON.parse(event.body);
    const { fileBase64, fileType, targetJob, jobOffer, manualText } = body;

    // ── ÉTAPE 1 : EXTRACTION DU TEXTE ──
    let cvText = '';

    if (manualText && manualText.trim().length > 50) {
      // Texte collé manuellement
      cvText = manualText.trim();

    } else if (fileBase64 && fileType === 'application/pdf') {
      // Extraction PDF
      const pdfBuffer = Buffer.from(fileBase64, 'base64');
      const pdfData = await pdfParse(pdfBuffer);
      cvText = pdfData.text;

      if (!cvText || cvText.trim().length < 50) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            error: 'PDF illisible',
            message: 'Ce PDF semble scanné ou protégé. Colle le texte de ton CV manuellement.'
          })
        };
      }

    } else if (fileBase64) {
      // DOCX ou TXT — on décode directement
      cvText = Buffer.from(fileBase64, 'base64').toString('utf-8');

    } else {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Aucun fichier reçu' })
      };
    }

    // ── ÉTAPE 2 : APPEL CLAUDE ──
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Clé API manquante — configure ANTHROPIC_API_KEY dans Netlify' })
      };
    }

    const client = new Anthropic({ apiKey });

    const prompt = `Tu es un expert en optimisation de CV pour les systèmes ATS (Applicant Tracking Systems) utilisés par les recruteurs RH.

Voici le contenu brut extrait d'un CV :
---
${cvText.slice(0, 4000)}
---
${targetJob ? `Poste visé par l'utilisateur : ${targetJob}` : ''}
${jobOffer ? `Offre d'emploi cible : ${jobOffer.slice(0, 800)}` : ''}

Ton travail : analyser ce CV, extraire toutes les informations, et le reformater entièrement en version optimisée ATS.

Règles ATS obligatoires :
- Structure simple : pas de tableaux ni colonnes multiples
- Résumé professionnel percutant en introduction (2-3 phrases)
- Expériences en ordre chronologique inverse avec bullet points quantifiés
- Mots-clés du secteur naturellement intégrés
- Section compétences claire et lisible

Réponds UNIQUEMENT avec un JSON valide, sans texte avant ou après :
{
  "atsScore": 87,
  "name": "Prénom Nom extrait du CV",
  "targetJob": "Titre du poste extrait ou visé",
  "contact": "email · téléphone · ville extraits",
  "summary": "Résumé professionnel optimisé ATS, 2-3 phrases percutantes basées sur le vrai parcours",
  "experience": [
    {
      "title": "Titre exact du poste",
      "company": "Nom de l'entreprise",
      "period": "2020 – 2024",
      "bullets": [
        "Accomplissement concret quantifié (chiffres réels du CV)",
        "Responsabilité clé avec impact mesurable",
        "Projet ou initiative avec résultat"
      ]
    }
  ],
  "skills": ["compétence1", "compétence2", "compétence3", "compétence4", "compétence5", "compétence6"],
  "education": "Diplôme, École, Année",
  "keywords": ["mot-clé ATS 1", "mot-clé ATS 2", "mot-clé ATS 3", "mot-clé ATS 4", "mot-clé ATS 5", "mot-clé ATS 6", "mot-clé ATS 7", "mot-clé ATS 8"]
}`;

    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }]
    });

    const raw = message.content[0].text;
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Réponse Claude invalide');

    const cvData = JSON.parse(jsonMatch[0]);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, cv: cvData, extractedText: cvText.slice(0, 200) + '…' })
    };

  } catch (err) {
    console.error('Erreur convert-cv:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Erreur serveur', message: err.message })
    };
  }
};
