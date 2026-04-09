import { useState } from "react";
import { sendPasswordResetEmail } from "firebase/auth";
import { useAuth } from "../hooks/useAuth";
import { auth } from "../config/firebase-auth";

export default function OperatorGate({ children }) {
  const { user, login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);

  if (user) return children;

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setResetSent(false);
    setLoading(true);
    try {
      await login(email, password);
    } catch {
      setError("Invalid email or password");
    }
    setLoading(false);
  }

  async function handleForgotPassword() {
    if (!email.trim()) {
      setError("Enter your email address first, then click Forgot Password.");
      return;
    }
    setResetLoading(true);
    setError("");
    setResetSent(false);
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setResetSent(true);
    } catch {
      setResetSent(true);
    }
    setResetLoading(false);
  }

  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center",
      justifyContent: "center", background: "#111", fontFamily: "sans-serif",
    }}>
      <form onSubmit={handleSubmit} style={{
        background: "#1a1a1a", borderRadius: 16, padding: "40px 36px",
        width: 380, maxWidth: "90vw", boxShadow: "0 20px 50px rgba(0,0,0,.6)",
      }}>
        <h2 style={{ color: "#fff", textAlign: "center", marginBottom: 24 }}>
          Sign In
        </h2>

        {error && (
          <div role="alert" style={{
            background: "#3a1111", border: "1px solid #ff4444", borderRadius: 8,
            padding: "10px 14px", color: "#ff6666", fontSize: 14, marginBottom: 16,
          }}>
            {error}
          </div>
        )}

        {resetSent && (
          <div role="status" style={{
            background: "rgba(22,101,52,.2)", border: "1px solid rgba(74,222,128,.3)", borderRadius: 8,
            padding: "10px 14px", color: "#7ee8a8", fontSize: 14, marginBottom: 16,
          }}>
            If an account exists with that email, a password reset link has been sent. Check your inbox.
          </div>
        )}

        <label htmlFor="operator-email" style={{ color: "#999", fontSize: 12, display: "block", marginBottom: 6 }}>Email</label>
        <input
          id="operator-email"
          type="email"
          value={email}
          onChange={e => { setEmail(e.target.value); setError(""); setResetSent(false); }}
          placeholder="you@example.com"
          style={{
            width: "100%", background: "#222", border: "1px solid #333",
            borderRadius: 8, padding: "12px 14px", color: "#fff",
            fontSize: 15, marginBottom: 16, boxSizing: "border-box",
          }}
        />

        <label htmlFor="operator-password" style={{ color: "#999", fontSize: 12, display: "block", marginBottom: 6 }}>Password</label>
        <div style={{ position: "relative", marginBottom: 12 }}>
          <input
            id="operator-password"
            type={showPass ? "text" : "password"}
            value={password}
            onChange={e => { setPassword(e.target.value); setError(""); }}
            placeholder="Password"
            style={{
              width: "100%", background: "#222", border: "1px solid #333",
              borderRadius: 8, padding: "12px 44px 12px 14px", color: "#fff",
              fontSize: 15, boxSizing: "border-box",
            }}
          />
          <button
            type="button"
            aria-label={showPass ? "Hide password" : "Show password"}
            onClick={() => setShowPass(p => !p)}
            style={{
              position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)",
              background: "transparent", border: "none", color: "#666",
              cursor: "pointer", fontSize: 18, lineHeight: 1, padding: "4px",
            }}
          >
            {showPass ? "Hide" : "Show"}
          </button>
        </div>

        <div style={{ textAlign: "right", marginBottom: 20 }}>
          <button
            type="button"
            onClick={handleForgotPassword}
            disabled={resetLoading}
            style={{
              background: "transparent", border: "none", color: "#666",
              cursor: "pointer", fontSize: 13, textDecoration: "underline",
              padding: 0, fontFamily: "inherit",
            }}
          >
            {resetLoading ? "Sending..." : "Forgot password?"}
          </button>
        </div>

        <button
          type="submit"
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
      </form>
    </div>
  );
}
