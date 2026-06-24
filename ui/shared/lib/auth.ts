import NextAuth from "next-auth";
import Keycloak from "next-auth/providers/keycloak";
import { config } from "@/shared/config";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Keycloak(config.idp),
  ],
  callbacks: {
    async jwt({ token, account }) {
      if (account?.id_token) token.idToken = account.id_token;
      return token;
    },
    async session({ session, token }) {
      (session as any).idToken = token.idToken;
      return session;
    },
  },
});
