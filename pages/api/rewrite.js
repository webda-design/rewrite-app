// pages/api/rewrite.js
// Vercel Serverless Function — APIキーはサーバー側のみ、ブラウザに露出しない

// ── レートリミット（簡易・インメモリ） ──────────────────────
const ipMap = new Map();
const WINDOW_MS = 15 * 60 * 1000; // 15分
const MAX_REQ   = 20;

function isRateLimited(ip) {
  const now = Date.now();
  const entry = ipMap.get(ip) || { count: 0, start: now };
  if (now - entry.start > WINDOW_MS) {
    ipMap.set(ip, { count: 1, start: now });
    return false;
  }
  if (entry.count >= MAX_REQ) return true;
  entry.count++;
  ipMap.set(ip, entry);
  return false;
}

// ── 入力バリデーション ────────────────────────────────────────
function validateText(text) {
  if (typeof text !== "string") return "textは文字列です";
  if (!text.trim())             return "テキストが空です";
  if (text.length > 5000)      return "テキストは5000文字以内にしてください";
  return null;
}

// ── ハンドラ ─────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  // レートリミット
  const ip = req.headers["x-forwarded-for"]?.split(",")[0] || "unknown";
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: "リクエストが多すぎます。しばらく待ってから再試行してください。" });
  }

  // 入力バリデーション
  const { text, constraints } = req.body || {};
  const err = validateText(text);
  if (err) return res.status(400).json({ error: err });

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY が未設定");
    return res.status(500).json({ error: "サーバー設定エラーです。管理者に連絡してください。" });
  }

  // 制約条件テキスト化
  const constraintText = Array.isArray(constraints) && constraints.length > 0
    ? constraints.map((c) => `【${c.label}】\n${c.rules.map((r) => `- ${r}`).join("\n")}`).join("\n\n")
    : "（制約条件なし）";

  const prompt = `あなたは日本語の文章編集の専門家です。以下の制約条件に従って、入力された文章を自然で読みやすい日本語にリライトしてください。

意味や情報量は変えずに、制約条件に違反している箇所を修正してください。

=== 制約条件 ===
${constraintText}

=== リライトのルール ===
- 元の文章の意味・情報量を変えない
- 制約条件に沿って不自然な表現を自然な表現に修正する
- リライト後の文章のみを出力し、説明や注釈は一切付けない
- 元の段落構造・改行を維持する

=== リライト対象の文章 ===
${text}`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-opus-4-5",
        max_tokens: 4096,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      console.error("Claude API error:", response.status, await response.text());
      return res.status(502).json({ error: "リライト処理に失敗しました。しばらく待ってから再試行してください。" });
    }

    const data = await response.json();
    const result = data.content?.map((b) => b.text || "").join("") || "";
    return res.status(200).json({ result });

  } catch (e) {
    console.error("rewrite error:", e.message);
    return res.status(500).json({ error: "サーバーエラーが発生しました。" });
  }
}
