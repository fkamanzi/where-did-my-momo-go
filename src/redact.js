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

  function redactText(text) {
    let out = String(text);
    // phone numbers, account, meter and transaction ids (6+ digits)
    out = out.replace(/\+?\d[\d ]{5,}\d/g, m => (/^\d{1,3}([ ,]\d{3})+$/.test(m.trim()) ? m : token(m.replace(/\s/g, ''), 'number')));
    // capitalised name sequences after to/from/agent
    out = out.replace(/\b(to|from|agent|by)\s+([A-Z][A-Za-z'’.-]+(?:\s+[A-Z][A-Za-z'’.-]+){0,3})/g,
      (_, w, name) => `${w} ${token(name, 'person')}`);
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
