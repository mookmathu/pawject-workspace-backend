// Removes any trailing "/" from a URL. A loop instead of /\/+$/ — that regex
// backtracks super-linearly on long runs of slashes (Sonar S8786).
function trimTrailingSlash(url) {
  let end = url.length;
  while (end > 0 && url[end - 1] === "/") end--;
  return url.slice(0, end);
}

module.exports = { trimTrailingSlash };
