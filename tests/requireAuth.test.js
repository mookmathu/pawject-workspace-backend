jest.mock("../src/lib/activity", () => ({ recordActivity: jest.fn() }));

const jwt = require("jsonwebtoken");
const { recordActivity } = require("../src/lib/activity");
const requireAuth = require("../src/middleware/requireAuth");

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

beforeEach(() => {
  process.env.JWT_SECRET = "test-secret";
  jest.clearAllMocks();
});

describe("requireAuth", () => {
  it("rejects a request with no Authorization header", () => {
    const res = mockRes();
    const next = jest.fn();
    requireAuth({ headers: {} }, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects a header that is not a Bearer token", () => {
    const res = mockRes();
    const next = jest.fn();
    requireAuth({ headers: { authorization: "Basic abc" } }, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects an invalid token", () => {
    const res = mockRes();
    const next = jest.fn();
    requireAuth({ headers: { authorization: "Bearer not-a-jwt" } }, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects a token signed with another secret", () => {
    const token = jwt.sign({ sub: "u1" }, "other-secret");
    const res = mockRes();
    const next = jest.fn();
    requireAuth({ headers: { authorization: `Bearer ${token}` } }, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects an expired token", () => {
    const token = jwt.sign({ sub: "u1" }, "test-secret", { expiresIn: -10 });
    const res = mockRes();
    const next = jest.fn();
    requireAuth({ headers: { authorization: `Bearer ${token}` } }, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("accepts a valid token, sets req.userId and records activity", () => {
    const token = jwt.sign({ sub: "u1" }, "test-secret");
    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = mockRes();
    const next = jest.fn();
    requireAuth(req, res, next);
    expect(req.userId).toBe("u1");
    expect(recordActivity).toHaveBeenCalledWith("u1");
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });
});
