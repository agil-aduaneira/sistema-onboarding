const { createRemoteJWKSet, jwtVerify } = require("jose");

const PROJECT_ID = "sistema-onboarding";
const JWKS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/robot/v1/metadata/jwk/securetoken@system.gserviceaccount.com")
);

// Verifica o token de login do Firebase Auth sem precisar de service account —
// valida a assinatura contra as chaves públicas do Google e confere
// issuer/audience do projeto.
async function verificarLogin(authHeader) {
  const token = authHeader && authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) throw new Error("Não autenticado.");
  const { payload } = await jwtVerify(token, JWKS, {
    issuer: `https://securetoken.google.com/${PROJECT_ID}`,
    audience: PROJECT_ID,
  });
  if (!payload.sub) throw new Error("Token inválido.");
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");

  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "Método não permitido." }); return; }

  try {
    await verificarLogin(req.headers.authorization);
  } catch {
    res.status(401).json({ error: "Sessão inválida ou expirada." });
    return;
  }

  const { base64 } = req.body || {};
  if (!base64) { res.status(400).json({ error: "PDF (base64) ausente na requisição." }); return; }

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 300,
        messages: [{
          role: "user",
          content: [
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } },
            { type: "text", text: `Analise esta procuração e extraia SOMENTE as datas.
Responda APENAS com JSON puro (sem markdown, sem explicação):
{"outorga":"YYYY-MM-DD ou null","validade":"YYYY-MM-DD ou null","razao_social":"nome da empresa outorgante ou null"}
- outorga: data de assinatura/lavratura
- validade: prazo final de vigência (pode ser "válida por X anos" — calcule a data final)
- razao_social: empresa que OUTORGA os poderes` },
          ],
        }],
      }),
    });

    const data = await r.json();
    if (!r.ok) {
      res.status(r.status).json({ error: data.error?.message || "Erro na API da Anthropic." });
      return;
    }
    res.status(200).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
