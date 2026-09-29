# Ověření adres, trasování a matching

## Cíl

Uživatel nesmí odeslat volně napsanou neověřenou lokalitu. Každý konec přepravy nebo trasy bude vybrán z Google Places a uložen jako strukturovaná, ověřená lokalita. Přesné adresy a souřadnice zůstávají soukromé; veřejný trh dál zobrazuje jen město nebo oblast.

## Bezpečnostní architektura

- Mobilní aplikace nikdy neobsahuje klíč pro Google Places API (New) ani Routes API.
- Klíč je uložen pouze jako Supabase Edge Function secret.
- Aplikace volá autentizované Edge Functions; ty sestavují pevně definované požadavky na Google a filtrují odpovědi.
- Funkce nepřijímají libovolnou cílovou URL, hlavičky ani field mask od klienta.
- Preview a production používají oddělené Google projekty/klíče, kvóty a rozpočtová upozornění.

## Datový kontrakt lokality

Každá vybraná lokalita má:

- `placeId` – identifikátor Google Place;
- `formattedAddress` – soukromá normalizovaná adresa;
- `publicLabel` – město/obec nebo bezpečná oblast pro veřejný trh;
- `latitude`, `longitude` – ověřené souřadnice;
- `countryCode` – ISO kód země;
- `provider` – pro první verzi vždy `google`.

Text z inputu není platnou lokalitou, dokud uživatel nevybere návrh a neproběhne Place Details. Jakákoliv ruční změna textu po výběru zruší ověření.

## Google služby

1. Places Autocomplete (New) vrací pouze návrhy a `placeId`; používá nový session token pro každé hledání.
2. Place Details (New) vrátí pouze potřebná pole přes field mask: identifikátor, formátovanou adresu, souřadnice a adresní komponenty.
3. Routes API `computeRoutes` počítá vzdálenost, dobu a polyline jedné trasy.
4. Routes API `computeRouteMatrix` se použije jen pro omezený počet kandidátů, ne pro celý marketplace.

### Omezení čerpání Google API (povinné před nasazením)

Edge Function `google-routes` ani napojení metrik do formulářů **nesmí být nasazeny do produkce**, dokud nebude rozhodnuto o ochraně proti nadměrnému čerpání Google Routes API — tedy o rate limitu na uživatele/IP, denní kvótě a rozpočtovém upozornění. Bez tohoto rozhodnutí by každé otevření formuláře mohlo volat placené API bez omezení.

## Uložení

Do `tow_requests` se doplní place ID obou konců a vypočtená délka/doba požadované trasy. Do `carrier_routes` se doplní place ID, délka, doba a interní encoded polyline. Stávající adresní a souřadnicové sloupce zůstávají kvůli kompatibilitě.

Interní encoded polyline se v první migraci (`0015_verified_route_metrics.sql`) záměrně ještě neukládá: matching v1 umí vzdálenost i dobu ověřit znovu z place ID a geometrii trasy dnes žádný čtenář nepoužívá. Uložit ji lze v samostatné migraci, až pro ni vznikne konkrétní konzument.

Metriky jsou buď vyplněné všechny, nebo žádná — částečně vyplněná čtveřice je v databázi zakázaná pojmenovaným table-level CHECK constraintem.

Migrace musí být nejprve připravena a testována, nikoliv automaticky aplikována na připojenou databázi.

## Matching v1

1. Databázový předvýběr pouze otevřených poptávek a tras podle termínu, typu vozidla, kapacity a hrubé geografické vzdálenosti.
2. Pro omezený počet kandidátů se spočítá:
   - původní délka trasy dopravce;
   - délka trasy s vyzvednutím a vyložením;
   - odchylka v kilometrech a minutách.
3. Kandidát vyhovuje, pokud nepřekročí `max_deviation_km`, termín je kompatibilní, typ vozidla je podporovaný a zbývá kapacita.
4. Výsledky se řadí transparentním skóre. Uživatel uvidí důvod shody, například „+18 km, termín souhlasí, vhodné vozidlo“.
5. Matching pouze doporučuje. Nabídka ani přijetí přepravy se nikdy neprovede automaticky.

## Etapy implementace

### A. Ověřené lokality

- Edge Function pro autocomplete a place details;
- znovupoužitelný `VerifiedLocationInput`;
- nahrazení čtyř dvojic volných polí ve formulářích;
- lokální a nativní test zrušení ověření po ruční změně.

### B. Výpočet trasy

- Edge Function pro `computeRoutes`;
- náhled vzdálenosti a doby před odesláním;
- uložení vypočtených metrik a interní polyline;
- jasný stav při nedostupné trase nebo API.

### C. Matching

- databázový předvýběr kandidátů;
- serverový výpočet odchylky;
- deterministické skóre a důvody shody;
- obrazovky doporučených poptávek a volných kapacit.

### D. Ověření před testováním

- jednotkové testy mapování a skóre;
- regresní test ochrany soukromých adres;
- test kvót, timeoutů a chyb Google API;
- nativní end-to-end test se dvěma fiktivními účty;
- kontrola, že anonymní marketplace nikdy nevrací place ID, přesnou adresu, souřadnice ani polyline.

## Podmínky zahájení integrace

- Google Cloud projekt s aktivním billingem;
- povolené Places API (New) a Routes API;
- samostatný serverový API klíč omezený pouze na tyto dvě API;
- nízké denní kvóty a rozpočtová upozornění pro preview;
- klíč uložen přes `supabase secrets set`, nikdy v `.env` mobilní aplikace nebo v GitHubu.
