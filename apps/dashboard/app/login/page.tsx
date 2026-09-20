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
    <div className="min-h-screen bg-[#0F1F17] text-[#F8F6F1] flex items-center justify-center px-4">
      <div className="w-full max-w-sm bg-[#14231B] border border-[#2E4538] rounded-[24px] p-8">
        <div className="mb-8 text-center">
          <img src="/icon.png" alt="Octagon" width="40" height="40" className="mx-auto mb-4 rounded-[7px]" />
          <h1 className="text-xl font-bold tracking-wide">Octagon</h1>
          <p className="text-[13px] text-[#A8B5AD] mt-1">
            Local console for your iPhone fleet
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="username"
              className="block text-xs uppercase tracking-wider text-[#A8B5AD] mb-1"
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
              className="w-full bg-[#182A20] border border-[#2E4538] rounded-lg text-[#F8F6F1] px-3 py-2 text-sm placeholder:text-[#6E7F74] focus:outline-none focus:border-[#C58E5B]"
            />
          </div>
          <div>
            <label
              htmlFor="password"
              className="block text-xs uppercase tracking-wider text-[#A8B5AD] mb-1"
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
              className="w-full bg-[#182A20] border border-[#2E4538] rounded-lg text-[#F8F6F1] px-3 py-2 text-sm placeholder:text-[#6E7F74] focus:outline-none focus:border-[#C58E5B]"
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
            className="w-full bg-[#C58E5B] text-[#0F1F17] rounded-full py-2 text-sm font-bold hover:bg-[#D9A76F] transition-colors disabled:opacity-50"
          >
            {loading ? "Signing in" : "Sign in"}
          </button>
        </form>

        <p className="text-[11.5px] text-[#6E7F74] text-center mt-6">
          Credentials are configured in your .env file. Everything stays on this Mac.
        </p>
      </div>
    </div>
  );
}
