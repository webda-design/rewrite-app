// middleware.js — Vercel Edge Middleware でBasic認証を全ページに適用
import { NextResponse } from "next/server";

export function middleware(req) {
  const basicUser = process.env.BASIC_AUTH_USER;
  const basicPass = process.env.BASIC_AUTH_PASS;

  // 環境変数が未設定の場合は認証スキップ（開発環境用）
  if (!basicUser || !basicPass) return NextResponse.next();

  const authHeader = req.headers.get("authorization");

  if (authHeader) {
    const base64 = authHeader.replace("Basic ", "");
    const decoded = Buffer.from(base64, "base64").toString("utf-8");
    const [user, pass] = decoded.split(":");
    if (user === basicUser && pass === basicPass) {
      return NextResponse.next();
    }
  }

  // 認証失敗 → ブラウザにダイアログを表示
  return new NextResponse("認証が必要です", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="StrangeBrain Rewrite APP"',
    },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
