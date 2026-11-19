# 🎓 Thomas More — Testplatform Audiologie & Logopedie

Een webapplicatie waarmee studenten **Audiologie** en **Logopedie** oefentests maken
op basis van een **eigen bestand met vragen en antwoorden**.

## ✨ Functies

- **Inloggen / registreren** met wachtwoord (gehasht met bcrypt) en JWT-sessies.
- **Dashboard** met vakken (Anatomie, Fysiologie, Linguïstiek, Audiologie, Logopedie, Pathologie)
  en per vak een visueel percentage van je beste/gemiddelde score.
- **Oefentest maken uit een vraag/antwoord-bestand**: dien een bestand in met vragen en
  antwoorden (JSON, CSV of tekst) en dat wordt je test.
  - **open** en **gesloten (meerkeuze)** vragen worden herkend (op basis van de opties in het bestand)
  - instelbaar: maximaal aantal vragen, **tijdslimiet**, **tips** aan/uit en het **vak**
- **Nakijken**: na de test krijg je een **score** en per vraag de **verbetering/uitleg**.
- **Resultaten opgeslagen** op het dashboard onder het juiste vak, met een visueel percentage.

## 📝 Vraag/antwoord-bestand

Vink bij het uploaden niets speciaal aan — dien gewoon je bestand in. Ondersteunde formaten:

**JSON**
```json
[
  { "question": "Wat is een router?", "answer": "Een apparaat dat pakketten doorstuurt." },
  { "question": "Wat is een switch?", "answer": "Een apparaat dat een LAN verbindt.",
    "options": ["Een apparaat dat een LAN verbindt", "Een protocol", "Een kabel"] }
]
```

**CSV** (met of zonder hoofding; extra kolommen = meerkeuze-opties)
```
question,answer
"Wat is latentie?","De tijdvertraging in een netwerk."
```

**Tekst**
```
Vraag: Wat is een router?
Antwoord: Een apparaat dat datapakketten doorstuurt.

Vraag: Wat is een switch?
Antwoord: Een apparaat dat apparaten in een LAN verbindt.
```

Ook genummerde lijsten (`1. vraag` / `Antwoord:`) en `optie:`-regels worden herkend.
Vragen met meerkeuze-opties worden als gesloten vraag getoond, anders als open vraag.
Je kan ook een PDF, PowerPoint of tekstbestand insturen zolang de tekst de vragen en antwoorden bevat.

## 🚀 Starten

```bash
npm install
npm start
```

Open daarna **http://localhost:3000**.

Voor ontwikkeling met automatisch herstarten:

```bash
npm run dev
```

## ⚙️ Configuratie

Kopieer `.env.example` naar `.env` en pas aan:

| Variabele    | Betekenis                                  |
| ------------ | ------------------------------------------ |
| `PORT`       | Poort van de server (default 3000)         |
| `JWT_SECRET` | Geheime sleutel voor sessies (lang maken!) |

## 🗂️ Projectstructuur

```
server.js          Express-server + API-routes
lib/db.js          JSON-opslag (data/db.json)
lib/parse.js       Tekstextractie uit PDF / PPTX / PPT (+ pag./slide-telling)
lib/qa.js          Q&A-import (JSON / CSV / tekst met vraag & antwoord)
lib/grade.js       Nakijken + feedback per vraag
public/            Frontend (HTML, CSS, vanilla JS SPA)
data/              Automatisch aangemaakt: db.json (wordt niet in git gezet)
uploads/           Uploadmap (runtime)
```

## 📦 Stack

Node.js · Express · Multer · pdfjs-dist · adm-zip · bcryptjs · jsonwebtoken · Vanilla JS

## 📄 Licentie

MIT