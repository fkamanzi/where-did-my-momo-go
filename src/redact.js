// Before any text leaves the device, names, phone numbers and IDs are
// replaced with stable pseudonyms. The map stays in the browser, so cloud
// answers can be mapped back to real names locally.

export function createRedactor() {
  const forward = new Map();   // real -> token
  const back = new Map();      // token -> real
  let people = 0, numbers = 0;

  function token(real, kind) {
    const key = real.toLowerCase();
    if (forward.has(key)) return forward.get(key);
    const t = kind === 'person' ? `Person-${String.fromCharCode(65 + (people++ % 26))}${people > 26 ? people : ''}`
                                : `#${++numbers}`;
    forward.set(key, t);
    back.set(t, real);
    return t;
  }

  // A name: capitalised words, allowing particles such as "de" or "van" inside.
  const NAME = String.raw`[A-Z][A-Za-z'’.-]+(?:\s+(?:(?:de|du|des|la|le|van|von|bin|wa)\s+)?[A-Z][A-Za-z'’.-]+){0,4}`;
  const isToken = s => /^Person-[A-Z]\d*$/.test(s);

  function redactText(text) {
    let out = String(text);
    // phone numbers, account, meter and transaction ids (6+ digits)
    out = out.replace(/\+?\d[\d ]{5,}\d/g, m => (/^\d{1,3}([ ,]\d{3})+$/.test(m.trim()) ? m : token(m.replace(/\s/g, ''), 'number')));
    // names after to/from/agent/by, and the French, Kinyarwanda and Swahili equivalents
    out = out.replace(new RegExp(String.raw`\b(to|from|agent|by|à|de|par|vers|kuri|kwa|kutoka)\s+(${NAME})`, 'g'),
      (m, w, name) => (isToken(name) ? m : `${w} ${token(name, 'person')}`));
    // any remaining name written just before a masked number, as in "Name (#1)"
    out = out.replace(new RegExp(String.raw`(${NAME})(\s*\(#\d+\))`, 'g'),
      (m, name, num) => (isToken(name) ? m : `${token(name, 'person')}${num}`));
    return out;
  }

  function redactParty(name) {
    return name ? token(name, 'person') : name;
  }

  function restore(text) {
    let out = String(text);
    for (const [t, real] of back) out = out.split(t).join(real);
    return out;
  }

  return { redactText, redactParty, restore, size: () => back.size };
}
