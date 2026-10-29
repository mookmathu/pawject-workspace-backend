// Replace socket.io with a tiny fake that records handlers so we can drive them.
const mockHandlers = {};
const mockEmit = jest.fn();
const mockTo = jest.fn(() => ({ emit: mockEmit }));
let mockMiddleware;
let mockConnection;

jest.mock("socket.io", () => ({
  Server: jest.fn().mockImplementation(() => ({
    use: (fn) => {
      mockMiddleware = fn;
    },
    on: (ev, fn) => {
      if (ev === "connection") mockConnection = fn;
    },
    emit: mockEmit,
    to: mockTo,
  })),
}));

const jwt = require("jsonwebtoken");
process.env.JWT_SECRET = "s";
const { initSocket, emitToRoom, emitToUser } = require("../src/lib/socket");

function fakeSocket(userId) {
  const handlers = {};
  const roomEmit = jest.fn();
  return {
    userId,
    handlers,
    roomEmit,
    join: jest.fn(),
    leave: jest.fn(),
    on: (ev, fn) => {
      handlers[ev] = fn;
    },
    to: jest.fn(() => ({ emit: roomEmit })),
  };
}

describe("socket module before init", () => {
  it("emit helpers are no-ops", () => {
    expect(() => emitToRoom("r", "e", {})).not.toThrow();
    expect(() => emitToUser("u", "e", {})).not.toThrow();
    expect(mockTo).not.toHaveBeenCalled();
  });
});

describe("after init", () => {
  beforeAll(() => {
    initSocket({});
  });
  beforeEach(() => jest.clearAllMocks());

  it("authenticates the handshake token", () => {
    const next = jest.fn();
    mockMiddleware({ handshake: { auth: {} } }, next);
    expect(next.mock.calls[0][0].message).toBe("unauthorized");

    const bad = jest.fn();
    mockMiddleware({ handshake: { auth: { token: "nope" } } }, bad);
    expect(bad.mock.calls[0][0].message).toBe("unauthorized");

    const good = jest.fn();
    const socket = { handshake: { auth: { token: jwt.sign({ sub: "u1" }, "s") } } };
    mockMiddleware(socket, good);
    expect(good).toHaveBeenCalledWith();
    expect(socket.userId).toBe("u1");
  });

  it("emit helpers target the right rooms", () => {
    emitToRoom("room1", "msg", { a: 1 });
    expect(mockTo).toHaveBeenCalledWith("room1");
    emitToUser("u1", "n", { b: 2 });
    expect(mockTo).toHaveBeenCalledWith("user:u1");
  });

  it("tracks presence across several tabs", () => {
    const s1 = fakeSocket("p1");
    const s2 = fakeSocket("p1");
    mockConnection(s1);
    expect(s1.join).toHaveBeenCalledWith("user:p1");
    expect(mockEmit).toHaveBeenCalledWith("presence:update", { userId: "p1", online: true });

    mockEmit.mockClear();
    mockConnection(s2);
    expect(mockEmit).not.toHaveBeenCalled();

    const ack = jest.fn();
    s1.handlers["presence:list"](ack);
    expect(ack).toHaveBeenCalledWith(expect.arrayContaining(["p1"]));
    s1.handlers["presence:list"]("not a function");

    s1.handlers.disconnect();
    expect(mockEmit).not.toHaveBeenCalled();
    s2.handlers.disconnect();
    expect(mockEmit).toHaveBeenCalledWith("presence:update", { userId: "p1", online: false });
  });

  it("joins/leaves only string rooms and relays typing", () => {
    const s = fakeSocket("p2");
    mockConnection(s);
    s.join.mockClear();
    s.handlers["room:join"]("r1");
    s.handlers["room:join"](5);
    expect(s.join).toHaveBeenCalledTimes(1);
    s.handlers["room:leave"]("r1");
    s.handlers["room:leave"](null);
    expect(s.leave).toHaveBeenCalledTimes(1);

    s.handlers.typing({ room: "r1", isTyping: 1 });
    expect(s.roomEmit).toHaveBeenCalledWith("typing", { userId: "p2", room: "r1", isTyping: true });
    s.handlers.typing({ room: 3 });
    s.handlers.typing();
    expect(s.roomEmit).toHaveBeenCalledTimes(1);
  });
});
