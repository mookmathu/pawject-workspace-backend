const { toSafeUser, toPublicUser, HIDABLE_FIELDS, SAFE_SELECT, PUBLIC_USER_SELECT } = require("../src/lib/serializeUser");

const base = {
  id: "u1",
  name: "Mook",
  username: "mook",
  email: "mook@example.com",
  password: "hash",
  avatarData: Buffer.from([1, 2, 3]),
  avatarMimeType: null,
  avatarUpdatedAt: null,
  otpCodeHash: "otp-hash",
  otpExpiresAt: new Date(),
  orgType: "university",
  orgName: "KU",
  bio: "hello",
  hiddenFields: [],
  createdAt: new Date("2026-01-01T00:00:00Z"),
};

describe("toSafeUser", () => {
  it("strips secrets and raw avatar bytes", () => {
    const out = toSafeUser(base);
    expect(out).not.toHaveProperty("password");
    expect(out).not.toHaveProperty("avatarData");
    expect(out).not.toHaveProperty("otpCodeHash");
    expect(out).not.toHaveProperty("otpExpiresAt");
    expect(out.email).toBe("mook@example.com");
  });

  it("reports whether the account has a password", () => {
    expect(toSafeUser(base).hasPassword).toBe(true);
    expect(toSafeUser({ ...base, password: null }).hasPassword).toBe(false);
  });

  it("builds avatarUrl only when an avatar exists", () => {
    expect(toSafeUser(base).avatarUrl).toBeNull();
    const updated = new Date("2026-02-02T00:00:00Z");
    const out = toSafeUser({ ...base, avatarMimeType: "image/png", avatarUpdatedAt: updated });
    expect(out.avatarUrl).toBe(`/api/auth/u1/avatar?v=${updated.getTime()}`);
  });

  it("always returns hiddenFields as an array", () => {
    expect(toSafeUser({ ...base, hiddenFields: null }).hiddenFields).toEqual([]);
    expect(toSafeUser({ ...base, hiddenFields: ["bio"] }).hiddenFields).toEqual(["bio"]);
  });
});

describe("toPublicUser", () => {
  it("returns falsy input as-is", () => {
    expect(toPublicUser(null)).toBeNull();
    expect(toPublicUser(undefined)).toBeUndefined();
  });

  it("never leaks email, password or raw avatar even from a full row", () => {
    const out = toPublicUser({ ...base, provider: "local" });
    expect(out).toEqual(
      expect.objectContaining({ id: "u1", username: "mook", name: "Mook", orgType: "university", orgName: "KU", bio: "hello" })
    );
    ["email", "password", "avatarData", "otpCodeHash", "provider"].forEach((k) => expect(out).not.toHaveProperty(k));
    expect(out.activityVisible).toBe(true);
  });

  it("respects hidden fields", () => {
    const out = toPublicUser({ ...base, hiddenFields: ["org", "bio", "activity"] });
    expect(out).not.toHaveProperty("orgType");
    expect(out).not.toHaveProperty("orgName");
    expect(out).not.toHaveProperty("bio");
    expect(out.activityVisible).toBe(false);
  });

  it("builds the avatar url for other people too", () => {
    const updated = new Date("2026-03-03T00:00:00Z");
    const out = toPublicUser({ ...base, avatarMimeType: "image/webp", avatarUpdatedAt: updated });
    expect(out.avatarUrl).toBe(`/api/auth/u1/avatar?v=${updated.getTime()}`);
  });
});

describe("selects", () => {
  it("never select the raw avatar bytes or OTP data", () => {
    [SAFE_SELECT, PUBLIC_USER_SELECT].forEach((sel) => {
      expect(sel).not.toHaveProperty("avatarData");
      expect(sel).not.toHaveProperty("otpCodeHash");
    });
    expect(PUBLIC_USER_SELECT).not.toHaveProperty("email");
    expect(PUBLIC_USER_SELECT).not.toHaveProperty("password");
  });

  it("lists the hidable profile fields", () => {
    expect(HIDABLE_FIELDS).toEqual(["org", "bio", "activity"]);
  });
});
