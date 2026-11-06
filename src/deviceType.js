// Heuristic only: classifies a connecting device as 'mobile' (a phone) or 'other' (TV, laptop, console, tablet,
// unknown) from its HTTP User-Agent string. Used purely to enforce "one phone per package, plus one companion
// device." A phone can defeat this by spoofing its User-Agent to look like a laptop; this is a reasonable
// deterrent for ordinary use, not a security boundary.
function classify(ua) {
  const s = String(ua || '').toLowerCase();
  if (!s) return 'other';
  // Smart TVs / streaming boxes first: several report "Android" in their UA too, so this must be checked before
  // the generic Android-phone check below, or a TV would be wrongly classified as a phone.
  if (/smart-?tv|smarttv|tizen|webos|viera|netcast|hbbtv|appletv|googletv|google tv|crkey|roku|aft[a-z]?\b|android.*tv|bravia|philipstv/.test(s)) return 'other';
  if (/tablet|ipad/.test(s)) return 'other';                       // tablets grouped with TV/laptop, not "a phone"
  if (/mobi|iphone|ipod|android/.test(s)) return 'mobile';
  return 'other';                                                  // Windows/Mac/Linux desktops, game consoles, unknown
}
module.exports = { classify };
