import React, { useState, useRef, useEffect } from "react";

// ─── MEGA SYSTEM PROMPT ───────────────────────────────────────────────────────
const SYSTEM = "PropAI";

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function renderText(text) {
  return text.split("\n").map((line, i) => {
    if (!line.trim()) return React.createElement("div", { key: i, style: { height: 5 } });
    const bold = line.split(/(\*\*[^*]+\*\*)/g).map((p, j) =>
      p.startsWith("**") && p.endsWith("**")
        ? React.createElement("strong", { key: j, style: { color: "#e8b84b" } }, p.slice(2, -2))
        : p
    );
    if (line.startsWith("- ")) return (
      React.createElement("div", { key: i, style: { display:"flex", gap:8, marginBottom:3 } },
        React.createElement("span", { style:{ color:"#e8b84b", flexShrink:0 } }, "•"),
        React.createElement("span", null, bold)
      )
    );
    return React.createElement("div", { key: i, style: { marginBottom: 2 } }, bold);
  });
}

const FREE_LIMIT = 3;

// ─── LANDING PAGE ─────────────────────────────────────────────────────────────
function Landing({ onStart }) {
  const features = [
    { icon:"⭐", title:"Deal Score /100", desc:"Every suburb scored across growth, yield, demand and fundamentals. Know exactly why." },
    { icon:"💰", title:"Undervalued Detection", desc:"Compare asking price to comparable sales. Spot properties $20k–$50k below market." },
    { icon:"🎯", title:"Negotiation Strategy", desc:"Target price, walk-away price, and 3 specific tactics. Your AI buyers advocate." },
    { icon:"🔥", title:"Daily Deal Feed", desc:"Deal of the Day every morning. Top 5 ranked opportunities. One AVOID with reasoning." },
    { icon:"💡", title:"Investor Edge", desc:"Why this deal exists. What smart money sees. The insider angle others miss." },
    { icon:"📈", title:"Live Web Search", desc:"Pulls real data from CoreLogic, SQM Research, REIWA and Domain before every answer." },
  ];

  return React.createElement("div", { style:{ minHeight:"100vh", background:"#080a0e", color:"#e8e6e0", fontFamily:"'IBM Plex Mono', monospace" } },
    // NAV
    React.createElement("nav", { style:{ borderBottom:"1px solid rgba(255,255,255,0.06)", padding:"0 40px", height:60, display:"flex", alignItems:"center", justifyContent:"space-between", position:"sticky", top:0, background:"rgba(8,10,14,0.95)", backdropFilter:"blur(10px)", zIndex:100 } },
      React.createElement("div", { style:{ display:"flex", alignItems:"center", gap:10 } },
        React.createElement("div", { style:{ width:28, height:28, background:"#e8b84b", borderRadius:6, display:"flex", alignItems:"center", justifyContent:"center", fontWeight:800, fontSize:12, color:"#000" } }, "P"),
        React.createElement("div", { style:{ fontWeight:700, fontSize:14 } }, "PropAI")
      ),
      React.createElement("button", { onClick:onStart, style:{ background:"#e8b84b", color:"#000", border:"none", borderRadius:8, padding:"8px 20px", fontFamily:"'IBM Plex Mono',monospace", fontSize:12, fontWeight:700, cursor:"pointer" } }, "Start Free →")
    ),

    // HERO
    React.createElement("div", { style:{ maxWidth:900, margin:"0 auto", padding:"100px 40px 80px", textAlign:"center" } },
      React.createElement("div", { style:{ display:"inline-flex", alignItems:"center", gap:8, background:"rgba(74,222,128,0.1)", border:"1px solid rgba(74,222,128,0.2)", borderRadius:20, padding:"4px 14px", fontSize:11, color:"#4ade80", marginBottom:28 } }, "🔍 Live data • Real decisions • Real money"),
      React.createElement("h1", { style:{ fontFamily:"'Syne', sans-serif", fontWeight:800, fontSize:"clamp(36px,6vw,64px)", lineHeight:1.1, marginBottom:24, letterSpacing:"-0.02em" } },
        "Find Investment Properties",
        React.createElement("span", { style:{ color:"#e8b84b", display:"block" } }, "Before the Market Does")
      ),
      React.createElement("p", { style:{ fontSize:16, color:"#9ca3af", lineHeight:1.7, maxWidth:560, margin:"0 auto 40px" } },
        "AI-powered deal scoring, undervalued detection, and negotiation strategy. Like having a buyer's agent in your pocket — for $49/month."
      ),
      React.createElement("div", { style:{ display:"flex", gap:12, justifyContent:"center", flexWrap:"wrap" } },
        React.createElement("button", { onClick:onStart, style:{ background:"#e8b84b", color:"#000", border:"none", borderRadius:10, padding:"14px 32px", fontFamily:"'IBM Plex Mono',monospace", fontSize:14, fontWeight:700, cursor:"pointer" } }, "Start Free — 3 Analyses"),
        React.createElement("button", { onClick:onStart, style:{ background:"transparent", color:"#e8e6e0", border:"1px solid rgba(255,255,255,0.15)", borderRadius:10, padding:"14px 24px", fontFamily:"'IBM Plex Mono',monospace", fontSize:14, cursor:"pointer" } }, "See How It Works")
      ),
      React.createElement("div", { style:{ marginTop:16, fontSize:13, color:"#9ca3af", fontStyle:"italic" } }, "No fluff. No hype. Just data-backed decisions."),
      React.createElement("div", { style:{ marginTop:8, fontSize:11, color:"#4b5563" } }, "No credit card required • 3 free analyses • Cancel anytime")
    ),

    // DEMO CARD
    React.createElement("div", { style:{ maxWidth:720, margin:"0 auto 80px", padding:"0 40px" } },
      React.createElement("div", { style:{ background:"#111318", border:"1px solid rgba(232,184,75,0.15)", borderRadius:16, padding:"24px 28px", fontFamily:"monospace", fontSize:12 } },
        React.createElement("div", { style:{ display:"flex", alignItems:"center", gap:8, marginBottom:16 } },
          React.createElement("div", { style:{ width:8, height:8, borderRadius:"50%", background:"#4ade80" } }),
          React.createElement("span", { style:{ fontSize:10, color:"#4ade80" } }, "LIVE ANALYSIS — Mackay QLD")
        ),
        React.createElement("div", { style:{ color:"#e8b84b", fontWeight:700, marginBottom:8 } }, "🏡 MACKAY, QLD"),
        React.createElement("div", { style:{ marginBottom:8 } }, "⭐ DEAL SCORE: 78 / 100  |  ⚖️ BALANCED"),
        React.createElement("div", { style:{ borderTop:"1px solid rgba(255,255,255,0.07)", paddingTop:10, marginBottom:10 } },
          React.createElement("div", { style:{ color:"#fbbf24", marginBottom:4 } }, "⚡ QUICK TAKE"),
          React.createElement("div", { style:{ color:"#9ca3af" } }, "• 22% annual growth — strong but not yet peaked"),
          React.createElement("div", { style:{ color:"#9ca3af" } }, "• +$57/week cashflow at $585k purchase"),
          React.createElement("div", { style:{ color:"#9ca3af" } }, "• Suits balanced investors with 5-7yr hold horizon"),
          React.createElement("div", { style:{ marginTop:8, color:"#4ade80", fontWeight:700 } }, "👉 VERDICT: NEGOTIATE")
        ),
        React.createElement("div", { style:{ borderTop:"1px solid rgba(255,255,255,0.07)", paddingTop:10 } },
          React.createElement("div", { style:{ color:"#e8b84b", fontWeight:700 } }, "🎯 FINAL CALL"),
          React.createElement("div", { style:{ color:"#e8e6e0" } }, "If this were my money:"),
          React.createElement("div", { style:{ color:"#4ade80", fontWeight:700 } }, "👉 I would BUY under $570k"),
          React.createElement("div", { style:{ color:"#9ca3af", fontSize:11, marginTop:4 } }, "Demand structural, cashflow positive, still below comparable QLD markets.")
        )
      )
    ),

    // FEATURES
    React.createElement("div", { style:{ maxWidth:960, margin:"0 auto 100px", padding:"0 40px" } },
      React.createElement("h2", { style:{ fontFamily:"'Syne',sans-serif", fontWeight:800, fontSize:28, textAlign:"center", marginBottom:48 } }, "Everything a buyers advocate gives you.", React.createElement("br"), React.createElement("span", { style:{ color:"#e8b84b" } }, "At 1% of the cost.")),
      React.createElement("div", { style:{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))", gap:16 } },
        ...features.map((f,i) => React.createElement("div", { key:i, style:{ background:"#111318", border:"1px solid rgba(255,255,255,0.07)", borderRadius:12, padding:"20px 22px" } },
          React.createElement("div", { style:{ fontSize:24, marginBottom:10 } }, f.icon),
          React.createElement("div", { style:{ fontWeight:700, fontSize:14, marginBottom:6 } }, f.title),
          React.createElement("div", { style:{ color:"#6b7280", fontSize:12, lineHeight:1.6 } }, f.desc)
        ))
      )
    ),

    // PRICING
    React.createElement("div", { style:{ maxWidth:700, margin:"0 auto 100px", padding:"0 40px", textAlign:"center" } },
      React.createElement("h2", { style:{ fontFamily:"'Syne',sans-serif", fontWeight:800, fontSize:28, marginBottom:12 } }, "Simple pricing"),
      React.createElement("p", { style:{ color:"#6b7280", marginBottom:40, fontSize:13 } }, "Start free. Upgrade when you're ready to get serious."),
      React.createElement("div", { style:{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 } },
        React.createElement("div", { style:{ background:"#111318", border:"1px solid rgba(255,255,255,0.1)", borderRadius:16, padding:"28px 24px" } },
          React.createElement("div", { style:{ fontSize:13, color:"#6b7280", marginBottom:8 } }, "FREE"),
          React.createElement("div", { style:{ fontFamily:"'Syne',sans-serif", fontWeight:800, fontSize:32, marginBottom:4 } }, "$0"),
          React.createElement("div", { style:{ fontSize:12, color:"#6b7280", marginBottom:20 } }, "forever"),
          ...["3 analyses total", "Suburb Mode", "Deal Mode", "Daily Deal Feed"].map((f,i) => React.createElement("div", { key:i, style:{ fontSize:12, color:i<3?"#e8e6e0":"#4b5563", marginBottom:8, display:"flex", gap:8, alignItems:"center" } }, React.createElement("span", { style:{ color:i<3?"#4ade80":"#4b5563" } }, i<3?"✓":"✕"), f)),
          React.createElement("button", { onClick:onStart, style:{ width:"100%", marginTop:20, padding:"11px", borderRadius:8, border:"1px solid rgba(255,255,255,0.15)", background:"transparent", color:"#e8e6e0", fontFamily:"monospace", fontSize:12, cursor:"pointer" } }, "Start Free")
        ),
        React.createElement("div", { style:{ background:"#111318", border:"2px solid #e8b84b", borderRadius:16, padding:"28px 24px", position:"relative" } },
          React.createElement("div", { style:{ position:"absolute", top:-12, left:"50%", transform:"translateX(-50%)", background:"#e8b84b", color:"#000", fontSize:10, fontWeight:700, padding:"3px 12px", borderRadius:20 } }, "MOST POPULAR"),
          React.createElement("div", { style:{ fontSize:13, color:"#6b7280", marginBottom:8 } }, "PRO"),
          React.createElement("div", { style:{ fontFamily:"'Syne',sans-serif", fontWeight:800, fontSize:32, marginBottom:4, color:"#e8b84b" } }, "$49"),
          React.createElement("div", { style:{ fontSize:12, color:"#6b7280", marginBottom:20 } }, "per month"),
          ...["Unlimited analyses", "Suburb Mode", "Deal Mode", "Daily Deal Feed", "Negotiation strategy", "Undervalued detection"].map((f,i) => React.createElement("div", { key:i, style:{ fontSize:12, color:"#e8e6e0", marginBottom:8, display:"flex", gap:8, alignItems:"center" } }, React.createElement("span", { style:{ color:"#4ade80" } }, "✓"), f)),
          React.createElement("button", { onClick:onStart, style:{ width:"100%", marginTop:20, padding:"11px", borderRadius:8, border:"none", background:"#e8b84b", color:"#000", fontFamily:"monospace", fontSize:12, fontWeight:700, cursor:"pointer" } }, "Get Pro →")
        )
      )
    ),

    // FOOTER
    React.createElement("div", { style:{ borderTop:"1px solid rgba(255,255,255,0.06)", padding:"24px 40px", display:"flex", justifyContent:"space-between", alignItems:"center", fontSize:11, color:"#4b5563" } },
      React.createElement("div", null, "© 2026 PropAI. Australian Property Intelligence."),
      React.createElement("div", null, "Not financial advice. Always consult a mortgage broker and conveyancer.")
    )
  );
}

// ─── PAYWALL ──────────────────────────────────────────────────────────────────
function Paywall({ used, onUpgrade }) {
  return React.createElement("div", { style:{ background:"#111318", border:"1px solid rgba(232,184,75,0.3)", borderRadius:14, padding:"28px 24px", margin:"20px 0", textAlign:"center" } },
    React.createElement("div", { style:{ fontSize:28, marginBottom:12 } }, "🔒"),
    React.createElement("div", { style:{ fontFamily:"'Syne',sans-serif", fontWeight:700, fontSize:18, marginBottom:8 } }, "You've used your 3 free analyses"),
    React.createElement("div", { style:{ color:"#6b7280", fontSize:13, marginBottom:20, lineHeight:1.6 } },
      "Upgrade to Pro to unlock unlimited deal analysis,", React.createElement("br"),
      "daily deal feed, negotiation strategies and more."
    ),
    React.createElement("div", { style:{ background:"#181c24", borderRadius:10, padding:"16px 20px", marginBottom:20, textAlign:"left" } },
      ...["✓ Unlimited suburb + deal analysis", "✓ Daily Deal of the Day", "✓ Undervalued detection", "✓ Full negotiation strategy", "✓ Investor Edge insights"].map((f,i) =>
        React.createElement("div", { key:i, style:{ fontSize:12, color:"#e8e6e0", marginBottom:6 } }, f)
      )
    ),
    React.createElement("button", { onClick:onUpgrade, style:{ width:"100%", padding:14, borderRadius:10, border:"none", background:"#e8b84b", color:"#000", fontFamily:"monospace", fontSize:14, fontWeight:700, cursor:"pointer", marginBottom:10 } }, "Upgrade to Pro — $49/month →"),
    React.createElement("div", { style:{ fontSize:11, color:"#4b5563" } }, "Cancel anytime • Instant access")
  );
}

// ─── MAIN DASHBOARD ───────────────────────────────────────────────────────────
export default function App() {
  const [screen, setScreen] = useState("landing"); // landing | app
  const [isPro, setIsPro] = useState(false);
  const [usageCount, setUsageCount] = useState(0);
  const [msgs, setMsgs] = useState([{
    role:"assistant",
    text:"G'day! I'm PropAI — your elite AI buyer's agent. 🏡\n\n**Three modes:**\n\n**🔥 DAILY DEALS** — Today's top scored opportunities\n**🏡 SUBURB MODE** — Full score breakdown + BUY/WATCH/AVOID\n**🏠 DEAL MODE** — Paste any property for undervalued detection + negotiation strategy\n\n**Every analysis includes:**\n- Deal Score /100 with transparent breakdown\n- Cashflow snapshot at 20% deposit\n- Undervalued detection vs comparable sales\n- Negotiation strategy with target price\n- Investor Edge — what smart money sees\n- Final Call — decisive, personal, actionable\n\n**What is your budget and target area?**"
  }]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState(false);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior:"smooth" }); }, [msgs, busy]);

  function handleStart() { setScreen("app"); }
  function handleUpgrade() {
    window.open("https://buy.stripe.com/28EdRb8NX7ErgxQ4zF8k800", "_blank");
    setTimeout(() => setIsPro(true), 2000); // temp unlock for MVP
  }

  async function sendMsg(text) {
    const msg = (text || input).trim().slice(0, 1000);
    if (!msg || busy) return;
    if (!isPro && usageCount >= FREE_LIMIT) return;
    const history = [...msgs, { role:"user", text:msg }];
    setMsgs(history);
    setInput("");
    setBusy(true);
    setSearching(true);
    setUsageCount(c => c + 1);
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 25000);
      const res = await fetch("/api/analyze", {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({ history, system: SYSTEM }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const data = await res.json();
      setSearching(false);
      if (!res.ok) {
        setMsgs(p=>[...p,{ role:"assistant", text:"⚠️ " + (data?.error || "Something went wrong. Please try again in a few seconds.") }]);
      } else {
        const reply = (data.content||[]).filter(b=>b.type==="text").map(b=>b.text).join("\n") || "No response.";
        setMsgs(p=>[...p,{ role:"assistant", text:reply }]);
      }
    } catch(e) {
      setSearching(false);
      const msg = e.name === "AbortError"
        ? "⚠️ Search timed out. Live data is taking too long — please try again."
        : "⚠️ Something went wrong pulling live data. Try again in 10–20 seconds.";
      setMsgs(p=>[...p,{ role:"assistant", text:msg }]);
    }
    setBusy(false);
  }

  const quickBtns = [
    { label:"🔥 Today's top deals", prompt:"Show me today's top deals under $650k in QLD ranked by deal score" },
    { label:"🏡 Score a suburb", prompt:"Score Geraldton WA as an investment — BUY or AVOID?" },
    { label:"💰 Analyse a deal", prompt:"3 bed house Mackay QLD $585,000 rent $600 per week — is this undervalued? Run full deal analysis." },
    { label:"📡 Opportunity Radar", prompt:"Run the opportunity radar for under $600k across QLD and WA — rank by deal score" },
  ];

  const remaining = FREE_LIMIT - usageCount;
  const showPaywall = !isPro && usageCount >= FREE_LIMIT;

  if (screen === "landing") return React.createElement(Landing, { onStart: handleStart });

  return React.createElement(React.Fragment, null,
    React.createElement("style", null, `
      @import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=IBM+Plex+Mono:wght@400;500&display=swap');
      *{box-sizing:border-box;margin:0;padding:0}
      html,body,#root{height:100%;background:#080a0e}
      body{font-family:'IBM Plex Mono',monospace;color:#e8e6e0}
      ::-webkit-scrollbar{width:4px;height:4px}
      ::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.08);border-radius:2px}
      @keyframes bounce{0%,80%,100%{opacity:.2;transform:scale(.7)}40%{opacity:1;transform:scale(1)}}
      @keyframes pulse{0%,100%{opacity:.4}50%{opacity:1}}
      @keyframes fu{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
      .qb:hover{border-color:#e8b84b!important;color:#e8e6e0!important;background:rgba(232,184,75,0.05)!important}
      textarea,input{outline:none}
    `),

    React.createElement("div", { style:{ display:"grid", gridTemplateColumns:"240px 1fr", gridTemplateRows:"56px 1fr", height:"100vh", overflow:"hidden", background:"#080a0e" } },

      // HEADER
      React.createElement("div", { style:{ gridColumn:"1/-1", background:"#0e1117", borderBottom:"1px solid rgba(255,255,255,0.06)", display:"flex", alignItems:"center", padding:"0 22px", gap:12 } },
        React.createElement("div", { style:{ display:"flex", alignItems:"center", gap:8 } },
          React.createElement("div", { style:{ width:28, height:28, background:"#e8b84b", borderRadius:6, display:"flex", alignItems:"center", justifyContent:"center", fontWeight:800, fontSize:12, color:"#000" } }, "P"),
          React.createElement("div", { style:{ fontFamily:"'Syne',sans-serif", fontWeight:700, fontSize:15 } }, "PropAI")
        ),
        React.createElement("div", { style:{ fontSize:9, color:"#4ade80", background:"rgba(74,222,128,0.1)", border:"1px solid rgba(74,222,128,0.2)", borderRadius:20, padding:"2px 10px" } }, "🔍 LIVE"),
        React.createElement("div", { style:{ marginLeft:"auto", display:"flex", alignItems:"center", gap:12 } },
          !isPro && React.createElement("div", { style:{ fontSize:11, color: remaining <= 1 ? "#f87171" : "#6b7280" } },
            remaining > 0 ? `${remaining} free ${remaining===1?"analysis":"analyses"} left — then unlock unlimited` : "Free limit reached"
          ),
          !isPro && React.createElement("button", { onClick:handleUpgrade, style:{ fontSize:11, background:"#e8b84b", color:"#000", border:"none", borderRadius:8, padding:"5px 14px", cursor:"pointer", fontFamily:"monospace", fontWeight:700 } }, "Upgrade $49/mo"),
          isPro && React.createElement("div", { style:{ fontSize:10, color:"#4ade80", background:"rgba(74,222,128,0.1)", border:"1px solid rgba(74,222,128,0.2)", borderRadius:20, padding:"3px 10px" } }, "⭐ PRO"),
          React.createElement("button", { onClick:()=>setScreen("landing"), style:{ fontSize:10, color:"#4b5563", background:"none", border:"none", cursor:"pointer" } }, "← Home")
        )
      ),

      // SIDEBAR
      React.createElement("div", { style:{ background:"#0e1117", borderRight:"1px solid rgba(255,255,255,0.06)", padding:"20px 14px", display:"flex", flexDirection:"column", gap:4, overflowY:"auto" } },
        React.createElement("div", { style:{ fontSize:9, letterSpacing:"0.15em", textTransform:"uppercase", color:"#4b5563", padding:"6px 8px 10px" } }, "Quick Actions"),
        ...quickBtns.map((b,i) => React.createElement("button", { key:i, className:"qb", onClick:()=>{ if(!busy && (isPro || usageCount < FREE_LIMIT)) sendMsg(b.prompt); }, style:{ display:"flex", alignItems:"center", gap:8, padding:"9px 10px", borderRadius:8, border:"1px solid rgba(255,255,255,0.06)", background:"transparent", color:"#6b7280", fontFamily:"'IBM Plex Mono',monospace", fontSize:11, cursor:"pointer", textAlign:"left", width:"100%", transition:"all 0.15s" } }, b.label)),

        React.createElement("div", { style:{ margin:"16px 0 8px", height:"1px", background:"rgba(255,255,255,0.06)" } }),
        React.createElement("div", { style:{ fontSize:9, letterSpacing:"0.15em", textTransform:"uppercase", color:"#4b5563", padding:"4px 8px 10px" } }, "How To Use"),
        ...["Type any suburb name + state", "Paste property: suburb, price, rent", "Ask for today's deals", "Compare 2 suburbs"].map((tip,i) =>
          React.createElement("div", { key:i, style:{ padding:"7px 10px", fontSize:10, color:"#4b5563", lineHeight:1.5 } }, `• ${tip}`)
        ),

        React.createElement("div", { style:{ marginTop:"auto", padding:"14px 10px 0" } },
          React.createElement("div", { style:{ background:"#181c24", borderRadius:10, padding:"12px 14px", fontSize:11 } },
            React.createElement("div", { style:{ color:"#6b7280", marginBottom:4 } }, "⚠️ Disclaimer"),
            React.createElement("div", { style:{ color:"#4b5563", lineHeight:1.6, fontSize:10 } }, "Not financial advice. Always consult a mortgage broker and conveyancer before purchasing.")
          )
        )
      ),

      // MAIN CHAT
      React.createElement("div", { style:{ overflow:"hidden", display:"flex", flexDirection:"column", background:"#080a0e" } },
        // Messages
        React.createElement("div", { style:{ flex:1, overflowY:"auto", padding:"20px 28px", display:"flex", flexDirection:"column", gap:16 } },
          ...msgs.map((m,i) => React.createElement("div", { key:i, style:{ display:"flex", gap:10, flexDirection:m.role==="user"?"row-reverse":"row", alignSelf:m.role==="user"?"flex-end":"flex-start", maxWidth:"82%", animation:"fu 0.3s ease both" } },
            React.createElement("div", { style:{ width:30, height:30, borderRadius:8, display:"flex", alignItems:"center", justifyContent:"center", fontSize:13, flexShrink:0, background:m.role==="assistant"?"rgba(232,184,75,0.1)":"#181c24", border:`1px solid ${m.role==="assistant"?"rgba(232,184,75,0.25)":"rgba(255,255,255,0.06)"}` } }, m.role==="assistant"?"🏡":"👤"),
            React.createElement("div", { style:{ padding:"12px 16px", borderRadius:12, fontSize:13, lineHeight:1.75, background:m.role==="assistant"?"#0e1117":"#e8b84b", color:m.role==="assistant"?"#e8e6e0":"#080a0e", border:m.role==="assistant"?"1px solid rgba(255,255,255,0.06)":"none", borderTopLeftRadius:m.role==="assistant"?3:12, borderTopRightRadius:m.role==="user"?3:12 } }, renderText(m.text))
          )),
          busy && React.createElement("div", { style:{ display:"flex", gap:10, alignSelf:"flex-start", animation:"fu 0.3s ease both" } },
            React.createElement("div", { style:{ width:30, height:30, borderRadius:8, display:"flex", alignItems:"center", justifyContent:"center", fontSize:13, background:"rgba(232,184,75,0.1)", border:"1px solid rgba(232,184,75,0.25)" } }, "🏡"),
            React.createElement("div", { style:{ padding:"12px 16px", borderRadius:12, borderTopLeftRadius:3, background:"#0e1117", border:"1px solid rgba(255,255,255,0.06)", display:"flex", alignItems:"center", gap:8 } },
              searching
                ? React.createElement(React.Fragment, null,
                    React.createElement("span", { style:{ animation:"pulse 1.2s infinite", color:"#4ade80" } }, "🔍"),
                    React.createElement("span", { style:{ fontSize:11, color:"#4ade80", animation:"pulse 1.2s infinite" } }, "Searching live data...")
                  )
                : [0,0.2,0.4].map((d,i)=>React.createElement("span",{key:i,style:{display:"inline-block",width:6,height:6,borderRadius:"50%",background:"#e8b84b",animation:`bounce 1.2s ease-in-out ${d}s infinite`}}))
            )
          ),
          showPaywall && React.createElement(Paywall, { used:usageCount, onUpgrade:handleUpgrade }),
          React.createElement("div", { ref:bottomRef })
        ),

        // Input area
        React.createElement("div", { style:{ borderTop:"1px solid rgba(255,255,255,0.06)", padding:"14px 28px", background:"#0e1117", display:"flex", flexDirection:"column", gap:10 } },
          !showPaywall && React.createElement("div", { style:{ display:"flex", gap:6, flexWrap:"wrap" } },
            ...["🔥 Today's top deals QLD", "Score Geraldton WA", "Mackay $585k $600pw deal?", "WA Opportunity Radar"].map((s,i) =>
              React.createElement("button", { key:i, className:"qb", onClick:()=>{ if(!busy && (isPro || usageCount < FREE_LIMIT)) sendMsg(s); }, style:{ fontSize:10, padding:"3px 10px", borderRadius:20, border:"1px solid rgba(255,255,255,0.1)", background:"transparent", color:"#4b5563", cursor:"pointer", transition:"all 0.15s", fontFamily:"monospace" } }, s)
            )
          ),
          React.createElement("div", { style:{ display:"flex", gap:10, alignItems:"flex-end" } },
            React.createElement("textarea", { ref:inputRef, value:input, onChange:e=>setInput(e.target.value), onKeyDown:e=>{ if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendMsg();}}, placeholder: showPaywall ? "Upgrade to Pro to continue..." : "Ask about any suburb, or paste a property — suburb, price, rent...", disabled:showPaywall||busy, rows:1, style:{ flex:1, background:showPaywall?"#0e1117":"#181c24", border:"1px solid rgba(255,255,255,0.08)", borderRadius:10, padding:"10px 14px", color:"#e8e6e0", fontFamily:"'IBM Plex Mono',monospace", fontSize:13, resize:"none", lineHeight:1.5, opacity:showPaywall?0.4:1 } }),
            React.createElement("button", { onClick:()=>sendMsg(), disabled:busy||!input.trim()||showPaywall, style:{ width:42, height:42, borderRadius:10, border:"none", background:busy||!input.trim()||showPaywall?"rgba(232,184,75,0.25)":"#e8b84b", color:"#000", cursor:busy||!input.trim()||showPaywall?"not-allowed":"pointer", fontSize:18, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 } }, "↑")
          )
        )
      )
    )
  );
}
