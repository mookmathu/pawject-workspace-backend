const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const FacebookStrategy = require("passport-facebook").Strategy;
const GitHubStrategy = require("passport-github2").Strategy;
const prisma = require("./prisma");

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:4000";

// Shared across all three providers: match by (provider, providerId) first,
// then fall back to matching an existing account by email (so someone who
// registered with a password can still "link" a social login to the same
// account), and only create a brand-new user if neither matches.
async function findOrCreateOAuthUser(provider, providerId, email, name) {
  let user = await prisma.user.findFirst({ where: { provider, providerId } });
  if (user) return user;

  if (email) {
    const existingByEmail = await prisma.user.findUnique({ where: { email } });
    if (existingByEmail) {
      return prisma.user.update({
        where: { id: existingByEmail.id },
        data: { provider, providerId, emailVerified: true },
      });
    }
  }

  // Some providers (notably GitHub, when the user's email is private) don't
  // return an email at all — fall back to a synthetic one so the unique
  // constraint on User.email is still satisfied. The person can add a real
  // email later; nothing here depends on it being a real deliverable address.
  const finalEmail = email || `${provider}_${providerId}@no-email.crewspace.local`;

  user = await prisma.user.create({
    data: {
      name: name || "ผู้ใช้ใหม่",
      email: finalEmail,
      provider,
      providerId,
      emailVerified: true, // trust the provider's own verification
    },
  });
  return user;
}

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: `${BACKEND_URL}/api/auth/google/callback`,
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const email = profile.emails?.[0]?.value || null;
        const user = await findOrCreateOAuthUser("google", profile.id, email, profile.displayName);
        done(null, user);
      } catch (err) {
        done(err);
      }
    }
  )
);

// Facebook and GitHub are only registered once their credentials actually
// exist — Passport throws at require-time otherwise, which would crash the
// whole server just because one provider isn't set up yet. See
// oauth.routes.js for the matching "not configured yet" check.
const configuredProviders = new Set(["google"]);

if (process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET) {
  passport.use(
    new FacebookStrategy(
      {
        clientID: process.env.FACEBOOK_APP_ID,
        clientSecret: process.env.FACEBOOK_APP_SECRET,
        callbackURL: `${BACKEND_URL}/api/auth/facebook/callback`,
        profileFields: ["id", "displayName", "emails"],
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          const email = profile.emails?.[0]?.value || null;
          const user = await findOrCreateOAuthUser("facebook", profile.id, email, profile.displayName);
          done(null, user);
        } catch (err) {
          done(err);
        }
      }
    )
  );
  configuredProviders.add("facebook");
}

if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
  passport.use(
    new GitHubStrategy(
      {
        clientID: process.env.GITHUB_CLIENT_ID,
        clientSecret: process.env.GITHUB_CLIENT_SECRET,
        callbackURL: `${BACKEND_URL}/api/auth/github/callback`,
        scope: ["user:email"],
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          const email = profile.emails?.[0]?.value || null;
          const user = await findOrCreateOAuthUser(
            "github",
            profile.id,
            email,
            profile.displayName || profile.username
          );
          done(null, user);
        } catch (err) {
          done(err);
        }
      }
    )
  );
  configuredProviders.add("github");
}

module.exports = passport;
module.exports.configuredProviders = configuredProviders;