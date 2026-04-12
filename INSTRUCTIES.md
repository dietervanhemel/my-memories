# Trouw Fotoapp – Instructies

## Eerste keer instellen

### Stap 1 – Node.js installeren
1. Ga naar **https://nodejs.org**
2. Download de **LTS versie** (aanbevolen)
3. Installeer het programma (standaard instellingen zijn prima)
4. Herstart je computer

### Stap 2 – App starten
- Dubbelklik op **`start.bat`**
- De app installeert automatisch wat nodig is
- Daarna opent de server op http://localhost:3000

---

## App gebruiken

### Als gast (upload pagina)
- Ga naar: **http://localhost:3000**
- Vul naam in, selecteer foto's, verstuur

### Als eigenaar (dashboard)
- Ga naar: **http://localhost:3000/dashboard.html**
- Wachtwoord: **bruid2024** ← verander dit in `server.js` regel 11!

### QR code genereren
1. Open het dashboard
2. Klik op **QR code** in het menu
3. Vul het externe adres van jouw app in (bv. je WiFi IP-adres)
4. Klik op **Genereer** en download de QR code
5. Print de QR code en zet hem op tafel

---

## App bereikbaar maken voor gasten via WiFi

Als alle gasten op hetzelfde WiFi netwerk zitten:
1. Zoek jouw IP-adres: druk `Win + R`, typ `cmd`, dan `ipconfig`
2. Noteer het adres, bv. `192.168.1.50`
3. Gasten gaan naar `http://192.168.1.50:3000` op hun telefoon

Voor publiek internet heb je een hosting dienst nodig (bv. Railway, Render, of ngrok voor tijdelijk gebruik).

---

## Wachtwoord wijzigen

Open `server.js` en verander op regel 11:
```
const DASHBOARD_PASSWORD = 'bruid2024';
```

---

## Mappen

- `uploads/` – alle geüploade foto's
- `data/photos.json` – overzicht wie wat geüpload heeft
