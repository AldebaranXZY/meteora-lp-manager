// ─── Sync del webhook de Helius con el set de wallets monitoreadas ───────────
// Un solo webhook por instalación, identificado por su webhookURL (el túnel).
// Helius reenvía el `authHeader` que seteamos → lo validamos en el receptor.

import { fetchResilient } from "./http";

const HELIUS_WEBHOOKS_API = "https://api.helius.xyz/v0/webhooks";

function apiKey(): string {
  const k = process.env.HELIUS_API_KEY;
  if (!k) throw new Error("HELIUS_API_KEY no configurada en .env.local");
  return k;
}

function webhookUrl(): string {
  const base = process.env.TRACKER_PUBLIC_URL;
  if (!base) throw new Error("TRACKER_PUBLIC_URL no configurada (poné la URL pública del túnel cloudflared)");
  return base.replace(/\/$/, "") + "/api/tracker/webhook";
}

interface ExistingWebhook { webhookID: string; webhookURL: string }

export interface SyncResult { webhookID: string; monitored: number; action: "created" | "updated" | "deleted" | "noop" }

export async function syncWebhook(addresses: string[]): Promise<SyncResult> {
  const url = webhookUrl();
  const key = apiKey();

  // Buscar webhook existente con nuestra URL.
  const listRes = await fetchResilient(`${HELIUS_WEBHOOKS_API}?api-key=${key}`, { label: "Helius webhook list" });
  const existing: ExistingWebhook[] = listRes.ok ? await listRes.json() : [];
  const match = existing.find((w) => w.webhookURL === url);

  // Helius no acepta lista vacía: si no hay wallets, borrar el webhook.
  if (addresses.length === 0) {
    if (match) {
      await fetchResilient(`${HELIUS_WEBHOOKS_API}/${match.webhookID}?api-key=${key}`, { method: "DELETE", label: "Helius webhook delete" });
      return { webhookID: match.webhookID, monitored: 0, action: "deleted" };
    }
    return { webhookID: "", monitored: 0, action: "noop" };
  }

  // Guard: registrar el webhook SIN secret lo deja abierto (el túnel es público
  // → cualquiera podría inyectar alertas falsas). Exigir secret antes de crear.
  const secret = process.env.TRACKER_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error("TRACKER_WEBHOOK_SECRET no configurada: sin secret el webhook queda abierto. Poné un valor fuerte en .env.local antes de monitorear.");
  }

  const body = JSON.stringify({
    webhookURL: url,
    transactionTypes: ["ANY"],
    accountAddresses: addresses,
    webhookType: "enhanced",
    authHeader: secret,
  });
  const headers = { "Content-Type": "application/json" };

  const res = match
    ? await fetchResilient(`${HELIUS_WEBHOOKS_API}/${match.webhookID}?api-key=${key}`, { method: "PUT", headers, body, label: "Helius webhook update" })
    : await fetchResilient(`${HELIUS_WEBHOOKS_API}?api-key=${key}`, { method: "POST", headers, body, label: "Helius webhook create" });

  if (!res.ok) throw new Error(`Helius webhook ${res.status}: ${await res.text().catch(() => "")}`);
  const data = await res.json();
  return {
    webhookID: data.webhookID ?? match?.webhookID ?? "",
    monitored: addresses.length,
    action: match ? "updated" : "created",
  };
}
