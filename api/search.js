import https from "https";

const BRIXHUB_URL = "https://api.brixhub.ru/api/v1/search";

const BLOCKED_TARGETS = [];

function normalizeName(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isBlocked(fullName) {
  if (!BLOCKED_TARGETS.length) return false;
  const norm = normalizeName(fullName);
  if (!norm) return false;
  const tokens = norm.split(" ").filter(t => t.length > 0);
  return BLOCKED_TARGETS.some(t => {
    const hasPrenomComplet = tokens.includes(t.prenom);
    const hasNomComplet = tokens.includes(t.nom);
    if (hasPrenomComplet && hasNomComplet) return true;
    if (tokens.some(tok => tok.length >= 2 && t.prenom.startsWith(tok)) && hasNomComplet) return true;
    if (hasPrenomComplet && tokens.some(tok => tok.length >= 3 && t.nom.startsWith(tok))) return true;
    return false;
  });
}

function httpsPost(url, headers, bodyObj) {
  return new Promise((resolve) => {
    try {
      const body = JSON.stringify(bodyObj);
      const u = new URL(url);
      const options = {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body)
        }
      };
      const req = https.request(options, (res) => {
        let data = "";
        res.on("data", c => data += c);
        res.on("end", () => resolve({ status: res.statusCode, body: data }));
      });
      req.on("error", (e) => resolve({ status: 0, body: "", error: e.message }));
      req.setTimeout(12000, () => {
        req.destroy();
        resolve({ status: 0, body: "", error: "timeout" });
      });
      req.write(body);
      req.end();
    } catch (e) {
      resolve({ status: 0, body: "", error: "httpsPost: " + e.message });
    }
  });
}

function emptyResponse(a, b) {
  return {
    data: [],
    message: "ok",
    meta: { total: 0, page: 1, per_page: 10, query: { prenom: a, nom_famille: b } }
  };
}

async function tryBrixhub(payload) {
  try {
    const r = await httpsPost(BRIXHUB_URL, { Accept: "application/json" }, payload);
    let parsed = null;
    try { parsed = JSON.parse(r.body); } catch { parsed = r.body; }
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      error: r.error || null,
      data: parsed
    };
  } catch (e) {
    return { ok: false, status: 0, error: e.message, data: null };
  }
}

function countResults(data) {
  if (!data || typeof data !== "object") return 0;
  for (const k of ["results","data","items","records","hits","matches","persons","people"]) {
    if (Array.isArray(data[k])) return data[k].length;
  }
  if (Array.isArray(data)) return data.length;
  if (data.meta && typeof data.meta.total === "number") return data.meta.total;
  return 0;
}

function respond(res, result) {
  return res.status(200).json({
    ok: result.ok,
    status: result.status,
    error: result.error || null,
    data: result.data
  });
}

function mergeFilters(payload, filters) {
  const merged = { ...payload };
  Object.keys(filters).forEach(k => {
    const v = filters[k];
    if (v != null && String(v).trim() !== "") merged[k] = String(v).trim();
  });
  return merged;
}

export default async function handler(req, res) {
  // CORS toujours en premier
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  try {
    const q = req.query || {};

    const {
      first_name = "", last_name = "", email = "", telephone = "",
      ville = "", code_postal = "", departement = "", pays = "",
      adresse = "", adresse_ip = "", discord_id = "", iban = "", bic = "",
      annee_naissance = "", genre = "", _confidence = ""
    } = q;

    const filters = {
      ville, code_postal, departement, pays, adresse, adresse_ip,
      discord_id, iban, bic, annee_naissance, genre, _confidence
    };

    // Recherche par email
    if (String(email).trim()) {
      const r = await tryBrixhub(mergeFilters({ email: String(email).trim() }, filters));
      return respond(res, r);
    }

    // Recherche par téléphone
    if (String(telephone).trim()) {
      const cleanPhone = String(telephone).replace(/[\s.\-()]/g, "").trim();
      const r = await tryBrixhub(mergeFilters({ telephone: cleanPhone }, filters));
      return respond(res, r);
    }

    const a = String(first_name).trim();
    const b = String(last_name).trim();
    const fullQuery = [a, b].filter(Boolean).join(" ").trim();
    const hasFilters = Object.values(filters).some(v => String(v).trim() !== "");

    if (fullQuery.length < 2 && !hasFilters) {
      return res.status(200).json(emptyResponse(a, b));
    }

    if (fullQuery.length >= 2 && isBlocked(fullQuery)) {
      return res.status(200).json(emptyResponse(a, b));
    }

    if (a && b) {
      const first = await tryBrixhub(mergeFilters({ prenom: a, nom_famille: b }, filters));
      if (first.ok && countResults(first.data) > 0) return respond(res, first);

      const second = await tryBrixhub(mergeFilters({ prenom: b, nom_famille: a }, filters));
      if (second.ok && countResults(second.data) > 0) return respond(res, second);

      return respond(res, second || first);
    }

    if (a) {
      return respond(res, await tryBrixhub(mergeFilters({ prenom: a }, filters)));
    }
    if (b) {
      return respond(res, await tryBrixhub(mergeFilters({ prenom: b }, filters)));
    }
    if (hasFilters) {
      return respond(res, await tryBrixhub(mergeFilters({}, filters)));
    }

    return res.status(200).json(emptyResponse(a, b));

  } catch (err) {
    // On ne renvoie JAMAIS un 500 brut — toujours du JSON propre
    console.error("[lynx/search] Fatal error:", err);
    return res.status(200).json({
      ok: false,
      status: 500,
      error: "internal: " + (err && err.message ? err.message : "unknown"),
      data: null
    });
  }
}
