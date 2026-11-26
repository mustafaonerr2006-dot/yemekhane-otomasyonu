import mysql from 'mysql2/promise';

function havuz(host) {
  return mysql.createPool({
    host, port: Number(process.env.DB_PORT), database: process.env.DB_ADI,
    user: process.env.DB_KULLANICI, password: process.env.DB_SIFRE,
    charset: 'utf8mb4', dateStrings: true, connectionLimit: 5,
  });
}

const kaynak = havuz(process.env.DB_YAZMA_HOST);
const replika = havuz(process.env.DB_OKUMA_HOST);

async function satirlar(db, sql, args = []) {
  const [sonuc] = await db.execute(sql, args);
  return sonuc;
}

export async function hesap(eposta) {
  const [kisi] = await satirlar(kaynak,
    'SELECT id, sifre_hash FROM kullanicilar WHERE aktif=1 AND eposta=?', [eposta]);
  return kisi;
}

export async function kullanici(id) {
  const [kisi] = await satirlar(kaynak,
    'SELECT id, ad, soyad, rol, bakiye FROM kullanicilar WHERE aktif=1 AND id=?', [id]);
  return kisi;
}

export async function sozlukler() {
  const [yerler, ogunler] = await Promise.all([
    satirlar(replika, 'SELECT id, ad FROM yemekhaneler ORDER BY id'),
    satirlar(replika, 'SELECT id, ad FROM ogunler ORDER BY sira'),
  ]);
  return { yerler, ogunler };
}

export async function gunluk(yer, gun, ogun) {
  const [menu] = await satirlar(replika, `
    SELECT menu_id, tarih, yemekhane, ogun FROM v_menu_doluluk
    WHERE yemekhane_id=? AND tarih=? AND ogun_id=?`, [yer, gun, ogun]);
  if (!menu) return null;
  menu.yemekler = await satirlar(replika, `
    SELECT yemek_id, yemek, kategori, kalori, vejetaryen, alerjenler, alerjen_idler
    FROM v_menu_detay WHERE menu_id=? ORDER BY kategori_sira, yemek`, [menu.menu_id]);
  menu.kalori = menu.yemekler.reduce((toplam, y) => toplam + y.kalori, 0);
  return menu;
}

export function hafta(yer, ilkGun, k) {
  return satirlar(replika, `
    SELECT d.*, IF(?='ogrenci',m.ogrenci_fiyati,m.personel_fiyati) AS fiyat,
      IF(d.ogun_id IN (2,3),ROUND(IF(?='ogrenci',m.ogrenci_fiyati,m.personel_fiyati)*0.60,2),NULL) AS yarim,
      (NOW() < d.rezervasyon_son AND d.bos_yer>0 AND COALESCE(r.durum,'iptal')='iptal') AS musait,
      r.durum,
      (SELECT GROUP_CONCAT(y.ad ORDER BY y.ad SEPARATOR ', ')
       FROM menu_yemekleri my JOIN yemekler y ON y.id=my.yemek_id
       WHERE my.menu_id=d.menu_id) AS yemekler,
      (SELECT GROUP_CONCAT(DISTINCT a.ad ORDER BY a.ad SEPARATOR ', ')
       FROM menu_yemekleri my JOIN yemek_alerjenleri ya ON ya.yemek_id=my.yemek_id
       JOIN alerjenler a ON a.id=ya.alerjen_id
       JOIN kullanici_alerjenleri ka ON ka.alerjen_id=a.id AND ka.kullanici_id=?
       WHERE my.menu_id=d.menu_id) AS uyarilar
    FROM v_menu_doluluk d JOIN menuler m ON m.id=d.menu_id
    LEFT JOIN rezervasyonlar r ON r.menu_id=d.menu_id AND r.kullanici_id=?
    WHERE d.yemekhane_id=? AND d.tarih BETWEEN ? AND DATE_ADD(?,INTERVAL 6 DAY)
    ORDER BY d.tarih,d.ogun_id`, [k.rol, k.rol, k.id, k.id, yer, ilkGun, ilkGun]);
}

export function rezervasyonlar(id) {
  return satirlar(replika, `
    SELECT r.id, r.porsiyon, r.ucret, r.durum, d.tarih, d.ogun, d.yemekhane,
           (r.durum='aktif' AND NOW()<d.rezervasyon_son) AS iptal
    FROM rezervasyonlar r JOIN v_menu_doluluk d ON d.menu_id=r.menu_id
    WHERE r.kullanici_id=? ORDER BY d.tarih DESC, r.id DESC`, [id]);
}

async function sonuc(db, sql, args) {
  const [kume] = await db.query(sql, args);
  return kume[0][0];
}

export async function ayirt(id, menu, porsiyon) {
  const rezervasyon = await sonuc(kaynak, 'CALL sp_rezervasyon_yap(?,?,?)', [id, menu, porsiyon]);
  const [doluluk] = await satirlar(kaynak,
    'SELECT bos_yer FROM v_menu_doluluk WHERE menu_id=?', [menu]);
  return { ...rezervasyon, ...doluluk, porsiyon };
}

export const iptal = (id, rez) => sonuc(kaynak, 'CALL sp_rezervasyon_iptal(?,?)', [id, rez]);
export const yukle = (id, tutar) => sonuc(kaynak, 'CALL sp_bakiye_yukle(?,?)', [id, tutar]);

export function hareketler(id) {
  return satirlar(replika, `
    SELECT tur,tutar,aciklama,olusturma FROM bakiye_hareketleri
    WHERE kullanici_id=? ORDER BY id DESC`, [id]);
}

export function yorumlar(id) {
  return satirlar(replika, `
    SELECT d.menu_id,d.yemekhane,d.ogun,d.tarih,y.puan,y.yorum
    FROM rezervasyonlar r JOIN v_menu_doluluk d ON d.menu_id=r.menu_id
    LEFT JOIN degerlendirmeler y ON y.menu_id=r.menu_id AND y.kullanici_id=r.kullanici_id
    WHERE r.kullanici_id=? AND r.durum='kullanildi' ORDER BY d.tarih DESC`, [id]);
}

export async function oyVer(id, menu, puan, yorum) {
  const sonuc = await satirlar(kaynak, `
    INSERT INTO degerlendirmeler(kullanici_id,menu_id,puan,yorum)
      SELECT kullanici_id,menu_id,?,? FROM rezervasyonlar
      WHERE kullanici_id=? AND menu_id=? AND durum='kullanildi'`, [puan, yorum, id, menu]);
  return sonuc.affectedRows === 1;
}

export async function yonetim() {
  const [yemekler, menuler, baglar] = await Promise.all([
    satirlar(replika, 'SELECT id,ad FROM yemekler ORDER BY ad'),
    satirlar(replika, `SELECT d.*,m.ogrenci_fiyati,m.personel_fiyati,p.ortalama_puan,p.oy_sayisi
      FROM v_menu_doluluk d JOIN menuler m ON m.id=d.menu_id
      JOIN v_menu_puan p ON p.menu_id=d.menu_id ORDER BY d.tarih DESC,d.ogun_id`),
    satirlar(replika, 'SELECT menu_id,yemek_id FROM menu_yemekleri ORDER BY yemek_id'),
  ]);
  for (const menu of menuler) {
    menu.yemekler = baglar.filter(b => b.menu_id === menu.menu_id).map(b => b.yemek_id);
  }
  return { yemekler, menuler };
}

export async function menuBilgisi(id) {
  const [menu] = await satirlar(kaynak,
    'SELECT tarih,yemekhane_id,ogun_id FROM menuler WHERE id=?', [id]);
  return menu;
}

export async function menuYaz(id, menu) {
  const db = await kaynak.getConnection();
  try {
    await db.beginTransaction();
    if (id) {
      await db.execute('UPDATE menuler SET ogrenci_fiyati=?,personel_fiyati=? WHERE id=?',
        [menu.ogrenci, menu.personel, id]);
      await db.execute('DELETE FROM menu_yemekleri WHERE menu_id=?', [id]);
    } else {
      const [eklenen] = await db.execute(`
        INSERT INTO menuler(tarih,yemekhane_id,ogun_id,ogrenci_fiyati,personel_fiyati)
        VALUES (?,?,?,?,?)`, [menu.tarih, menu.yemekhane_id, menu.ogun_id, menu.ogrenci, menu.personel]);
      id = eklenen.insertId;
    }
    await db.query('INSERT INTO menu_yemekleri(menu_id,yemek_id) VALUES ?',
      [menu.yemekler.map(y => [id, y])]);
    await db.commit();
    return id;
  } catch (err) {
    await db.rollback();
    throw err;
  } finally {
    db.release();
  }
}

export function profil(id) {
  return satirlar(kaynak, `
    SELECT a.id,a.ad,(ka.alerjen_id IS NOT NULL) AS secili FROM alerjenler a
    LEFT JOIN kullanici_alerjenleri ka ON ka.alerjen_id=a.id AND ka.kullanici_id=?
    ORDER BY a.ad`, [id]);
}

export async function profilYaz(id, ids) {
  const db = await kaynak.getConnection();
  try {
    await db.beginTransaction();
    await db.execute('SELECT id FROM kullanicilar WHERE id=? FOR UPDATE', [id]);
    await db.execute('DELETE FROM kullanici_alerjenleri WHERE kullanici_id=?', [id]);
    if (ids.length) {
      await db.query('INSERT INTO kullanici_alerjenleri(kullanici_id,alerjen_id) VALUES ?',
        [ids.map(a => [id, a])]);
    }
    await db.commit();
  } catch (err) {
    await db.rollback();
    throw err;
  } finally {
    db.release();
  }
}

export async function guncelReplika() {
  const [{ gtid }] = await satirlar(kaynak, 'SELECT @@GLOBAL.gtid_executed AS gtid');
  const [{ bekleme }] = await satirlar(replika, 'SELECT WAIT_FOR_EXECUTED_GTID_SET(?,1) AS bekleme', [gtid]);
  return bekleme === 0;
}

export async function sunucuDurumu() {
  const sorgu = 'SELECT @@server_id AS id, @@read_only AS salt_okunur';
  const [[yazma], [okuma]] = await Promise.all([
    satirlar(kaynak, sorgu), satirlar(replika, sorgu),
  ]);
  return { kaynak: yazma, replika: okuma };
}
