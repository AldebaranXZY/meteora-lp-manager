import { NextRequest, NextResponse } from "next/server";

// ─── Protección de las rutas que FIRMAN / mueven fondos ──────────────────────
// Estas rutas usan la hot wallet del server para firmar y mandar TX a partir de
// un body arbitrario. Sin esto, deployar la app sería un open relay para gastar
// la wallet. El matcher de abajo limita el middleware a esas rutas.
//
// Modo de operación:
//   • Si NO hay API_SECRET seteado → no bloquea (uso local single-user).
//   • Si HAY API_SECRET → exige header `Authorization: Bearer <API_SECRET>`.
//   • Rate-limit in-memory por IP en ambos casos (defensa básica anti-abuso).

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 30;

// Map por instancia. Suficiente para single-user / single-instance; si algún día
// se escala a varias instancias, mover a un store compartido (Redis, etc.).
const hits = new Map<string, { count: number; resetAt: number }>();

function rateLimited(ip: string, now: number): boolean {
  const entry = hits.get(ip);
  if (!entry || now > entry.resetAt) {
    hits.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_LIMIT_MAX;
}

export function middleware(request: NextRequest): NextResponse {
  // Date.now() está permitido en runtime de middleware (no es un workflow).
  const now = Date.now();
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";

  if (rateLimited(ip, now)) {
    return NextResponse.json(
      { error: "Rate limit excedido — esperá un momento." },
      { status: 429 }
    );
  }

  const secret = process.env.API_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json(
        { error: "No autorizado." },
        { status: 401 }
      );
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/api/swap/:path*",
    "/api/position/:path*",
    "/api/pool/:path*",
    "/api/damm/:path*",
  ],
};
