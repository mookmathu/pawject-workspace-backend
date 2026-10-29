// Minimal Express-like req/res doubles for calling controllers directly.
function mockRes() {
  const res = {};
  res.statusCode = 200;
  res.body = undefined;
  res.status = jest.fn((code) => {
    res.statusCode = code;
    return res;
  });
  res.json = jest.fn((body) => {
    res.body = body;
    return res;
  });
  res.send = jest.fn(() => res);
  res.cookie = jest.fn(() => res);
  res.clearCookie = jest.fn(() => res);
  res.redirect = jest.fn(() => res);
  res.setHeader = jest.fn(() => res);
  return res;
}

function mockReq(over = {}) {
  return { userId: "u1", params: {}, query: {}, body: {}, headers: {}, ...over };
}

// Silence the controllers' own console.error noise in the error-path tests.
function silenceErrors() {
  return jest.spyOn(console, "error").mockImplementation(() => {});
}

module.exports = { mockRes, mockReq, silenceErrors };
