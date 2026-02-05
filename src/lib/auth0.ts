import { Auth0Client } from "@auth0/nextjs-auth0/server";

export const auth0 = new Auth0Client({
  routes: {
    login: "/api/auth/login",
    logout: "/api/auth/logout",
    callback: "/api/auth/callback"
  },
  session: {
    rolling: true, // Extend session on each request
    rollingDuration: 60 * 60 * 24 * 180, // 180 days in seconds
    absoluteDuration: 60 * 60 * 24 * 180 // 180 days maximum
  }
});
