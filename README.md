# 🎓 Thomas More — Testplatform Audiologie & Logopedie

Een webapplicatie waarmee studenten **Audiologie** en **Logopedie** automatisch oefentests
genereren uit hun eigen studiemateriaal (PDF of PowerPoint).

## ✨ Functies

- **Inloggen / registreren** met wachtwoord (gehasht met bcrypt) en JWT-sessies.
- **Dashboard** met vakken (Anatomie, Fysiologie, Linguïstiek, Audiologie, Logopedie, Pathologie)
  en per vak een visueel percentage van je beste/gemiddelde score.
- **Bestand indienen** (`.pdf`, `.pptx`, `.ppt`, `.txt`): de tekst wordt automatisch
  uit het bestand gehaald.
- **Automatisch een test maken** op basis van de tekst, met instelbare opties:
  - aantal vragen
  - **open**, **gesloten (meerkeuze)** of **gemengd**
  - **tijdslimiet** (optioneel)
  - **tips** aan/uit (hint met lengte + eerste letter)
  - bij welk **vak** de test hoort
- **Nakijken**: na de test krijg je een **score** en per vraag de **verbetering/uitleg**.
- **Resultaten opgeslagen** op het dashboard onder het juiste vak, met een visueel percentage.

## 🧠 Vraaggeneratie

- Standaard (zonder API-sleutel): een **heuristische** motor die zinnen uit de tekst haalt,
  een kernwoord weglaat en (bij meerkeuze) afleidingen maakt uit andere woorden.
- Optioneel: zet `OPENAI_API_KEY` in `.env` voor AI-gegenereerde vragen via OpenAI.
  Werkt ook volledig offline zonder sleutel.

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

| Variabele         | Betekenis                                   |
| ----------------- | ------------------------------------------- |
| `PORT`            | Poort van de server (default 3000)          |
| `JWT_SECRET`      | Geheime sleutel voor sessies (lang maken!)  |
| `OPENAI_API_KEY`  | Optioneel: AI-vraaggeneratie                |
| `OPENAI_MODEL`    | OpenAI-model (default `gpt-4o-mini`)        |

## 🗂️ Projectstructuur

```
server.js          Express-server + API-routes
lib/db.js          JSON-opslag (data/db.json)
lib/parse.js       Tekstextractie uit PDF / PPTX / PPT
lib/generate.js    Vraaggeneratie (heuristiek + optioneel OpenAI)
lib/grade.js       Nakijken + feedback per vraag
public/            Frontend (HTML, CSS, vanilla JS SPA)
data/              Automatisch aangemaakt: db.json (wordt niet in git gezet)
uploads/           Uploadmap (runtime)
```

## 📦 Stack

Node.js · Express · Multer · pdf-parse · adm-zip · bcryptjs · jsonwebtoken · Vanilla JS

## 📄 Licentie

MIT