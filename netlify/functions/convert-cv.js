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

    const prompt = `Expert ATS. Analyse ce CV et reformate-le en version optimisée ATS.

CV brut :
---
${cvText.slice(0, 3000)}
---
${targetJob ? `Poste visé : ${targetJob}` : ''}
${jobOffer ? `Offre : ${jobOffer.slice(0, 500)}` : ''}

Réponds UNIQUEMENT en JSON valide :
{"atsScore":87,"atsDetails":{"keywords":{"score":85,"label":"Bon"},"format":{"score":92,"label":"Excellent"},"readability":{"score":88,"label":"Optimal"},"length":{"score":72,"label":"À ajuster"}},"suggestions":[{"icon":"💡","title":"Titre","text":"Conseil concret"},{"icon":"🔑","title":"Titre","text":"Conseil"},{"icon":"📊","title":"Titre","text":"Conseil"}],"name":"Prénom Nom","targetJob":"Poste","contact":"email · tel · ville","summary":"Résumé pro 2-3 phrases","experience":[{"title":"Poste","company":"Entreprise","period":"2020–2024","bullets":["Réalisation quantifiée","Responsabilité clé"]}],"skills":["comp1","comp2","comp3","comp4","comp5","comp6"],"education":"Diplôme, École, Année","keywords":["mot-clé1","mot-clé2","mot-clé3","mot-clé4","mot-clé5","mot-clé6"]}

Labels atsDetails : score>=80 "Excellent"/"Compatible"/"Optimal"/"Idéal", 60-79 "Bon"/"Acceptable"/"Correct"/"Acceptable", <60 "À améliorer"/"Problématique"/"À revoir"/"À ajuster". 3 suggestions concrètes basées sur le vrai CV.`;

    const message = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 2500,
      messages: [{ role: 'user', content: prompt }]
    });

    let raw = message.content[0].text;
    // Nettoyer les caractères de contrôle qui cassent JSON.parse
    raw = raw.replace(/[\x00-\x1F\x7F]/g, function(c) { return c === '\n' || c === '\r' || c === '\t' ? c : ''; });
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Réponse Claude invalide');

    let cvData;
    try {
      cvData = JSON.parse(jsonMatch[0]);
    } catch (parseErr) {
      console.error('JSON brut reçu:', jsonMatch[0].slice(0, 500));
      // Tentative de réparation : supprimer les virgules traînantes
      let fixed = jsonMatch[0].replace(/,\s*([\]}])/g, '$1');
      cvData = JSON.parse(fixed);
    }

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
