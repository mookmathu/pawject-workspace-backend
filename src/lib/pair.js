// Friendships and DM conversations store the two user ids in one fixed order
// (the smaller id first) so the same pair always maps to the same row no
// matter who asks. This is that ordering — a plain string comparison, which is
// exactly what Array.sort() did before, so existing rows keep matching.
function orderedPair(idA, idB) {
  return idA <= idB ? [idA, idB] : [idB, idA];
}

module.exports = { orderedPair };
