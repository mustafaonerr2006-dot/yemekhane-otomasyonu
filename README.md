# Kampüs Yemek Sistemi

Yemekhane menülerini, rezervasyonları ve sanal bakiyeyi yöneten Web API projesi. Sunucu Node.js ve Express ile yazıldı. Apache tek sayfalık HTML, CSS ve JavaScript arayüzünü sunar.

## Başlatma

```bash
docker compose up -d
docker compose ps -a
```

Tarayıcıdan <http://localhost:8080> adresini açın. MySQL'in örnek veriyi hazırlaması ve replikasyonun kurulması ilk açılışta biraz zaman alır. `replica-setup` başarıyla kurulduğunda `Exited (0)` görünür.

8080, 3307, 3308 veya 6379 kullanımdaysa aynı komutları alternatif portlarla çalıştırın:

```bash
export WEB_PORT=8180 PRIMARY_PORT=3317 REPLICA_PORT=3318 CACHE_PORT=6389
docker compose up -d
docker compose ps -a
```

Bu örnekte tarayıcı adresi <http://localhost:8180>. Portlar sadece yerel bilgisayara açık. Verilen Docker ve örnek hesap şifreleri ders ortamına aittir.

## Örnek hesaplar

Tüm kullanıcıların şifresi **`Yemek2026!`**.

| Rol | E-posta |
| --- | --- |
| Öğrenci | mehmet.yildiz@ogr.kampus.edu.tr |
| Personel | murat.kaya@kampus.edu.tr |
| Yönetici | leyla.arslan@kampus.edu.tr |

Tarihler kurulum gününe göre üretilir. Örnek haftanın sonuna gelince yönetim ekranından yeni menü eklenebilir.

## Kodun yeri

- `sunucu/src/index.js` Express yönlendirmeleri, oturum, roller ve Redis işlemleri.
- `sunucu/src/veri.js` MySQL erişimi. Yazma ve parasal yordamlar primary, menü ve rapor listeleri replica.
- `frontend/` Apache'nin sunduğu arayüz. JavaScript `/api` üzerinden JSON alır.
- `db/init/04_degisiklik.sql` Porsiyon ve alerjen profili migration'ı. Yeni veritabanında otomatik yürür.
- `rapor/` PDF ve gerçek canlı test çıktıları.

## Çalışan bir Aşama 3 veritabanını güncelleme

Yeni kurulumda bu adımlar gereksizdir. Aynı kurulumun mevcut verisini güncellerken volume'ları koruyun:

```bash
docker compose stop uygulama
docker compose exec -T mysql-primary sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql --default-character-set=utf8mb4 -uroot yemekhane' < db/init/04_degisiklik.sql
docker compose exec -T redis sh -c "redis-cli --scan --pattern 'menu:*' | xargs -r redis-cli DEL"
docker compose up -d --build
```

Replika SQL değişikliğini replikasyon üzerinden alır. Redis temizliğinde yalnızca bulunan menü anahtarları silinir. Geçerli oturum anahtarları korunur.

## Kısa gösterim

Giriş yaptıktan sonra haftalık menüde gelecek bir öğleyi seçin. Yarım porsiyon seçeneği tam ücretin %60'ıdır. Rezervasyonlar ekranında iptal ederseniz ödenen ücret geri döner. Profilde bir alerjen seçilince o alerjeni içeren yemekler uyarıyla gösterilir.

```bash
docker compose logs --tail=50 uygulama
docker compose exec -T redis redis-cli --scan --pattern 'menu:*'
```
