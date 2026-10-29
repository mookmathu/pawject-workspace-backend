jest.mock("multer", () => {
  const multer = jest.fn((opts) => ({ opts }));
  multer.memoryStorage = jest.fn(() => "memory");
  return multer;
});

const { uploadAvatar, uploadChatAttachment } = require("../src/lib/upload");

const run = (uploader, mimetype) => {
  const cb = jest.fn();
  uploader.opts.fileFilter({}, { mimetype }, cb);
  return cb.mock.calls[0];
};

describe("avatar upload", () => {
  it("stores in memory with a 5MB cap", () => {
    expect(uploadAvatar.opts.storage).toBe("memory");
    expect(uploadAvatar.opts.limits.fileSize).toBe(5 * 1024 * 1024);
  });
  it("accepts images only", () => {
    expect(run(uploadAvatar, "image/png")).toEqual([null, true]);
    expect(run(uploadAvatar, "image/webp")).toEqual([null, true]);
    expect(run(uploadAvatar, "application/pdf")[0]).toBeInstanceOf(Error);
    expect(run(uploadAvatar, "text/html")[0]).toBeInstanceOf(Error);
  });
});

describe("chat attachment upload", () => {
  it("has a larger cap", () => {
    expect(uploadChatAttachment.opts.limits.fileSize).toBeGreaterThan(uploadAvatar.opts.limits.fileSize);
  });
  it("accepts documents and images, rejects executables and html", () => {
    expect(run(uploadChatAttachment, "application/pdf")).toEqual([null, true]);
    expect(run(uploadChatAttachment, "image/gif")).toEqual([null, true]);
    expect(run(uploadChatAttachment, "text/plain")).toEqual([null, true]);
    expect(run(uploadChatAttachment, "application/x-msdownload")[0]).toBeInstanceOf(Error);
    expect(run(uploadChatAttachment, "text/html")[0]).toBeInstanceOf(Error);
    expect(run(uploadChatAttachment, "image/svg+xml")[0]).toBeInstanceOf(Error);
  });
});
