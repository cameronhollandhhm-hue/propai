import { useState } from "react";

export default function App() {
  const [input, setInput] = useState("");
  const [result, setResult] = useState("");

  const analyze = async () => {
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ text: input })
      });

      const data = await res.json();
      setResult(JSON.stringify(data, null, 2));
    } catch (err) {
      setResult("Error: " + err.message);
    }
  };

  return (
    <div style={{ padding: 20 }}>
      <h1>AI Buyer Tool</h1>

      <textarea
        rows={6}
        style={{ width: "100%" }}
        placeholder="Paste deal or product info..."
        value={input}
        onChange={(e) => setInput(e.target.value)}
      />

      <br /><br />

      <button onClick={analyze}>Analyze</button>

      <pre>{result}</pre>
    </div>
  );
}
