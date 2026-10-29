require("./helpers/env");

jest.mock("../src/lib/prisma", () => require("./helpers/prismaMock"));

const prisma = require("../src/lib/prisma");
const passport = require("../src/lib/passport");

const verify = (name, profile) =>
  new Promise((resolve) => {
    const strategy = passport._strategy(name);
    strategy._verify("access", "refresh", profile, (err, user) => resolve({ err, user }));
  });

beforeEach(() => {
  prisma.__reset();
  jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe("passport strategies", () => {
  it("registers all configured providers", () => {
    expect([...passport.configuredProviders].sort()).toEqual(["facebook", "github", "google"]);
  });

  it("returns the existing user for a known provider id", async () => {
    prisma.user.findFirst.mockResolvedValue({ id: "u1" });
    const { user } = await verify("google", { id: "g1", displayName: "Ann", emails: [{ value: "a@b.co" }] });
    expect(user.id).toBe("u1");
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it("links a social login to an existing account with the same email", async () => {
    prisma.user.findFirst.mockResolvedValue(null);
    prisma.user.findUnique.mockResolvedValue({ id: "u2" });
    prisma.user.update.mockResolvedValue({ id: "u2", provider: "google" });
    const { user } = await verify("google", { id: "g1", emails: [{ value: "a@b.co" }] });
    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: "u2" }, data: { provider: "google", providerId: "g1", emailVerified: true } });
    expect(user.id).toBe("u2");
  });

  it("creates a new verified user, using a placeholder email when the provider gives none", async () => {
    prisma.user.findFirst.mockResolvedValue(null);
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockImplementation(async ({ data }) => ({ id: "new", ...data }));
    const { user } = await verify("github", { id: "42", username: "octo" });
    expect(user).toMatchObject({ name: "octo", email: "github_42@no-email.crewspace.local", emailVerified: true });

    const withEmail = await verify("facebook", { id: "7", displayName: "Fay", emails: [{ value: "f@b.co" }] });
    expect(withEmail.user.email).toBe("f@b.co");

    const nameless = await verify("google", { id: "8", emails: [{ value: "n@b.co" }] });
    expect(nameless.user.name).toBe("ผู้ใช้ใหม่");
  });

  it("passes database errors to done()", async () => {
    prisma.user.findFirst.mockRejectedValue(new Error("db"));
    for (const name of ["google", "facebook", "github"]) {
      const { err } = await verify(name, { id: "1" });
      expect(err.message).toBe("db");
    }
  });
});

describe("passport without optional providers", () => {
  it("only registers google", () => {
    jest.isolateModules(() => {
      delete process.env.FACEBOOK_APP_ID;
      delete process.env.GITHUB_CLIENT_ID;
      const p = require("../src/lib/passport");
      expect([...p.configuredProviders]).toEqual(["google"]);
    });
  });
});
