import { useState } from "react";
import { useAuth } from "../context/AuthContext";

export default function OperatorGate({ children }) {
  const { user, login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  if (user) return children;

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(email, password);
    } catch (err) {
      setError("Invalid email or password");
    }
    setLoading(false);
  }

  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center",
      justifyContent: "center", background: "#111", fontFamily: "sans-serif",
    }}>
      <div style={{
        background: "#1a1a1a", borderRadius: 16, padding: "40px 36px",
        width: 380, maxWidth: "90vw", boxShadow: "0 20px 50px rgba(0,0,0,.6)",
      }}>
        <h2 style={{ color: "#fff", textAlign: "center", marginBottom: 24 }}>
          Sign In
        </h2>

        {error && (
          <div style={{
            background: "#3a1111", border: "1px solid #ff4444", borderRadius: 8,
            padding: "10px 14px", color: "#ff6666", fontSize: 14, marginBottom: 16,
          }}>
            {error}
          </div>
        )}

        <label style={{ color: "#999", fontSize: 12, display: "block", marginBottom: 6 }}>Email</label>
        <input
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="you@example.com"
          style={{
            width: "100%", background: "#222", border: "1px solid #333",
            borderRadius: 8, padding: "12px 14px", color: "#fff",
            fontSize: 15, marginBottom: 16, boxSizing: "border-box",
          }}
        />

        <label style={{ color: "#999", fontSize: 12, display: "block", marginBottom: 6 }}>Password</label>
        <input
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          placeholder="••••••••"
          onKeyDown={e => e.key === "Enter" && handleSubmit(e)}
          style={{
            width: "100%", background: "#222", border: "1px solid #333",
            borderRadius: 8, padding: "12px 14px", color: "#fff",
            fontSize: 15, marginBottom: 24, boxSizing: "border-box",
          }}
        />

        <button
          onClick={handleSubmit}
          disabled={loading || !email || !password}
          style={{
            width: "100%", background: loading ? "#444" : "#2563eb",
            border: "none", color: "#fff", borderRadius: 8, padding: 14,
            fontSize: 16, fontWeight: 700, cursor: loading ? "default" : "pointer",
            opacity: (!email || !password) ? 0.5 : 1,
          }}
        >
          {loading ? "Signing in..." : "Sign In"}
        </button>
      </div>
    </div>
  );
}
