import NextAuth, { type NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";

export type UserRole = "admin" | "viewer";

function getAdminCredentials() {
  const user = process.env.DASHBOARD_ADMIN_USER;
  const hash = process.env.DASHBOARD_ADMIN_HASH || "";
  const plain = process.env.DASHBOARD_ADMIN_PASSWORD || "";
  if (!user || (!hash && !plain)) {
    throw new Error(
      "[auth] Admin credentials not configured. Set DASHBOARD_ADMIN_USER and " +
      "DASHBOARD_ADMIN_HASH (bcrypt) or DASHBOARD_ADMIN_PASSWORD in Replit Secrets."
    );
  }
  return { user, hash, plain };
}

function getViewerCredentials(): { user: string; plain: string } | null {
  const user = process.env.DASHBOARD_VIEWER_USER;
  const plain = process.env.DASHBOARD_VIEWER_PASSWORD || "";
  if (!user || !plain) return null;
  return { user, plain };
}

async function verifyPassword(plain: string, hash: string, plainFallback: string): Promise<boolean> {
  if (hash) return bcrypt.compare(plain, hash);
  return plain === plainFallback;
}

// Development needs zero configuration: an ephemeral secret keeps local
// sessions working without a .env file. Production requires a real secret.
const DEV_SECRET = process.env.NODE_ENV !== "production"
  ? "octagon-local-development-secret-do-not-use-in-production"
  : undefined;

export const authOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET ?? DEV_SECRET,
  session: {
    strategy: "jwt",
    maxAge: 8 * 60 * 60,
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.username || !credentials?.password) return null;

        if (!process.env.NEXTAUTH_SECRET) {
          console.error("[auth] NEXTAUTH_SECRET is not set — authentication will fail.");
          return null;
        }

        const admin = getAdminCredentials();
        if (credentials.username === admin.user) {
          const ok = await verifyPassword(credentials.password, admin.hash, admin.plain);
          if (ok) {
            return { id: "1", name: admin.user, email: `${admin.user}@farm.local`, role: "admin" as UserRole };
          }
          return null;
        }

        const viewer = getViewerCredentials();
        if (viewer && credentials.username === viewer.user && credentials.password === viewer.plain) {
          return { id: "2", name: viewer.user, email: `${viewer.user}@farm.local`, role: "viewer" as UserRole };
        }

        return null;
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = ((user as unknown) as { role: UserRole }).role ?? "viewer";
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as { role?: UserRole }).role = (token.role as UserRole) ?? "viewer";
      }
      return session;
    },
  },
};

const authHandler = NextAuth(authOptions);
export default authHandler;
