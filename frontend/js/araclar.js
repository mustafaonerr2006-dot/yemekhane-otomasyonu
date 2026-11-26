export function dugum(tag, metin, sinif) {
  const el = document.createElement(tag);
  if (metin != null) el.textContent = metin;
  if (sinif) el.className = sinif;
  return el;
}

export function bildirim(metin, hata = false) {
  const alan = document.querySelector('#bildirim');
  alan.textContent = metin;
  alan.classList.toggle('hata', hata);
  alan.hidden = !metin;
}

export async function api(yol, method = 'GET', veri) {
  const headers = { 'X-Kampus': '1' };
  if (veri !== undefined) headers['Content-Type'] = 'application/json';
  const r = await fetch('/api' + yol, { method, headers, body: JSON.stringify(veri) });
  const sonuc = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(sonuc.hata || 'Sunucuya ulaşılamadı.'), { durum: r.status });
  return sonuc;
}

export const tl = value => new Intl.NumberFormat('tr-TR',{ style:'currency',currency:'TRY' }).format(value);

export function sec(adi, kayitlar, secili) {
  const s = dugum('select');
  s.name = adi;
  for (const [id, ad] of kayitlar) s.append(new Option(ad, id, false, String(id) === String(secili)));
  return s;
}

export function alan(ad, input) {
  const l = dugum('label',ad);
  l.append(input);
  return l;
}

export function input(name, type, value = '') {
  const i = dugum('input');
  Object.assign(i, { name, type, value, required: true });
  return i;
}

export function tablo(basliklar, veri) {
  const sarici = dugum('div',null,'tablo-sarici');
  const t = dugum('table');
  const baslik = t.createTHead().insertRow();
  for (const ad of basliklar) {
    const th = dugum('th',ad);
    th.scope = 'col';
    baslik.append(th);
  }
  const body = t.createTBody();
  for (const satir of veri) {
    const tr = body.insertRow();
    for (const v of satir) {
      const td = tr.insertCell();
      if (v instanceof Node) td.append(v);
      else td.textContent = v ?? '–';
    }
  }
  sarici.append(t);
  return sarici;
}

export function eylem(el, event, islem) {
  el.addEventListener(event, async e => {
    e.preventDefault();
    try { await islem(); }
    catch (hata) { bildirim(hata.message,true); }
  });
}
