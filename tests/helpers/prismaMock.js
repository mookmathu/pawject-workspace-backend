// A catch-all Prisma stand-in for controller tests: every `prisma.<model>.<method>`
// is a jest.fn() created on first use, so tests only stub what they need.
const models = {};

function modelProxy(name) {
  const methods = {};
  return new Proxy(
    {},
    {
      get(_t, method) {
        if (!methods[method]) methods[method] = jest.fn();
        return methods[method];
      },
    },
  );
}

const prisma = new Proxy(
  {},
  {
    get(_t, key) {
      // jest.resetAllMocks() wipes implementations, so re-apply on every access.
      if (key === "$transaction") return transaction.mockImplementation(runTransaction);
      if (key === "__reset") return reset;
      if (!models[key]) models[key] = modelProxy(key);
      return models[key];
    },
  },
);

async function runTransaction(arg) {
  if (typeof arg === "function") return arg(prisma);
  return Promise.all(arg);
}
const transaction = jest.fn();

function reset() {
  transaction.mockClear();
  for (const name of Object.keys(models)) delete models[name];
}

module.exports = prisma;
