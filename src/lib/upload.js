const multer = require("multer");

// Avatars are stored in the database (User.avatarData), so multer just
// needs to hold the uploaded file in memory long enough for the controller
// to write its bytes into the row — nothing touches disk anymore.
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

const uploadAvatar = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SIZE_BYTES },
  fileFilter(req, file, cb) {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      return cb(new Error("รองรับเฉพาะไฟล์รูปภาพ (jpg, png, webp, gif)"));
    }
    cb(null, true);
  },
});

// Chat attachments — same in-memory pattern (stored as Message.attachmentData
// instead of on disk), but a wider set of allowed types since people share
// documents in a group chat, not just photos, plus a bigger size cap.
const ATTACHMENT_ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/zip",
  "text/plain",
]);
const ATTACHMENT_MAX_SIZE_BYTES = 15 * 1024 * 1024; // 15MB

const uploadChatAttachment = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: ATTACHMENT_MAX_SIZE_BYTES },
  fileFilter(req, file, cb) {
    if (!ATTACHMENT_ALLOWED_MIME.has(file.mimetype)) {
      return cb(new Error("ไม่รองรับไฟล์ประเภทนี้"));
    }
    cb(null, true);
  },
});

module.exports = { uploadAvatar, uploadChatAttachment };
