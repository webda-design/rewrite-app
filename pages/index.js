import { useState, useEffect, useRef } from "react";
import { supabase } from "../lib/supabase";

// ── デフォルト制約条件 ────────────────────────────────────────
const DEFAULT_CONSTRAINTS = [
  {
    id: 1, category: "tone", label: "文体・トンマナ", icon: "✦",
    rules: [
      "読者に語りかけるような自然な口語体で書く",
      "一文は60文字以内を目安にする",
      "難しい漢字や専門用語は使わず、中学生でも理解できる言葉を選ぶ",
      "体言止めを適度に使い、テンポよく読めるようにする",
    ],
  },
  {
    id: 2, category: "banned_words", label: "禁止ワード", icon: "✕",
    rules: ["非常に", "極めて", "大変", "〜となっております", "〜させていただきます", "〜の方", "ご利用いただけます"],
  },
  {
    id: 3, category: "banned_expressions", label: "禁止表現", icon: "⊘",
    rules: [
      "「〜することが可能です」→「〜できます」と言い換える",
      "受け身表現を多用しない（〜される、〜られる）",
      "二重否定を使わない（〜でないわけではない）",
      "「〜という」を多用しない",
      "カタカナ語の連発を避ける",
    ],
  },
];

const CAT_COLORS = {
  tone:               { bg: "#F0F4FF", accent: "#3B5BF6", light: "#E8EEFF" },
  banned_words:       { bg: "#FFF0F0", accent: "#E63946", light: "#FFE8E8" },
  banned_expressions: { bg: "#FFF8E6", accent: "#E8A020", light: "#FFF2D0" },
};
const fallback = { bg: "#F4F4F8", accent: "#6B7280", light: "#EBEBF0" };
const col = (cat) => CAT_COLORS[cat] || fallback;

// ── HTMLかどうか簡易判定 ──────────────────────────────────────
function looksLikeHtml(text) {
  return /<(h[1-6]|p|ul|ol|li|strong|em|br|div|span|a|table|thead|tbody|tr|th|td)[^>]*>/i.test(text);
}

// ── scriptタグのみ除去 ────────────────────────────────────────
function sanitizeHtml(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, "");
}

// ── contentEditableからHTML取得 ───────────────────────────────
function getInnerHtml(el) {
  if (!el) return "";
  return el.innerHTML || "";
}

// ── contentEditableのHTML→送信用テキスト変換 ─────────────────
function htmlToSendText(html) {
  // そのままHTMLとして送信（looksLikeHtmlで判定）
  return html;
}

// ════════════════════════════════════════════════════════════════
export default function Home() {
  const [tab, setTab]               = useState("rewrite");
  const [outputText, setOutputText] = useState("");
  const [isLoading, setIsLoading]   = useState(false);
  const [copied, setCopied]         = useState(false);
  const [constraints, setConstraints] = useState(DEFAULT_CONSTRAINTS);
  const [inputMode,  setInputMode]  = useState("text");
  const [outputMode, setOutputMode] = useState("rendered");
  const [charCount,  setCharCount]  = useState(0);

  // 入力エリアのref（contentEditable）
  const inputRef = useRef(null);

  // 制約条件フォーム
  const [addingRuleTo,    setAddingRuleTo]    = useState(null);
  const [newRuleText,     setNewRuleText]     = useState("");
  const [editingRule,     setEditingRule]     = useState(null);
  const [editingRuleText, setEditingRuleText] = useState("");
  const [addingCategory,  setAddingCategory]  = useState(false);
  const [newCat,          setNewCat]          = useState({ label: "", icon: "◆" });

  // Supabase同期
  const [syncStatus, setSyncStatus] = useState("loading");
  const [lastSynced, setLastSynced] = useState(null);
  const [showBanner, setShowBanner] = useState(false);
  const syncTimer   = useRef(null);
  const isFirstLoad = useRef(true);
  const RECORD_ID   = 1;

  // ── 貼り付け処理：リッチテキストをそのまま受け入れ ──────────
  function handlePaste(e) {
    e.preventDefault();
    const clipboardData = e.clipboardData;

    // HTMLが含まれていればHTMLとして貼り付け
    const htmlData = clipboardData.getData("text/html");
    const textData = clipboardData.getData("text/plain");

    if (htmlData && htmlData.trim()) {
      const clean = sanitizeHtml(htmlData);
      document.execCommand("insertHTML", false, clean);
    } else {
      // プレーンテキストは改行をbrに変換して挿入
      const escaped = textData.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\n/g,"<br>");
      document.execCommand("insertHTML", false, escaped);
    }

    // モード自動検出
    const currentHtml = getInnerHtml(inputRef.current);
    setInputMode(looksLikeHtml(currentHtml) ? "html" : "text");
    updateCharCount(currentHtml);
  }

  function handleInput() {
    const currentHtml = getInnerHtml(inputRef.current);
    setInputMode(looksLikeHtml(currentHtml) ? "html" : "text");
    updateCharCount(currentHtml);
  }

  function updateCharCount(html) {
    // タグを除いた文字数をカウント
    const text = html.replace(/<[^>]*>/g, "");
    setCharCount(text.length);
  }

  function clearInput() {
    if (inputRef.current) {
      inputRef.current.innerHTML = "";
      setInputMode("text");
      setCharCount(0);
    }
  }

  // ── Supabase: 読み込み ────────────────────────────────────
  async function loadConstraints() {
    setSyncStatus("loading");
    try {
      const { data, error } = await supabase
        .from("constraints")
        .select("data")
        .eq("id", RECORD_ID)
        .single();

      if (error && error.code === "PGRST116") {
        await supabase.from("constraints").insert({ id: RECORD_ID, data: DEFAULT_CONSTRAINTS });
        setConstraints(DEFAULT_CONSTRAINTS);
      } else if (error) {
        throw error;
      } else {
        setConstraints(data.data);
      }
      setLastSynced(new Date());
      setSyncStatus("saved");
    } catch (e) {
      console.error("load error:", e.message);
      setSyncStatus("error");
    } finally {
      isFirstLoad.current = false;
    }
  }

  function scheduleSave(newData) {
    if (syncTimer.current) clearTimeout(syncTimer.current);
    setSyncStatus("saving");
    syncTimer.current = setTimeout(async () => {
      try {
        const { error } = await supabase
          .from("constraints")
          .upsert({ id: RECORD_ID, data: newData });
        if (error) throw error;
        setLastSynced(new Date());
        setSyncStatus("saved");
        flashBanner();
      } catch (e) {
        console.error("save error:", e.message);
        setSyncStatus("error");
      }
    }, 800);
  }

  function updateConstraints(fn) {
    setConstraints((prev) => {
      const next = fn(prev);
      if (!isFirstLoad.current) scheduleSave(next);
      return next;
    });
  }

  useEffect(() => { loadConstraints(); }, []);

  useEffect(() => {
    const iv = setInterval(async () => {
      if (syncStatus === "saving") return;
      try {
        const { data } = await supabase
          .from("constraints")
          .select("data")
          .eq("id", RECORD_ID)
          .single();
        if (data && JSON.stringify(data.data) !== JSON.stringify(constraints)) {
          isFirstLoad.current = true;
          setConstraints(data.data);
          setLastSynced(new Date());
          flashBanner();
          setTimeout(() => { isFirstLoad.current = false; }, 100);
        }
      } catch (_) {}
    }, 30000);
    return () => clearInterval(iv);
  }, [constraints, syncStatus]);

  function flashBanner() {
    setShowBanner(true);
    setTimeout(() => setShowBanner(false), 2500);
  }

  // ── リライト実行 ──────────────────────────────────────────
  async function handleRewrite() {
    const inputHtml = getInnerHtml(inputRef.current);
    if (!inputHtml.trim() || isLoading) return;
    setIsLoading(true);
    setOutputText("");
    try {
      const isHtml = looksLikeHtml(inputHtml);
      const res = await fetch("/api/rewrite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: inputHtml, constraints, mode: isHtml ? "html" : "text" }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setOutputText(json.result);
      if (isHtml) setOutputMode("rendered");
      else setOutputMode("rendered");
    } catch (e) {
      setOutputText("エラーが発生しました: " + e.message);
    } finally {
      setIsLoading(false);
    }
  }

  // ── コピー ────────────────────────────────────────────────
  function handleCopy() {
    if (!outputText) return;
    navigator.clipboard.writeText(outputText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // ── CRUD ─────────────────────────────────────────────────
  const deleteRule = (cId, rIdx) =>
    updateConstraints((prev) => prev.map((c) =>
      c.id === cId ? { ...c, rules: c.rules.filter((_, i) => i !== rIdx) } : c
    ));

  const addRule = (cId) => {
    if (!newRuleText.trim()) return;
    updateConstraints((prev) => prev.map((c) =>
      c.id === cId ? { ...c, rules: [...c.rules, newRuleText.trim()] } : c
    ));
    setNewRuleText(""); setAddingRuleTo(null);
  };

  const saveEditRule = (cId, rIdx) => {
    if (!editingRuleText.trim()) return;
    updateConstraints((prev) => prev.map((c) =>
      c.id === cId ? { ...c, rules: c.rules.map((r, i) => i === rIdx ? editingRuleText.trim() : r) } : c
    ));
    setEditingRule(null); setEditingRuleText("");
  };

  const addCategory = () => {
    if (!newCat.label.trim()) return;
    updateConstraints((prev) => [...prev, {
      id: Date.now(), category: `custom_${Date.now()}`,
      label: newCat.label, icon: newCat.icon, rules: [],
    }]);
    setNewCat({ label: "", icon: "◆" }); setAddingCategory(false);
  };

  const deleteCategory = (id) =>
    updateConstraints((prev) => prev.filter((c) => c.id !== id));

  const syncInfo = {
    loading: { dot: "#E8A020", shadow: "#FEF3C7", text: "読み込み中...",  textColor: "#E8A020" },
    saving:  { dot: "#E8A020", shadow: "#FEF3C7", text: "保存中...",      textColor: "#E8A020" },
    saved:   { dot: "#059669", shadow: "#D1FAE5", text: lastSynced ? `✓ ${lastSynced.getHours()}:${String(lastSynced.getMinutes()).padStart(2,"0")} 同期済み` : "✓ 同期済み", textColor: "#059669" },
    error:   { dot: "#E63946", shadow: "#FEE2E2", text: "⚠ 同期エラー",  textColor: "#E63946" },
  };
  const si = syncInfo[syncStatus] || syncInfo.saved;

  const modeLabel = inputMode === "html"
    ? { icon: "🏷️", text: "HTMLモード", color: "#7C3AED", bg: "#F5F0FF" }
    : { icon: "📝", text: "テキストモード", color: "#059669", bg: "#F0FFF4" };

  const hasInput = charCount > 0;

  // ════════════════════════════════════════════════════════════════
  return (
    <div style={{ minHeight: "100vh", background: "#F0F2F7" }}>
      <style>{`
        @keyframes bounce { 0%,80%,100%{transform:translateY(0);opacity:.4} 40%{transform:translateY(-8px);opacity:1} }
        @keyframes fadeIn  { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
        @keyframes slideDown { from{opacity:0;transform:translateY(-8px)} to{opacity:1;transform:translateY(0)} }
        * { box-sizing:border-box; -webkit-font-smoothing:antialiased; }
        button { cursor:pointer; transition:opacity .15s; font-family:inherit; }
        button:hover { opacity:.82; }
        button:disabled { cursor:not-allowed; opacity:.45; }
        textarea { font-family:inherit; resize:vertical; }
        input { font-family:inherit; }

        /* 入力エリア（contentEditable） */
        .input-editable {
          width:100%; min-height:420px; outline:none;
          padding:18px 20px; font-size:15px; line-height:1.9;
          color:#1A1A2E; background:transparent;
          font-family:inherit;
        }
        .input-editable:empty:before {
          content: attr(data-placeholder);
          color:#C4C4CC; pointer-events:none;
          white-space:pre-line;
        }
        /* 入力エリア内のHTML構造スタイル */
        .input-editable h1{font-size:1.5em;font-weight:800;margin:.5em 0 .3em;line-height:1.3}
        .input-editable h2{font-size:1.3em;font-weight:700;margin:.5em 0 .3em;line-height:1.3}
        .input-editable h3{font-size:1.1em;font-weight:700;margin:.4em 0 .25em}
        .input-editable h4,.input-editable h5,.input-editable h6{font-size:1em;font-weight:700;margin:.3em 0 .2em}
        .input-editable p{margin:.35em 0;line-height:1.9}
        .input-editable ul{padding-left:1.4em;margin:.35em 0}
        .input-editable ol{padding-left:1.4em;margin:.35em 0}
        .input-editable li{margin:.2em 0;line-height:1.8}
        .input-editable strong{font-weight:700}
        .input-editable em{font-style:italic}
        .input-editable table{border-collapse:collapse;width:100%;margin:.4em 0}
        .input-editable th,.input-editable td{border:1px solid #ddd;padding:6px 10px;font-size:.9em}
        .input-editable th{background:#f5f5f8;font-weight:700}

        /* 出力エリア内のHTML構造スタイル */
        .html-preview h1{font-size:1.5em;font-weight:800;margin:.5em 0 .3em;line-height:1.3}
        .html-preview h2{font-size:1.3em;font-weight:700;margin:.5em 0 .3em;line-height:1.3}
        .html-preview h3{font-size:1.1em;font-weight:700;margin:.4em 0 .25em}
        .html-preview h4,.html-preview h5,.html-preview h6{font-size:1em;font-weight:700;margin:.3em 0 .2em}
        .html-preview p{margin:.35em 0;line-height:1.9}
        .html-preview ul{padding-left:1.4em;margin:.35em 0}
        .html-preview ol{padding-left:1.4em;margin:.35em 0}
        .html-preview li{margin:.2em 0;line-height:1.8}
        .html-preview strong{font-weight:700}
        .html-preview em{font-style:italic}
        .html-preview a{color:#3B5BF6}
        .html-preview table{border-collapse:collapse;width:100%;margin:.4em 0}
        .html-preview th,.html-preview td{border:1px solid #ddd;padding:6px 10px;font-size:.9em}
        .html-preview th{background:#f5f5f8;font-weight:700}

        /* テキスト出力の改行 */
        .text-output { white-space: pre-wrap; }

        @media(max-width:768px){
          .split{grid-template-columns:1fr !important}
          .logo-title{display:none !important}
          .main{padding:12px 12px 80px !important}
          .head-actions{flex-direction:column;gap:10px}
          .status-row{flex-direction:column;align-items:flex-start !important;gap:6px}
        }
      `}</style>

      {/* ── ヘッダー ── */}
      <header style={{ background:"rgba(255,255,255,0.95)", backdropFilter:"blur(20px)", borderBottom:"1px solid #E5E7EB", position:"sticky", top:0, zIndex:100 }}>
        <div style={{ maxWidth:1400, margin:"0 auto", display:"flex", alignItems:"center", justifyContent:"space-between", height:60, padding:"0 28px" }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <div style={{ width:34, height:34, borderRadius:10, background:"linear-gradient(135deg,#1A1A2E 0%,#3B5BF6 100%)", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
              <span style={{ color:"white", fontSize:12, fontWeight:800 }}>SB</span>
            </div>
            <span className="logo-title" style={{ fontSize:14, fontWeight:700, color:"#1A1A2E", letterSpacing:"-.02em" }}>
              ストレンジブレイン文章リライトAPP
            </span>
          </div>
          <div style={{ display:"flex", gap:4, background:"#F3F4F6", borderRadius:12, padding:4 }}>
            {[{id:"rewrite",label:"リライト"},{id:"constraints",label:"制約条件"}].map((t) => (
              <button key={t.id} onClick={() => setTab(t.id)}
                style={{ padding:"7px 20px", borderRadius:9, border:"none", fontSize:13, fontWeight:700,
                  background: tab===t.id ? "white" : "transparent",
                  color:      tab===t.id ? "#1A1A2E" : "#6B7280",
                  boxShadow:  tab===t.id ? "0 1px 4px rgba(0,0,0,.1)" : "none",
                }}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* ── 同期バナー ── */}
      {showBanner && (
        <div style={{ background:"#1A1A2E", color:"white", textAlign:"center", fontSize:12, fontWeight:600, padding:"9px", animation:"slideDown .3s ease" }}>
          ✓ 制約条件をチームと同期しました
        </div>
      )}

      {/* ── ステータスバー ── */}
      <div style={{ background:"white", borderBottom:"1px solid #F0F0F4" }}>
        <div className="status-row" style={{ maxWidth:1400, margin:"0 auto", padding:"9px 28px", display:"flex", alignItems:"center", justifyContent:"space-between", gap:12, flexWrap:"wrap" }}>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <div style={{ width:7, height:7, borderRadius:"50%", background:si.dot, boxShadow:`0 0 0 2px ${si.shadow}`, transition:"all .3s" }} />
            <span style={{ fontSize:12, fontWeight:600, color:"#6B7280" }}>Supabase チーム共有中</span>
            <span style={{ fontSize:11, color:"#C4C4CC" }}>制約条件の変更は全員に自動反映</span>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <span style={{ fontSize:11, fontWeight:600, color:si.textColor }}>{si.text}</span>
            <button onClick={loadConstraints}
              style={{ padding:"3px 10px", borderRadius:6, border:"1px solid #E5E5EA", background:"white", fontSize:11, color:"#6B7280", fontWeight:600 }}>
              今すぐ更新
            </button>
          </div>
        </div>
      </div>

      {/* ── メイン ── */}
      <main className="main" style={{ maxWidth:1400, margin:"0 auto", padding:"24px 28px 80px" }}>

        {/* ════ リライトタブ ════ */}
        {tab === "rewrite" && (
          <div style={{ animation:"fadeIn .3s ease" }}>

            {/* 上部バー：制約バッジ + モードバッジ */}
            <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:16, flexWrap:"wrap" }}>
              {constraints.map((c) => {
                const { bg, accent } = col(c.category);
                return (
                  <span key={c.id} style={{ display:"inline-flex", alignItems:"center", gap:4, padding:"5px 12px", borderRadius:20, background:bg, color:accent, fontSize:12, fontWeight:600 }}>
                    {c.icon} {c.label} <span style={{ opacity:.55, fontWeight:400 }}>{c.rules.length}</span>
                  </span>
                );
              })}
              <span style={{ display:"inline-flex", alignItems:"center", gap:5, padding:"5px 13px", borderRadius:20, background:modeLabel.bg, color:modeLabel.color, fontSize:12, fontWeight:700, marginLeft:4 }}>
                {modeLabel.icon} {modeLabel.text}（自動検出）
              </span>
            </div>

            {/* 2カラム */}
            <div className="split" style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>

              {/* ── 入力パネル ── */}
              <div style={{ background:"white", borderRadius:18, border:"1.5px solid #E5E7EB", overflow:"hidden", boxShadow:"0 2px 8px rgba(0,0,0,.05)", display:"flex", flexDirection:"column" }}>
                <div style={{ padding:"15px 20px 12px", borderBottom:"1px solid #F3F4F6", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                  <span style={{ fontSize:14, fontWeight:700, color:"#1A1A2E" }}>入力テキスト</span>
                  <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                    <span style={{ fontSize:12, color:"#9CA3AF" }}>{charCount.toLocaleString()}文字</span>
                    {charCount > 0 && (
                      <button onClick={clearInput}
                        style={{ padding:"3px 10px", borderRadius:6, border:"1px solid #E5E5EA", background:"white", fontSize:11, color:"#9CA3AF", fontWeight:600 }}>
                        クリア
                      </button>
                    )}
                  </div>
                </div>
                <div
                  ref={inputRef}
                  className="input-editable"
                  contentEditable
                  suppressContentEditableWarning
                  onPaste={handlePaste}
                  onInput={handleInput}
                  data-placeholder={"テキストまたはHTMLを貼り付けてください\n\nWordPressからコピーしたリッチテキスト・HTMLも構造を維持したまま貼り付けられます"}
                  style={{ flex:1 }}
                />
              </div>

              {/* ── 出力パネル ── */}
              <div style={{ background:"white", borderRadius:18, border:"1.5px solid #E5E7EB", overflow:"hidden", boxShadow:"0 2px 8px rgba(0,0,0,.05)", display:"flex", flexDirection:"column" }}>
                <div style={{ padding:"15px 20px 12px", borderBottom:"1px solid #F3F4F6", display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:8 }}>
                  <span style={{ fontSize:14, fontWeight:700, color:"#1A1A2E" }}>リライト結果</span>
                  <div style={{ display:"flex", gap:6, alignItems:"center" }}>
                    {outputText && looksLikeHtml(outputText) && (
                      <div style={{ display:"flex", gap:2, background:"#F3F4F6", borderRadius:8, padding:3 }}>
                        {[{id:"rendered",label:"プレビュー"},{id:"source",label:"ソース"}].map((m) => (
                          <button key={m.id} onClick={() => setOutputMode(m.id)}
                            style={{ padding:"4px 11px", borderRadius:6, border:"none", fontSize:11, fontWeight:700,
                              background: outputMode===m.id ? "white" : "transparent",
                              color:      outputMode===m.id ? "#1A1A2E" : "#9CA3AF",
                              boxShadow:  outputMode===m.id ? "0 1px 3px rgba(0,0,0,.08)" : "none",
                            }}>
                            {m.label}
                          </button>
                        ))}
                      </div>
                    )}
                    {outputText && (
                      <button onClick={handleCopy}
                        style={{ display:"flex", alignItems:"center", gap:5, padding:"6px 14px", borderRadius:8, border:"none", fontSize:12, fontWeight:700,
                          background: copied ? "#ECFDF5" : "#F0F4FF",
                          color:      copied ? "#059669" : "#3B5BF6",
                        }}>
                        {copied ? "✓ コピー完了" : looksLikeHtml(outputText) ? "HTMLをコピー" : "コピー"}
                      </button>
                    )}
                  </div>
                </div>

                <div style={{ flex:1, minHeight:420, padding:"18px 20px", fontSize:15, lineHeight:1.9, overflowY:"auto" }}>
                  {isLoading ? (
                    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", height:360, gap:16 }}>
                      <div style={{ display:"flex", gap:7 }}>
                        {[0,1,2].map((i) => <div key={i} style={{ width:10, height:10, borderRadius:"50%", background:"#3B5BF6", animation:"bounce 1.2s infinite", animationDelay:`${i*.2}s` }} />)}
                      </div>
                      <span style={{ fontSize:14, color:"#9CA3AF" }}>リライト中...</span>
                    </div>
                  ) : outputText ? (
                    looksLikeHtml(outputText) && outputMode === "rendered"
                      ? <div className="html-preview" dangerouslySetInnerHTML={{ __html: sanitizeHtml(outputText) }} />
                      : looksLikeHtml(outputText) && outputMode === "source"
                        ? <pre style={{ fontFamily:"monospace", fontSize:12, whiteSpace:"pre-wrap", margin:0, color:"#374151" }}>{outputText}</pre>
                        : <div className="text-output" style={{ color:"#1A1A2E" }}>{outputText}</div>
                  ) : (
                    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", height:360, gap:10, color:"#D1D5DB" }}>
                      <span style={{ fontSize:36 }}>✦</span>
                      <span style={{ fontSize:14 }}>リライト結果がここに表示されます</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* HTMLモード用ヒント */}
            {inputMode === "html" && (
              <div style={{ marginTop:12, padding:"11px 18px", borderRadius:12, background:"#F5F0FF", border:"1px solid #E8DEFF", display:"flex", gap:9, alignItems:"flex-start" }}>
                <span style={{ fontSize:17, flexShrink:0 }}>💡</span>
                <div>
                  <span style={{ fontSize:13, fontWeight:700, color:"#7C3AED" }}>HTMLモード検出中</span>
                  <span style={{ fontSize:13, color:"#6B7280", marginLeft:8 }}>
                    HTMLタグ構造を維持してリライトします。リライト後「HTMLをコピー」→ WordPressに貼り付け可能です。
                  </span>
                </div>
              </div>
            )}

            <div style={{ display:"flex", justifyContent:"center", marginTop:24 }}>
              <button onClick={handleRewrite} disabled={isLoading || !hasInput}
                style={{ padding:"16px 72px", borderRadius:16, border:"none", fontSize:16, fontWeight:800,
                  background: !isLoading && hasInput ? "linear-gradient(135deg,#1A1A2E 0%,#3B5BF6 100%)" : "#E5E7EB",
                  color:      !isLoading && hasInput ? "white" : "#9CA3AF",
                  boxShadow:  !isLoading && hasInput ? "0 8px 28px rgba(59,91,246,.35)" : "none",
                  letterSpacing: "-.01em",
                }}>
                {isLoading ? "リライト中..." : "リライトする"}
              </button>
            </div>
          </div>
        )}

        {/* ════ 制約条件タブ ════ */}
        {tab === "constraints" && (
          <div style={{ animation:"fadeIn .3s ease" }}>
            <div className="head-actions" style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:22 }}>
              <div>
                <h2 style={{ fontSize:20, fontWeight:800, color:"#1A1A2E" }}>制約条件の管理</h2>
                <p style={{ marginTop:5, fontSize:13, color:"#9CA3AF" }}>変更は自動的にチーム全員に同期されます（Supabase）</p>
              </div>
              <button onClick={() => setAddingCategory(true)}
                style={{ padding:"10px 20px", borderRadius:11, border:"1.5px solid #3B5BF6", fontSize:13, fontWeight:700, color:"#3B5BF6", background:"white", flexShrink:0 }}>
                ＋ カテゴリ追加
              </button>
            </div>

            {addingCategory && (
              <div style={{ background:"white", borderRadius:16, border:"1.5px solid #3B5BF6", padding:20, marginBottom:18, boxShadow:"0 4px 16px rgba(59,91,246,.1)", animation:"fadeIn .2s ease" }}>
                <p style={{ fontSize:13, fontWeight:700, color:"#3B5BF6", marginBottom:13 }}>新しいカテゴリを追加</p>
                <div style={{ display:"flex", gap:9, flexWrap:"wrap" }}>
                  <input value={newCat.icon} onChange={(e) => setNewCat({...newCat,icon:e.target.value})}
                    style={{ width:58, padding:"9px 10px", borderRadius:9, border:"1.5px solid #E5E5EA", fontSize:19, textAlign:"center" }} />
                  <input value={newCat.label} onChange={(e) => setNewCat({...newCat,label:e.target.value})}
                    placeholder="カテゴリ名（例：文末表現）"
                    onKeyDown={(e) => { if (e.key === "Enter") addCategory(); }}
                    style={{ flex:1, minWidth:160, padding:"9px 13px", borderRadius:9, border:"1.5px solid #E5E5EA", fontSize:14 }} />
                  <button onClick={addCategory}
                    style={{ padding:"9px 22px", borderRadius:9, border:"none", background:"#3B5BF6", color:"white", fontSize:13, fontWeight:700 }}>追加</button>
                  <button onClick={() => setAddingCategory(false)}
                    style={{ padding:"9px 15px", borderRadius:9, border:"1.5px solid #E5E5EA", background:"white", fontSize:13, color:"#6B7280" }}>キャンセル</button>
                </div>
              </div>
            )}

            <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
              {constraints.map((c) => {
                const { bg, accent, light } = col(c.category);
                return (
                  <div key={c.id} style={{ background:"white", borderRadius:18, border:"1.5px solid #E5E7EB", overflow:"hidden", boxShadow:"0 1px 4px rgba(0,0,0,.04)", animation:"fadeIn .25s ease" }}>
                    <div style={{ padding:"15px 20px", background:bg, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                      <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                        <span style={{ fontSize:18 }}>{c.icon}</span>
                        <span style={{ fontSize:15, fontWeight:800, color:accent }}>{c.label}</span>
                        <span style={{ padding:"2px 9px", borderRadius:20, background:light, color:accent, fontSize:11, fontWeight:700 }}>{c.rules.length}件</span>
                      </div>
                      <button onClick={() => deleteCategory(c.id)}
                        style={{ padding:"4px 12px", borderRadius:7, border:"1px solid rgba(0,0,0,.1)", background:"rgba(255,255,255,.7)", fontSize:11, color:"#9CA3AF" }}>
                        削除
                      </button>
                    </div>

                    <div style={{ padding:"12px 20px" }}>
                      {c.rules.length === 0 && <p style={{ margin:"10px 0", fontSize:13, color:"#C4C4CC", textAlign:"center" }}>ルールがありません</p>}
                      {c.rules.map((rule, ri) => (
                        <div key={ri} style={{ display:"flex", alignItems:"flex-start", gap:10, padding:"9px 0", borderBottom: ri < c.rules.length-1 ? "1px solid #F5F5F8" : "none" }}>
                          {editingRule?.cId === c.id && editingRule?.rIdx === ri ? (
                            <div style={{ flex:1 }}>
                              <textarea
                                value={editingRuleText}
                                onChange={(e) => setEditingRuleText(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" && e.shiftKey) { e.preventDefault(); saveEditRule(c.id, ri); }
                                  else if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); }
                                  else if (e.key === "Escape") { setEditingRule(null); }
                                }}
                                rows={2}
                                style={{ width:"100%", padding:"9px 13px", borderRadius:9, border:`1.5px solid ${accent}`, fontSize:14, lineHeight:1.65, resize:"vertical", outline:"none" }}
                                autoFocus
                              />
                              <div style={{ display:"flex", gap:7, marginTop:8, alignItems:"center" }}>
                                <button onClick={() => saveEditRule(c.id, ri)}
                                  style={{ padding:"7px 18px", borderRadius:9, border:"none", background:accent, color:"white", fontSize:13, fontWeight:700 }}>保存</button>
                                <button onClick={() => setEditingRule(null)}
                                  style={{ padding:"7px 13px", borderRadius:9, border:"1.5px solid #E5E5EA", background:"white", fontSize:13, color:"#6B7280" }}>キャンセル</button>
                                <span style={{ fontSize:11, color:"#C4C4CC", marginLeft:4 }}>Shift+Enterでも保存</span>
                              </div>
                            </div>
                          ) : (
                            <>
                              <div style={{ width:5, height:5, borderRadius:"50%", background:accent, flexShrink:0, marginTop:9 }} />
                              <span style={{ flex:1, fontSize:14, color:"#374151", lineHeight:1.7 }}>{rule}</span>
                              <div style={{ display:"flex", gap:6, flexShrink:0 }}>
                                <button onClick={() => { setEditingRule({cId:c.id,rIdx:ri}); setEditingRuleText(rule); }}
                                  style={{ padding:"4px 10px", borderRadius:7, border:"1px solid #E5E5EA", background:"white", fontSize:12, color:"#6B7280" }}>編集</button>
                                <button onClick={() => deleteRule(c.id, ri)}
                                  style={{ padding:"4px 10px", borderRadius:7, border:"1px solid #FFE0E0", background:"#FFF5F5", fontSize:12, color:"#E63946" }}>削除</button>
                              </div>
                            </>
                          )}
                        </div>
                      ))}

                      {addingRuleTo === c.id ? (
                        <div style={{ marginTop:12 }}>
                          <textarea
                            value={newRuleText}
                            onChange={(e) => setNewRuleText(e.target.value)}
                            placeholder="新しいルールを入力..."
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && e.shiftKey) { e.preventDefault(); addRule(c.id); }
                              else if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); }
                              else if (e.key === "Escape") { setAddingRuleTo(null); setNewRuleText(""); }
                            }}
                            rows={2}
                            style={{ width:"100%", padding:"9px 13px", borderRadius:9, border:`1.5px solid ${accent}`, fontSize:14, lineHeight:1.65, resize:"vertical", outline:"none" }}
                            autoFocus
                          />
                          <div style={{ display:"flex", gap:7, marginTop:8, alignItems:"center" }}>
                            <button onClick={() => addRule(c.id)}
                              style={{ padding:"8px 20px", borderRadius:9, border:"none", background:accent, color:"white", fontSize:13, fontWeight:700 }}>追加</button>
                            <button onClick={() => { setAddingRuleTo(null); setNewRuleText(""); }}
                              style={{ padding:"8px 14px", borderRadius:9, border:"1.5px solid #E5E5EA", background:"white", fontSize:13, color:"#6B7280" }}>キャンセル</button>
                            <span style={{ fontSize:11, color:"#C4C4CC", marginLeft:4 }}>Shift+Enterでも追加</span>
                          </div>
                        </div>
                      ) : (
                        <button onClick={() => { setAddingRuleTo(c.id); setNewRuleText(""); }}
                          style={{ marginTop:12, padding:"9px 0", borderRadius:10, border:`1.5px dashed ${accent}`, background:bg, fontSize:13, fontWeight:700, color:accent, width:"100%" }}>
                          ＋ ルールを追加
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
