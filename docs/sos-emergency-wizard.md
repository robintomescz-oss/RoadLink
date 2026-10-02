# SOS „Emergency Wizard“

Modul pomoci řidiči při poruše nebo dopravní nehodě. Priorita: bezpečnost,
ovládání ve stresu a **pravdivé** informace o dostupnosti pomoci.

## Co bylo implementováno

- **Vstup:** výrazné červené tlačítko **SOS** ve spodní navigaci
  (`components/BottomNav.tsx`) na každé obrazovce + karta „SOS pomoc“ na
  Přehledu (`lib/GlobalHome.tsx`). Obojí vede na route `sos`.
- **Obrazovka:** `screens/Sos/SosScreen.tsx` (route `screens/Sos/SosRoute.tsx`).
  Tmavý podklad `#0f172a`, vysoký kontrast, ovládací prvky ≥ 48 px, krátké
  české instrukce. Význam stavů je vyjádřen textem i ikonou (ne jen barvou).
- **Trvalý pruh tísňového volání** (`EmergencyCallBar`): 155 / 112 / 158 jsou
  dostupné na všech krocích. Volání jde vždy přes `tel:` odkaz – aplikace
  **nikdy nevolá automaticky** a volání není podmíněné dokončením průvodce.
- **Úvodní rozcestník:** „Někdo je zraněný“ (155, alternativa 112),
  „Požár nebo bezprostřední nebezpečí“ (112), „Porucha / nehoda bez zranění“.
- **Bezpečnost na místě:** výstražná světla; reflexní vesta (pokud je);
  bezpečné vystoupení a přesun mimo vozovku (na dálnici za svodidla);
  výstražný trojúhelník (≥50 m, na dálnici ≥100 m, v obci může být kratší,
  zákaz přepočtu na kroky). U každého kroku Hotovo / Už hotovo /
  Nelze bezpečně provést. Žádný krok neblokuje přivolání pomoci a nezraněné
  se nikam nepřemisťují proti pokynům operátora.
- **Určení problému:** 7 kategorií (kontrolka, defekt, nelze nastartovat,
  došlo palivo, nesprávné palivo, nehoda, jiný/nevím). U kontrolyk se
  nerozhoduje podle barvy – hodnotí se symbol, svítí/bliká, hlášení vozidla
  a příznaky; výsledek je označený jako orientační a návod výrobce má přednost.
  „Nelze nastartovat“ není automaticky vybitá baterie; došlé a nesprávné
  palivo jsou oddělené; žádné návody na opravy u silnice.
- **Dopravní nehoda (CZ):** checklist zákonných důvodů volat policii
  (zranění/úmrtí, škoda zřejmě > 200 000 Kč **na některém** vozidle včetně
  nákladu, škoda na majetku třetí osoby, poškození komunikace, nelze obnovit
  provoz bez nepřiměřeného úsilí), odděleně od doporučení (spor, odmítnutí
  údajů, nejistota). Volby Ano/Ne/Nevím; nejistota u zákonného bodu vede
  k doporučení policii kontaktovat. Připomínka společného podepsaného záznamu
  a fotek jen z bezpečného místa.
- **Přivolání asistence:** souhrn polohy (přesnost + čas zjištění, ruční popis
  místa, možná oprava typu komunikace), vozidla (z profilu, nebo ručně,
  editovatelné) a problému. Před potvrzením je vidět, co a komu se předá.
  Jedno závazné potvrzení; opakované klepnutí nevytvoří duplicitní objednávku.
- **Stav zásahu:** odesílám → odesláno (čeká na přijetí) → partner přijal →
  technik jede → dorazil → dokončeno; zvlášť odmítnuto / zrušeno / nezdařilo
  se. Úspěšné odeslání **není** přijetí. ETA je označená jako odhad. Retry,
  telefonický kontakt a storno podle skutečných podmínek. Živé sledování se
  nezobrazuje bez skutečných dat.
- **Offline a chyby:** bezpečnostní pokyny i tísňová čísla jsou součástí
  balíčku (fungují offline); hovor ale závisí na signálu – to je v textu
  přiznané. Ošetřená zamítnutá/chybějící GPS, zastaralá poloha, chybějící
  vozidlo (ruční zadání) i výpadek objednávky. Síťová chyba objednávku
  **nikdy** nezobrazí jako odeslanou.
- **Data a integrace:** poloha se získává jen pro účel SOS a s oprávněním;
  příjemce a účel jsou vysvětlené před odesláním; ruční popis a souřadnice
  jsou oddělené údaje. Chybí-li reálné partnerské API, použije se rozhraní
  `lib/sos/assistanceProvider.ts` a poctivý fallback na telefonní kontakt.
  Partneři, ceny, hodnocení ani živé polohy se nevymýšlejí.

## Kód a struktura

- `lib/sos/sosContent.ts` – veškerý obsah: tísňová čísla, kroky, kategorie,
  posouzení kontrolek, nehodový checklist a metadata právního obsahu.
- `lib/sos/sosState.ts` – čistý stavový automat průvodce, stavy zásahu,
  ochrana proti duplicitám, popis polohy, odhad typu komunikace, offline obsah.
- `lib/sos/assistanceProvider.ts` – integrační rozhraní asistence + výchozí
  „unavailable“ provider a generátor idempotentního klíče objednávky.
- `lib/sosStyles.ts` – tmavý styl modulu.
- `screens/Sos/SosScreen.tsx`, `screens/Sos/SosRoute.tsx` – UI.

## Co bylo ověřeno

- `npm run check` (TypeScript + všechny regresní sady) prochází.
- Nová sada `.roadlink/sos-regression.js` ověřuje bezpečnostní/komunikační
  zásady, trojúhelník, kontrolky, checklist nehody, stavový automat včetně
  „síťová chyba ≠ odesláno“, ochranu proti duplicitám, popis polohy,
  odhad typu komunikace a zapojení do navigace.
- Staticky ověřeno: modul nikde nečte `userId` (funguje bez registrace),
  neobsahuje animace (respektuje omezení pohybu) a používá
  `accessibilityRole`/`accessibilityLiveRegion` a `allowFontScaling`.

## Co ještě chybí (a je potřeba doplnit)

1. **Odborné ověření textů.** `SOS_LEGAL_METADATA.reviewStatus` je
   `pending_expert_review`, `verifiedAt: null`. Před nasazením ověřit u
   **Policie ČR, BESIP a HZS** zejména: zákonné důvody volat policii,
   limit 200 000 Kč, vzdálenosti trojúhelníku a bezpečnostní pokyny. Dokud
   ověření neproběhne, jsou texty v aplikaci označené jako orientační a
   neověřené – nic se nedomýšlí.
2. **Partnerské API asistence neexistuje.** `getAssistanceProvider()` vrací
   výchozího providera (`id: "none"`, `isConfigured() === false`). Fáze 2:
   implementovat reálného providera (poskytovatel, rozsah služby, cena,
   ETA, podmínky storna, stav zásahu) a zaregistrovat přes
   `setAssistanceProvider(...)`. Objednávka se pak smí zobrazit jako
   „odesláno“ jen po skutečném přijetí serverem.
3. **Telefonní kontakt na asistenci / pojišťovnu.** Zatím nejsou reálná
   čísla – doplnit, až budou k dispozici (jinak se nevymýšlejí).
4. **Živá mapa technika** je vědomě fáze 2 (chybí reálný zdroj dat).
5. **Ruční E2E na zařízení:** ověřit telefona na skutečném telefonu
   (otevření `tel:` odkazu), čtečku obrazovky (TalkBack/VoiceOver),
   zvětšené písmo, zamítnutou GPS a režim letadlo.

## Jak modul spustit a vyzkoušet

```bash
npm ci
npm run check
npm start
```

V aplikaci klepněte na červené **SOS** ve spodní liště (nebo na kartu
„SOS pomoc“ na Přehledu). Vyzkoušejte:

1. Na úvodu zvolte jednotlivé varianty a ověřte, že tísňová čísla jsou
   pořád nahoře a volání jde spustit kdykoli.
2. „Porucha / nehoda bez zranění“ → projděte kroky zajištění místa
   (i volbu „Nelze bezpečně provést“) → určete problém.
3. U „Kontrolka / hlášení vozidla“ zadejte symbol/příznaky a ověřte
   orientační posouzení (bez rozhodování podle barvy).
4. U „Dopravní nehoda“ zaškrtněte checklist a ověřte, že zákonné důvody
   a doporučení jsou oddělené.
5. Na obrazovce přivolání pomoci zkuste „Zjistit aktuální polohu“, ruční
   popis místa a opravu typu komunikace.
6. Ověřte, že „Potvrdit objednávku asistence“ hlásí, že partnerské API
   není dostupné (nic nepředstírá), a že další klepnutí nevytvoří druhou
   objednávku.
