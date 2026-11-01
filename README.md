# Var Yok

104 kartla oynanan, okey usulü per yapılan kart oyunu. Arkadaşlarınla davet linkiyle çevrimiçi oynanır (3–6 kişi). Eksik koltuklara bilgisayar oyuncu eklenebilir.

- `server.js` — oyun sunucusu (Node.js + WebSocket). Kartları sunucu dağıtır; herkes yalnız kendi elini görür.
- `public/index.html` — çevrimiçi oyun sayfası
- `public/core.js` — per kontrolü ve oyun hesapları
- `public/tek.html` — tek kişilik, bilgisayara karşı sürüm

## Render'da yayınlama

1. Render'da **New → Web Service** seç ve bu repoyu bağla.
2. **Language / Runtime:** `Node`
3. **Build Command:** `npm install`
4. **Start Command:** `npm start`
5. **Instance Type:** Free
6. **Create Web Service**'a bas.

Repoda bir `Dockerfile` da var; Runtime olarak Docker seçilirse de çalışır.

## Kendi bilgisayarında çalıştırma

```bash
npm install
npm start
```

Sonra tarayıcıda `http://localhost:10000` adresini aç.
