# 🎓 Thomas More — Testplatform Audiologie & Logopedie

Een webapplicatie waarmee studenten **Audiologie** en **Logopedie** automatisch oefentests
genereren uit hun eigen studiemateriaal (PDF of PowerPoint).

## ✨ Functies

- **Inloggen / registreren** met wachtwoord (gehasht met bcrypt) en JWT-sessies.
- **Dashboard** met vakken (Anatomie, Fysiologie, Linguïstiek, Audiologie, Logopedie, Pathologie)
  en per vak een visueel percentage van je beste/gemiddelde score.
- **Het hele bestand wordt goed gelezen**: alle pagina's van een PDF en alle slides (incl.
  groepsvormen, tabellen en sprekersnotities) van een PowerPoint. Woorden worden correct
  samengesteld (geen "ge hoor"), afgebroken woorden aan het einde van een regel worden
  hersteld en kop-/voetteksten, paginanummers en herhaalde headers worden verwijderd.
- **Enkel de theorie wordt bevraagd**: titels, kopjes, inhoudsopgaven, verwijzingen,
  bijschriften en opsommingen worden overgeslagen. Alleen echte theorie-zinnen komen in de test.
- **Automatisch een test maken** met instelbare opties:
  - aantal vragen
  - **open**, **gesloten (meerkeuze)** of **gemengd**
  - **tijdslimiet** (optioneel)
  - **tips** aan/uit (hint met lengte + eerste letter)
  - bij welk **vak** de test hoort
- **Nakijken**: na de test krijg je een **score** en per vraag de **verbetering/uitleg**.
- **Resultaten opgeslagen** op het dashboard onder het juiste vak, met een visueel percentage.

## 🤖 AI-vraaggeneratie

De app ondersteunt drie modi (instelbaar via `AI_PROVIDER`):

| Modus      | Betrekening                                                       |
| ---------- | ----------------------------------------------------------------- |
| `openai`   | Slimme vragen via de OpenAI API (betaald, vereist `OPENAI_API_KEY`) |
| `ollama`   | **Gratis & lokaal** via een eigen Ollama-server (geen API-sleutel)  |
| `heuristic`| Ingebouwde regelgebaseerde motor (werkt altijd, geen internet)     |
| `auto`     | OpenAI als er een sleutel is, anders Ollama, anders `heuristic`    |

### Lokale AI met Ollama (gratis)

1. Installeer [Ollama](https://ollama.com) en trek een model binnen:
   ```bash
   ollama pull llama3.1
   ```
2. Zet in `.env`:
   ```env
   AI_PROVIDER=ollama
   OLLAMA_URL=http://localhost:11434
   OLLAMA_MODEL=llama3.1
   ```

Lukt de AI-aanroep niet (bv. geen server/sleutel), dan schakelt de app automatisch terug
naar de heuristiek en wordt er alsnog een test gemaakt.

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

| Variabele         | Betekenis                                        |
| ----------------- | ------------------------------------------------ |
| `PORT`            | Poort van de server (default 3000)               |
| `JWT_SECRET`      | Geheime sleutel voor sessies (lang maken!)       |
| `AI_PROVIDER`     | `auto` / `openai` / `ollama` / `heuristic`       |
| `OPENAI_API_KEY`  | Optioneel: OpenAI-sleutel                        |
| `OPENAI_MODEL`    | OpenAI-model (default `gpt-4o-mini`)             |
| `OLLAMA_URL`      | Optioneel: URL van je Ollama-server              |
| `OLLAMA_MODEL`    | Ollama-model (default `llama3.1`)                |

## 🗂️ Projectstructuur

```
server.js          Express-server + API-routes
lib/db.js          JSON-opslag (data/db.json)
lib/parse.js       Volledige tekstextractie uit PDF / PPTX / PPT (+ pag./slide-telling)
lib/clean.js       Opschonen + filteren tot echte theorie-zinnen
lib/generate.js    Vraaggeneratie (OpenAI / Ollama / heuristiek)
lib/grade.js       Nakijken + feedback per vraag
public/            Frontend (HTML, CSS, vanilla JS SPA)
data/              Automatisch aangemaakt: db.json (wordt niet in git gezet)
uploads/           Uploadmap (runtime)
```

## 📦 Stack

Node.js · Express · Multer · pdfjs-dist · adm-zip · bcryptjs · jsonwebtoken · Vanilla JS

## 📄 Licentie

MIT