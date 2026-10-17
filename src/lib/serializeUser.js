// Single, shared view of a User row for anything that leaves the server.
//
// This used to be defined twice — once here and once, separately, inside
// auth.controller.js's login/verifyOtp handlers — and the two copies drifted:
// this one derived `avatarUrl` from avatarMimeType/avatarUpdatedAt, the other
// didn't. Logging in with email/password (or verifying OTP) stored a user
// object with no avatarUrl at all, so the header avatar fell back to the
// initial-letter chip, while logging in with Google (which calls GET /me,
// built from this same function) showed the real photo — same account, two
// different-looking results depending on which door you walked in through.
// Routing every login/profile response through this one function is what
// keeps that from happening again.
const SAFE_SELECT = {
  id: true,
  name: true,
  username: true,
  email: true,
  password: true,
  orgType: true,
  orgName: true,
  bio: true,
  hiddenFields: true,
  provider: true,
  emailVerified: true,
  avatarMimeType: true,
  avatarUpdatedAt: true,
  themeColor: true,
  usernameChangeCount: true,
};

function toSafeUser(user) {
  // avatarData (the actual image bytes), otpCodeHash and otpExpiresAt are
  // stripped here too, even though most callers already avoid selecting
  // them — a caller that fetches a user row without an explicit `select`
  // (as auth.controller.js's login/OTP handlers do, since they also need
  // otpCodeHash/otpExpiresAt for their own checks) would otherwise leak the
  // OTP hash and the raw avatar (as a giant {"0":255,"1":216,...} blob) in
  // the JSON response.
  const { password, avatarData, avatarMimeType, avatarUpdatedAt, otpCodeHash, otpExpiresAt, ...rest } = user;
  // profile.routes.js is mounted at /api/auth (not /api/profile) in index.js.
  const avatarUrl = avatarMimeType
    ? `/api/auth/${user.id}/avatar?v=${new Date(avatarUpdatedAt).getTime()}`
    : null;
  // This is the account owner's own view of themselves, so hiddenFields is
  // NOT applied here — hiding a field means "don't show this to other
  // people", never "hide it from yourself" — the profile page needs the raw
  // values (and the hiddenFields list itself) to render the edit form and
  // the privacy toggles.
  return { ...rest, hasPassword: !!password, avatarUrl, hiddenFields: Array.isArray(rest.hiddenFields) ? rest.hiddenFields : [] };
}

// A lighter view for showing OTHER people (friends, workspace members, chat
// senders, friend requests) — name and avatar are always shown (needed to
// identify who's who in the UI); org info and bio are included only if that
// user hasn't chosen to hide them. Email and login method are account/
// security info, not profile info — they're never part of this view at
// all, not even as something the user could choose to reveal. Any select
// that uses PUBLIC_USER_SELECT and passes its result through toPublicUser
// is automatically safe to send back as-is.
const PUBLIC_USER_SELECT = {
  id: true,
  username: true,
  name: true,
  orgType: true,
  orgName: true,
  bio: true,
  hiddenFields: true,
  avatarMimeType: true,
  avatarUpdatedAt: true,
  createdAt: true,
};

// Keep in sync with the toggles rendered on the Profile page's privacy
// section. Email/provider aren't here — see the note on PUBLIC_USER_SELECT,
// they're simply never shown to other people, so there's nothing to toggle.
const HIDABLE_FIELDS = ["org", "bio"];

function toPublicUser(user) {
  if (!user) return user;
  const hidden = Array.isArray(user.hiddenFields) ? user.hiddenFields : [];

  // Built as an explicit whitelist rather than "take everything and delete
  // the private bits" — some callers (e.g. friend.controller.js's addFriend,
  // which looks a user up by username to check for an existing friendship)
  // fetch the full row with no `select` at all, so a blacklist approach
  // would happily leak the password hash, email and raw avatar bytes
  // straight into the JSON response the moment such a call is passed
  // through here.
  const pub = {
    id: user.id,
    username: user.username,
    name: user.name,
    avatarUrl: user.avatarMimeType
      ? `/api/auth/${user.id}/avatar?v=${new Date(user.avatarUpdatedAt).getTime()}`
      : null,
    // Not hidable — like a GitHub "joined" date, it's not sensitive on its
    // own and callers (the public-profile card) rely on it being present.
    createdAt: user.createdAt,
  };
  if (!hidden.includes("org")) {
    pub.orgType = user.orgType;
    pub.orgName = user.orgName;
  }
  if (!hidden.includes("bio")) pub.bio = user.bio;

  return pub;
}

module.exports = { SAFE_SELECT, toSafeUser, PUBLIC_USER_SELECT, toPublicUser, HIDABLE_FIELDS };
