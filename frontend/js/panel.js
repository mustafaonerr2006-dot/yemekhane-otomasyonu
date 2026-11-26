import { alan, api, bildirim, dugum, eylem, input, sec, tablo, tl } from './araclar.js';
import { yonetimEkrani } from './yonetim.js';

const roller = { ogrenci: 'Öğrenci', personel: 'Personel', yonetici: 'Yönetici' };
const durumlar = { aktif: 'Aktif', kullanildi: 'Kullanıldı', iptal: 'İptal' };
const tarih = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' });
const form = document.querySelector('#giris-formu');
let kisi, sozluk;
let son = 0;
const icerik = document.querySelector('#icerik');

function bakiye(value) {
  document.querySelector('#kalan').textContent = tl(value);
}

function oturum(acik) {
  document.querySelector('#hesap').hidden = document.querySelector('#panel').hidden = !acik;
  document.querySelector('#giris').hidden = acik;
  document.querySelector('#yonetim').hidden = kisi?.rol !== 'yonetici';
  if (acik) {
    document.querySelector('#kisi').textContent = `${kisi.ad} ${kisi.soyad} · ${roller[kisi.rol]}`;
    bakiye(kisi.bakiye);
  }
}

function bos(hedef, yazi) {
  hedef.replaceChildren(dugum('p',yazi,'kutu'));
}

async function menuler(hedef, hafta) {
  const yer = sec('yer',sozluk.yerler.map(x=>[x.id,x.ad]));
  const ogun = sec('ogun',sozluk.ogunler.map(x=>[x.id,x.ad]),2);
  const gun = input('gun','date',tarih.format(new Date()));
  const filtre = dugum('div',null,'kutu filtre');
  filtre.append(alan('Yemekhane',yer),hafta ? alan('Haftanın başlangıcı',gun) : alan('Öğün',ogun));
  const cikti = dugum('div',null,hafta ? 'kartlar' : '');
  hedef.append(filtre,cikti);
  let sira = 0;

  async function yukle() {
    const istek = ++sira;
    const param = new URLSearchParams(hafta ? { yer: yer.value, gun: gun.value } : { yer: yer.value, ogun: ogun.value });
    const sonuc = await api(`/menu/${hafta ? 'hafta' : 'gun'}?${param}`);
    if (istek !== sira) return;
    if (hafta && sonuc.length) cikti.replaceChildren(...sonuc.map(haftaKarti));
    else if (!hafta && sonuc.menu) cikti.replaceChildren(gunKarti(sonuc.menu));
    else bos(cikti,'Seçilen aralıkta menü bulunamadı.');
  }
  filtre.addEventListener('change', () => yukle().catch(e => bildirim(e.message,true)));
  await yukle();
}

function gunKarti(menu) {
  const kutu = dugum('article',null,'kutu');
  kutu.append(dugum('h2',`${menu.yemekhane} · ${menu.ogun}`),dugum('p',`${menu.tarih} · Toplam ${menu.kalori} kcal`));
  const liste = dugum('ul',null,'liste');
  for (const y of menu.yemekler) {
    const satir = dugum('li');
    satir.append(dugum('strong',`${y.yemek} · ${y.kalori} kcal`),
      dugum('div',`${y.kategori} · ${y.vejetaryen ? 'Vejetaryen' : 'Vejetaryen değil'} · ${y.alerjenler || 'Alerjen kaydı yok'}`,'kucuk'));
    if (y.uyarilar.length) satir.append(dugum('div',`Alerjen uyarısı: ${y.uyarilar.join(', ')}`,'uyari'));
    liste.append(satir);
  }
  kutu.append(liste);
  return kutu;
}

function haftaKarti(m) {
  const kutu = dugum('article',null,'kutu');
  const yer = dugum('p',`${m.bos_yer} boş yer · Son saat ${m.rezervasyon_son.slice(11,16)}`,'kucuk');
  const secimler = [['tam',`Tam · ${tl(m.fiyat)}`]];
  if (m.yarim != null) secimler.push(['yarim',`Yarım · ${tl(m.yarim)}`]);
  const porsiyon = sec('porsiyon',secimler);
  const dugme = dugum('button',m.durum === 'aktif' ? 'Ayrıldı' : m.durum === 'kullanildi' ? 'Kullanıldı' :
    m.musait ? 'Yer ayır' : 'Rezervasyona kapalı');
  dugme.disabled = porsiyon.disabled = !m.musait;
  eylem(dugme,'click',async () => {
    dugme.disabled = true;
    try {
      const r = await api('/rezervasyon','POST',{ menu: m.menu_id, porsiyon: porsiyon.value });
      bakiye(r.bakiye);
      porsiyon.disabled = true;
      dugme.textContent = 'Ayrıldı';
      yer.textContent = `${r.bos_yer} boş yer`;
      bildirim(`Rezervasyon oluşturuldu. Ücret ${tl(r.ucret)}.`);
    } catch (e) { dugme.disabled = false; throw e; }
  });
  kutu.append(dugum('h2',`${m.ogun} · ${m.tarih}`),yer);
  if (m.yemekler) kutu.append(dugum('p',m.yemekler,'kucuk'));
  if (m.uyarilar) kutu.append(dugum('p',`Alerjen uyarısı: ${m.uyarilar}`,'uyari'));
  kutu.append(alan('Porsiyon',porsiyon),dugme);
  return kutu;
}

async function rezervasyon(hedef) {
  const satirlar = await api('/rezervasyon');
  if (!satirlar.length) return bos(hedef,'Rezervasyon kaydı bulunamadı.');
  hedef.append(tablo(['Tarih','Yemekhane','Öğün','Porsiyon','Ücret','Durum','İşlem'],
    satirlar.map(r => {
      const durum = dugum('span',durumlar[r.durum]);
      const dugme = dugum('button','İptal');
      dugme.hidden = !r.iptal;
      eylem(dugme,'click',async () => {
        dugme.disabled = true;
        try {
          const sonuc = await api('/rezervasyon/' + r.id,'DELETE');
          dugme.hidden = true;
          durum.textContent = 'İptal';
          bakiye(sonuc.bakiye);
          bildirim(`İade edilen tutar ${tl(sonuc.iade)}.`);
        } finally { dugme.disabled = false; }
      });
      return [r.tarih,r.yemekhane,r.ogun,r.porsiyon === 'tam' ? 'Tam' : 'Yarım',tl(r.ucret),durum,dugme];
    })));
}

async function bakiyeEkrani(hedef) {
  const form = dugum('form',null,'kutu');
  const tutar = input('tutar','number');
  Object.assign(tutar, { min: 10, max: 1000, step: '.01' });
  const dugme = dugum('button','Bakiye yükle');
  const bakiyeMetni = dugum('strong');
  const kayitlar = dugum('div');
  form.append(bakiyeMetni,alan('Yüklenecek tutar (TL)',tutar),dugme);
  hedef.append(form,kayitlar);
  async function yenile() {
    const r = await api('/bakiye');
    bakiyeMetni.textContent = `Güncel bakiye ${tl(r.bakiye)}`;
    bakiye(r.bakiye);
    const adlar = { yukleme:'Yükleme', iade:'İade', rezervasyon:'Rezervasyon' };
    kayitlar.replaceChildren(tablo(['Zaman','Tür','Tutar','Açıklama'],
      r.hareketler.map(h=>[h.olusturma,adlar[h.tur],tl(h.tutar),h.aciklama])));
  }
  eylem(form,'submit',async () => {
    dugme.disabled = true;
    try {
      const sonuc = await api('/bakiye','POST',{ tutar:tutar.value });
      bakiye(sonuc.bakiye);
      form.reset();
      bildirim('Bakiye yüklendi.');
      await yenile();
    } finally { dugme.disabled = false; }
  });
  await yenile();
}

async function puanEkrani(hedef) {
  const kayitlar = await api('/puan');
  if (!kayitlar.length) return bos(hedef,'Değerlendirilebilecek kullanılmış rezervasyon yok.');
  for (const m of kayitlar) {
    const kutu = dugum('article',null,'kutu');
    kutu.append(dugum('h2',`${m.tarih} · ${m.yemekhane} · ${m.ogun}`));
    const puaniGoster = (puan,yazi) => {
      kutu.querySelector('form')?.remove();
      kutu.append(dugum('p',`Puanınız ${puan}/5`));
      if (yazi) kutu.append(dugum('p',yazi));
    };
    if (m.puan) puaniGoster(m.puan,m.yorum);
    else {
      const form = dugum('form');
      const puan = sec('puan',[1,2,3,4,5].map(n=>[n,n]),5);
      const yorum = dugum('textarea');
      yorum.maxLength = 500;
      yorum.rows = 2;
      const dugme = dugum('button','Değerlendir');
      form.append(alan('Puan',puan),alan('Yorum (isteğe bağlı)',yorum),dugme);
      eylem(form,'submit',async () => {
        dugme.disabled = true;
        try {
          const r = await api('/puan','POST',{ menu:m.menu_id, puan:puan.value, yorum:yorum.value });
          puaniGoster(puan.value,yorum.value);
          bildirim(r.mesaj);
        } catch (e) { dugme.disabled = false; throw e; }
      });
      kutu.append(form);
    }
    hedef.append(kutu);
  }
}

async function profil(hedef) {
  const form = dugum('form',null,'kutu');
  const secimler = dugum('div',null,'secimler');
  const dugme = dugum('button','Alerjenleri kaydet');
  function goster(alerjenler) {
    secimler.replaceChildren(...alerjenler.map(a => {
      const kutu = dugum('input');
      Object.assign(kutu,{ type:'checkbox',name:'alerjen',value:a.id,checked:Boolean(a.secili) });
      const etiket = dugum('label');
      etiket.append(kutu,a.ad);
      return etiket;
    }));
  }
  goster(await api('/profil'));
  form.append(dugum('p','Menülerde uyarı almak istediğiniz alerjenleri seçin.'),secimler,dugme);
  hedef.append(form);
  eylem(form,'submit',async () => {
    dugme.disabled = true;
    try {
      const secili = new FormData(form).getAll('alerjen');
      goster(await api('/profil','PUT',{ alerjenler:secili }));
      bildirim('Alerjen seçiminiz kaydedildi.');
    } finally { dugme.disabled = false; }
  });
}

const ekranlar = {
  gun: ['Günün menüsü',h=>menuler(h,false)],
  hafta: ['Haftalık menü',h=>menuler(h,true)],
  rezervasyon: ['Rezervasyonlarım',rezervasyon],
  bakiye: ['Bakiye hesabı',bakiyeEkrani],
  puan: ['Değerlendirme',puanEkrani],
  profil: ['Alerjen profili',profil],
  yonetim: ['Yönetim',h=>yonetimEkrani(h,sozluk)],
};

async function ekran() {
  if (!kisi) return;
  const istek = ++son;
  bildirim('');
  let sayfa = location.hash.slice(1);
  if (!Object.hasOwn(ekranlar,sayfa) || (sayfa === 'yonetim' && kisi.rol !== 'yonetici')) sayfa = 'gun';
  for (const a of document.querySelectorAll('nav a')) {
    if (a.hash === '#' + sayfa) a.setAttribute('aria-current','page');
    else a.removeAttribute('aria-current');
  }
  const [baslik, goster] = ekranlar[sayfa];
  const h = dugum('h1',baslik);
  h.id = 'ekran-basligi';
  const hedef = dugum('div');
  icerik.replaceChildren(h,hedef);
  try { await goster(hedef); }
  catch (e) { if (istek === son) bildirim(e.message,true); }
}

async function ac() {
  [kisi,sozluk] = await Promise.all([api('/oturum'),api('/secenekler')]);
  oturum(true);
  await ekran();
}

eylem(form,'submit',async () => {
  const dugme = form.querySelector('button');
  dugme.disabled = true;
  try {
    await api('/oturum','POST',Object.fromEntries(new FormData(form)));
    form.reset();
    await ac();
  } finally { dugme.disabled = false; }
});
eylem(document.querySelector('#cikis'),'click',async () => {
  await api('/oturum','DELETE');
  kisi = null;
  location.hash = '';
  icerik.replaceChildren();
  bildirim('');
  oturum(false);
});
window.addEventListener('hashchange',ekran);
ac().catch(e=>{ if (e.durum !== 401) bildirim(e.message,true); });
