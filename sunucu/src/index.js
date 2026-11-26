import express from 'express';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { createClient } from 'redis';
import * as veri from './veri.js';

const redis = createClient({
  socket: { host: process.env.REDIS_HOST, port: Number(process.env.REDIS_PORT) },
  disableOfflineQueue: true,
});
redis.on('error', e => console.error('Redis bağlantısı:', e.code ?? e.name));
await redis.connect();

const app = express();
app.disable('x-powered-by');
app.use('/api', express.json({ limit: '16kb' }));
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  // Çapraz origin tarayıcı isteği özel başlığı CORS izni olmadan gönderemez.
  if (!['GET', 'HEAD'].includes(req.method) && req.get('X-Kampus') !== '1') {
    return res.status(403).json({ hata: 'İstek doğrulanamadı.' });
  }
  next();
});

const sure = 1800;
const cerez = { httpOnly: true, sameSite: 'lax', path: '/api' };
const tokenAl = req => /(?:^|;\s*)kampus=([\w-]{43})(?:;|$)/.exec(req.get('cookie') ?? '')?.[1];

function sorun(status, message) {
  throw Object.assign(new Error(message), { status });
}
function sayi(value, ad, max = 4294967295) {
  if (!['string','number'].includes(typeof value) || !/^\d+$/.test(String(value))) sorun(400, ad + ' geçersiz.');
  const n = Number(value);
  if (n < 1 || n > max) sorun(400, ad + ' geçersiz.');
  return n;
}
function tarih(value) {
  const gun = /^\d{4}-\d\d-\d\d$/.test(value ?? '') ? new Date(value + 'T00:00:00Z') : null;
  if (!gun || !Number.isFinite(+gun) || gun.toISOString().slice(0,10) !== value || value < '1000-01-01') {
    sorun(400, 'Tarih geçersiz.');
  }
  return value;
}
function para(value) {
  if (!['string','number'].includes(typeof value) || !/^\d{1,6}(\.\d{1,2})?$/.test(String(value))) {
    sorun(400, 'Tutar geçersiz.');
  }
  return String(value);
}
function liste(value, ad, max) {
  if (!Array.isArray(value) || value.length > 100) sorun(400, ad + ' listesi geçersiz.');
  return [...new Set(value.map(v => sayi(v, ad, max)))];
}
function bugun() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(new Date());
}

function redisKullan(gorev) {
  if (!redis.isReady) sorun(503, 'Redis hazır değil.');
  return gorev();
}

app.get('/api/durum', async (req, res) => {
  const [durum, cache] = await Promise.all([
    veri.sunucuDurumu(),
    redisKullan(() => redis.ping()),
  ]);
  res.json({ ...durum, redis: cache });
});

app.post('/api/oturum', async (req, res) => {
  const { eposta, sifre } = req.body ?? {};
  if (typeof eposta !== 'string' || typeof sifre !== 'string' || !eposta.trim() ||
      eposta.length > 120 || Buffer.byteLength(sifre) > 72) sorun(400, 'E-posta ve şifre girin.');
  const hesap = await veri.hesap(eposta.trim().toLowerCase());
  if (!hesap || !await bcrypt.compare(sifre, hesap.sifre_hash)) sorun(401, 'E-posta veya şifre yanlış.');
  const token = randomBytes(32).toString('base64url');
  const eski = tokenAl(req);
  if (eski) await redisKullan(() => redis.del('oturum:' + eski));
  await redisKullan(() => redis.set('oturum:' + token, String(hesap.id), { EX: sure }));
  res.cookie('kampus', token, { ...cerez, maxAge: sure * 1000 }).json({ mesaj: 'Giriş yapıldı.' });
});

app.delete('/api/oturum', async (req, res) => {
  const token = tokenAl(req);
  if (token) await redisKullan(() => redis.del('oturum:' + token));
  res.clearCookie('kampus', cerez).json({ mesaj: 'Oturum kapandı.' });
});

app.use('/api', async (req, res, next) => {
  const token = tokenAl(req);
  const id = token && await redisKullan(() => redis.getEx('oturum:' + token, { EX: sure }));
  if (!id) sorun(401, 'Giriş yapın.');
  req.kisi = await veri.kullanici(Number(id));
  if (!req.kisi) sorun(401, 'Hesap etkin değil.');
  res.cookie('kampus', token, { ...cerez, maxAge: sure * 1000 });
  next();
});

app.get('/api/oturum', (req, res) => res.json(req.kisi));
app.get('/api/secenekler', async (req, res) => res.json(await veri.sozlukler()));

let sira = Promise.resolve();
function menuIslemi(gorev) {
  const sonuc = sira.then(gorev);
  sira = sonuc.catch(() => {});
  return sonuc;
}
const menuAnahtari = (yer, gun, ogun) => `menu:${yer}:${gun}:${ogun}`;

app.get('/api/menu/gun', async (req, res) => {
  const yer = sayi(req.query.yer, 'Yemekhane', 255);
  const ogun = sayi(req.query.ogun, 'Öğün', 255);
  const gun = bugun();
  const anahtar = menuAnahtari(yer, gun, ogun);
  const menu = await menuIslemi(async () => {
    const ham = await redisKullan(() => redis.get(anahtar));
    if (ham) {
      console.info('CACHE HIT', anahtar);
      return JSON.parse(ham);
    }
    console.info('CACHE MISS', anahtar);
    if (!await veri.guncelReplika()) sorun(503, 'Menü replikaya ulaşıyor. Tekrar deneyin.');
    const kayit = await veri.gunluk(yer, gun, ogun);
    if (kayit && bugun() === gun) {
      const bitis = new Date(gun + 'T00:00:00+03:00').getTime() + 86400000;
      await redisKullan(() => redis.set(anahtar, JSON.stringify(kayit), { EXAT: Math.floor(bitis / 1000) }));
    }
    return kayit;
  });
  if (menu) {
    const secimler = (await veri.profil(req.kisi.id)).filter(a => a.secili);
    for (const yemek of menu.yemekler) {
      const ids = (yemek.alerjen_idler ?? '').split(',').map(Number);
      yemek.uyarilar = secimler.filter(a => ids.includes(a.id)).map(a => a.ad);
    }
  }
  res.json({ menu });
});

app.get('/api/menu/hafta', async (req, res) => {
  const yer = sayi(req.query.yer, 'Yemekhane', 255);
  const gun = req.query.gun ? tarih(req.query.gun) : bugun();
  res.json(await veri.hafta(yer, gun, req.kisi));
});

app.get('/api/rezervasyon', async (req, res) => res.json(await veri.rezervasyonlar(req.kisi.id)));
app.post('/api/rezervasyon', async (req, res) => {
  const porsiyon = req.body?.porsiyon ?? 'tam';
  if (!['tam','yarim'].includes(porsiyon)) sorun(400, 'Porsiyon geçersiz.');
  const menu = sayi(req.body?.menu, 'Menü');
  res.status(201).json(await veri.ayirt(req.kisi.id, menu, porsiyon));
});
app.delete('/api/rezervasyon/:id', async (req, res) => {
  res.json(await veri.iptal(req.kisi.id, sayi(req.params.id, 'Rezervasyon')));
});
app.get('/api/bakiye', async (req, res) => {
  res.json({ bakiye: req.kisi.bakiye, hareketler: await veri.hareketler(req.kisi.id) });
});
app.post('/api/bakiye', async (req, res) => res.status(201).json(await veri.yukle(req.kisi.id, para(req.body?.tutar))));
app.get('/api/puan', async (req, res) => res.json(await veri.yorumlar(req.kisi.id)));
app.post('/api/puan', async (req, res) => {
  const { menu, puan, yorum = '' } = req.body ?? {};
  if (typeof yorum !== 'string' || yorum.length > 500) sorun(400, 'Yorum en fazla 500 karakter olabilir.');
  const yazildi = await veri.oyVer(req.kisi.id, sayi(menu,'Menü'), sayi(puan,'Puan',5), yorum.trim() || null);
  if (!yazildi) sorun(400, 'Önce bu menüdeki rezervasyonunuzu kullanmanız gerekiyor.');
  res.status(201).json({ mesaj: 'Değerlendirme kaydedildi.' });
});

app.get('/api/profil', async (req, res) => res.json(await veri.profil(req.kisi.id)));
app.put('/api/profil', async (req, res) => {
  await veri.profilYaz(req.kisi.id, liste(req.body?.alerjenler, 'Alerjen', 255));
  res.json(await veri.profil(req.kisi.id));
});

app.use('/api/yonetim', (req, res, next) => {
  if (req.kisi.rol !== 'yonetici') sorun(403, 'Yönetici yetkisi gerekiyor.');
  next();
});
app.get('/api/yonetim', async (req, res) => res.json(await veri.yonetim()));

async function menuDegistir(req, res) {
  const id = req.params.id ? sayi(req.params.id, 'Menü') : null;
  const { ogrenci, personel, yemekler, gun, yer, ogun } = req.body ?? {};
  const menu = { ogrenci: para(ogrenci), personel: para(personel), yemekler: liste(yemekler,'Yemek',65535) };
  if (!menu.yemekler.length) sorun(400, 'En az bir yemek seçin.');
  const ana = id ? await veri.menuBilgisi(id) : {
    tarih: tarih(gun), yemekhane_id: sayi(yer, 'Yemekhane',255), ogun_id: sayi(ogun,'Öğün',255),
  };
  if (!ana) sorun(404, 'Menü bulunamadı.');
  const anahtar = menuAnahtari(ana.yemekhane_id, ana.tarih, ana.ogun_id);
  const menuId = await menuIslemi(async () => {
    // Yazma ve günlük cache okumaları aynı sırada. Redis silme başarısızsa yazma başlamaz.
    await redisKullan(() => redis.del(anahtar));
    const kayit = await veri.menuYaz(id, { ...menu, ...ana });
    console.info('CACHE DELETE', anahtar);
    return kayit;
  });
  res.status(id ? 200 : 201).json({ menu_id: menuId, mesaj: 'Menü kaydedildi.' });
}
app.post('/api/yonetim/menu', menuDegistir);
app.put('/api/yonetim/menu/:id', menuDegistir);

app.use('/api', (req, res) => res.status(404).json({ hata: 'İstek bulunamadı.' }));
app.use((err, req, res, next) => {
  if (err.sqlState === '45000') return res.status(400).json({ hata: err.sqlMessage });
  if (err.errno === 1062) return res.status(400).json({ hata: 'Bu kayıt zaten var.' });
  if (err.errno === 1452) return res.status(400).json({ hata: 'Seçilen kayıt mevcut değil.' });
  if (err.status < 500 || err.status === 503) {
    return res.status(err.status).json({ hata: err.type === 'entity.parse.failed' ? 'Geçersiz JSON.' : err.message });
  }
  console.error('API hatası:', err.code ?? err.name);
  res.status(500).json({ hata: 'İşlem tamamlanamadı.' });
});
app.listen(8000, '0.0.0.0', () => console.log('Kampüs API çalışıyor.'));
