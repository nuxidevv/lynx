export default async function handler(req, res) {
  // Autoriser les requêtes
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Key');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const apiKey = process.env.LYNX_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ ok: false, error: "Clé introuvable." });
  }

  // Récupérer les paramètres de recherche
  const payload = req.method === 'GET' ? req.query : req.body;
  
  // Nettoyer les paramètres (enlever les vides)
  const cleanPayload = {};
  Object.keys(payload || {}).forEach(key => {
    if (payload[key] && String(payload[key]).trim() !== "") {
      cleanPayload[key] = String(payload[key]).trim();
    }
  });

  console.log("➡️ Envoi :", cleanPayload);

  try {
    // Appel de l'API avec fetch (natif)
    const response = await fetch("https://brixhub.ru/api/v1/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiKey
      },
      body: JSON.stringify(cleanPayload)
    });

    const data = await response.json();
    
    console.log("⬅️ Réponse :", response.status, data);

    if (!response.ok) {
      return res.status(response.status).json({ 
        ok: false, 
        error: `Erreur (${response.status}) : ${data.message || 'Refusé'}`,
        details: data
      });
    }

    // Succès !
    return res.status(200).json({ ok: true, data: data });

  } catch (error) {
    console.log("💥 Crash :", error.message);
    return res.status(500).json({ ok: false, error: `Erreur serveur : ${error.message}` });
  }
}
