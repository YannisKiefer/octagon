"use client";

import { signIn } from "next-auth/react";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const res = await signIn("credentials", {
      username,
      password,
      redirect: false,
    });

    setLoading(false);

    if (res?.error) {
      setError("Invalid username or password.");
    } else {
      router.push("/");
      router.refresh();
    }
  }

  return (
    <div className="min-h-screen bg-[#0d0d0f] text-[#f5f5f7] flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <svg
            width="40"
            height="40"
            viewBox="0 0 32 32"
            aria-hidden="true"
            className="mx-auto mb-4"
          >
            <rect width="32" height="32" rx="7" fill="#111113" />
            <polygon
              points="25.2,19.8 19.8,25.2 12.2,25.2 6.8,19.8 6.8,12.2 12.2,6.8 19.8,6.8 25.2,12.2"
              fill="none"
              stroke="#f5f5f7"
              strokeWidth="2"
              strokeLinejoin="round"
            />
            <circle cx="16" cy="16" r="2.5" fill="#30d158" />
          </svg>
          <h1 className="text-xl font-semibold tracking-wide">Octagon</h1>
          <p className="text-[13px] text-[#98989d] mt-1">
            Local console for your iPhone fleet
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="username"
              className="block text-xs uppercase tracking-wider text-[#98989d] mb-1"
            >
              Username
            </label>
            <input
              id="username"
              name="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
              className="w-full bg-[#1b1b1d] border border-[#2c2c2e] rounded-lg text-[#f5f5f7] px-3 py-2 text-sm placeholder:text-[#636366] focus:outline-none focus:border-[#48484a]"
            />
          </div>
          <div>
            <label
              htmlFor="password"
              className="block text-xs uppercase tracking-wider text-[#98989d] mb-1"
            >
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              className="w-full bg-[#1b1b1d] border border-[#2c2c2e] rounded-lg text-[#f5f5f7] px-3 py-2 text-sm placeholder:text-[#636366] focus:outline-none focus:border-[#48484a]"
            />
          </div>

          {error && (
            <p className="text-[#ff453a] text-xs" role="alert">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-[#f5f5f7] text-black rounded-full py-2 text-sm font-semibold hover:bg-white transition-colors disabled:opacity-50"
          >
            {loading ? "Signing in" : "Sign in"}
          </button>
        </form>

        <p className="text-[11.5px] text-[#636366] text-center mt-6">
          Credentials are configured in your .env file. Everything stays on this Mac.
        </p>
      </div>
    </div>
  );
}
