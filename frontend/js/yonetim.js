import { alan, api, bildirim, dugum, eylem, input, sec, tablo } from './araclar.js';

export async function yonetimEkrani(hedef, sozluk) {
  let { menuler, yemekler } = await api('/yonetim');
  const duzenlenecek = sec('menu',[['','Yeni menü'],...menuler.map(m=>[m.menu_id,`${m.tarih} · ${m.yemekhane} · ${m.ogun}`])]);
  const form = dugum('form',null,'kutu');
  const rapor = dugum('div');
  hedef.append(form,dugum('h2','Doluluk ve puanlar'),rapor);

  function raporuGoster() {
    rapor.replaceChildren(tablo(['Tarih','Yer','Öğün','Kapasite','Boş','Doluluk','Ortalama','Oy'],
      menuler.map(m=>[m.tarih,m.yemekhane,m.ogun,m.kapasite,m.bos_yer,`%${m.doluluk_yuzde}`,m.ortalama_puan,m.oy_sayisi])));
  }

  function formuGoster() {
    const m = menuler.find(m=>String(m.menu_id) === duzenlenecek.value);
    const gun = input('gun','date',m?.tarih ?? new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Istanbul'}).format(new Date()));
    const yer = sec('yer',sozluk.yerler.map(x=>[x.id,x.ad]),m?.yemekhane_id);
    const ogun = sec('ogun',sozluk.ogunler.map(x=>[x.id,x.ad]),m?.ogun_id);
    gun.disabled = yer.disabled = ogun.disabled = Boolean(m);
    const ogrenci = input('ogrenci','number',m?.ogrenci_fiyati ?? '');
    const personel = input('personel','number',m?.personel_fiyati ?? '');
    for (const i of [ogrenci,personel]) Object.assign(i,{min:0,max:999999.99,step:'.01'});
    const fiyat = dugum('div',null,'filtre');
    fiyat.append(alan('Öğrenci fiyatı',ogrenci),alan('Personel fiyatı',personel));
    const secimler = dugum('div',null,'secimler');
    for (const y of yemekler) {
      const kutu = dugum('input');
      Object.assign(kutu,{type:'checkbox',name:'yemek',value:y.id,checked:Boolean(m?.yemekler.includes(y.id))});
      const etiket = dugum('label');
      etiket.append(kutu,y.ad);
      secimler.append(etiket);
    }
    const dugme = dugum('button','Menüyü kaydet');
    form.replaceChildren(alan('İşlem',duzenlenecek),alan('Tarih',gun),alan('Yemekhane',yer),
      alan('Öğün',ogun),fiyat,dugum('h2','Yemekler'),secimler,dugme);
  }
  duzenlenecek.addEventListener('change',formuGoster);
  eylem(form,'submit',async () => {
    const id = duzenlenecek.value;
    const fd = new FormData(form);
    const veri = Object.fromEntries(fd);
    veri.yemekler = fd.getAll('yemek');
    const dugme = form.querySelector('button');
    dugme.disabled = true;
    try {
      const r = await api('/yonetim/menu'+(id ? '/'+id : ''),id ? 'PUT' : 'POST',veri);
      bildirim(r.mesaj);
      ({ menuler } = await api('/yonetim'));
      if (!id && menuler.some(m=>m.menu_id === r.menu_id)) {
        const m = menuler.find(m=>m.menu_id === r.menu_id);
        duzenlenecek.add(new Option(`${m.tarih} · ${m.yemekhane} · ${m.ogun}`,m.menu_id,false,true));
        formuGoster();
      }
      raporuGoster();
    } finally { dugme.disabled = false; }
  });
  formuGoster();
  raporuGoster();
}
