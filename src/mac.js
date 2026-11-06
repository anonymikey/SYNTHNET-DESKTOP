// MAC address parsing for devices that cannot open the sign-in page (smart TVs, consoles, streaming sticks).
// Accepts AA:BB:CC:DD:EE:FF, AA-BB-CC-DD-EE-FF, AABB.CCDD.EEFF or AABBCCDDEEFF (any case, spaces allowed) and returns the
// lower-case dash form the rest of the system uses ("aa-bb-cc-dd-ee-ff"), the same as the Windows ARP table.
function normMac(input) {
  const hex = String(input == null ? '' : input).trim().replace(/[\s:.\-]/g, '').toLowerCase();
  if (!/^[0-9a-f]{12}$/.test(hex)) return null;
  const first = parseInt(hex.slice(0, 2), 16);
  if (hex === '000000000000' || hex === 'ffffffffffff' || (first & 1)) return null;   // zero, broadcast, or a multicast address: never a real device
  return { mac: hex.match(/../g).join('-'), localAdmin: !!(first & 2) };                // localAdmin = a "private/random" address chosen by the device
}
module.exports = { normMac };
