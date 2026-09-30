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

Edge Function `google-routes` **není připravena k produkčnímu nasazení**, dokud na straně Google Cloudu nebudou nastavené kvóty a rozpočtová ochrana.

Aplikační rate limit (`0016_google_routes_rate_limit.sql`; 10 přijatých pokusů za minutu a 100 za kalendářní den UTC na ověřeného uživatele) řeší zneužití jedním účtem, ale **není náhradou za Google Cloud kvótu** — nechrání před součtem všech účtů, před chybou v klientovi ani před útokem z mnoha účtů.

Před nasazením je proto nutné:

- nastavit v Google Cloud **denní kvótu** pro Compute Routes;
- nastavit **rozpočtové upozornění** (billing budget alert) na projekt;
- omezit serverový API klíč pouze na API, která funkce skutečně používá (Places API (New), Routes API), odděleně pro preview a produkci.

Doporučená počáteční testovací kvóta: **nejvýše 500 požadavků Compute Routes za den pro celý projekt**, pokud současná Google konfigurace nebo očekávané náklady nevyžadují méně. Google Cloud nastavení se v tomto kroku nemění — je to ruční krok před nasazením.

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

#### Potvrzený kontrakt Matching v1

- Hodnotí se pouze otevřená poptávka proti otevřené volné kapacitě.
- Odjezd trasy musí ležet včetně krajních dnů uvnitř požadovaného termínu.
- Typ vozidla musí být mezi podporovanými typy trasy a zbývající kapacita musí pokrýt požadovaný počet míst (v1 standardně jedno).
- `max_deviation_km = NULL` znamená nulovou povolenou zajížďku, nikoli neomezenou zajížďku.
- Server dodá pouze normalizovanou zajížďku v metrech a sekundách; čistá funkce `lib/matchingLogic.ts` provede finální kontrolu, skórování a seřazení.
- Skóre je deterministické: zvýhodňuje přesný termín, vhodné vozidlo a rezervu kapacity; penalizuje kilometry a minuty zajížďky. Při shodě rozhoduje menší zajížďka a stabilně ID trasy.
- Výstup obsahuje jen ID, skóre, zajížďku a bezpečné důvody shody. Neobsahuje identitu, přesné adresy, souřadnice ani place ID.
- Matching nikdy sám nevytváří nabídku ani nemění stav poptávky nebo trasy.
- Serverový předvýběr, volání Google a databázové RPC budou připraveny v samostatném kroku a před výslovným schválením se neaplikují ani nenasazují.

#### Serverový návrh (zatím neaplikovaný)

- Migrace `0017_matching_candidate_preselection.sql` vytváří interní RPC přístupné pouze `service_role`; `anon` ani `authenticated` je nesmí volat přímo.
- Edge Function `google-route-matches` přijímá pouze ID trasy, ověří uživatele a do interního RPC předá jeho ověřené ID. RPC vrátí kandidáty jen tehdy, když uživatel danou otevřenou trasu vlastní.
- Předvýběr je omezen na pět kandidátů a filtruje otevřený stav, termín, podporovaný typ vozidla, dostupnou kapacitu a úplné ověřené metriky.
- Pro každého kandidáta se počítá pevná trasa `začátek trasy → vyzvednutí → vyložení → konec trasy`; klient nemůže změnit pořadí waypointů, URL ani field mask.
- Každé jednotlivé Google volání spotřebuje vlastní slot existujícího serverového limiteru. Selhání limiteru je fail-closed.
- Klient dostane jen ID poptávky, skóre, kilometry/minuty zajížďky a bezpečné důvody. Place ID, adresy, souřadnice, Google odpověď ani identita se nevracejí.
- Migrace 0017 ani funkce `google-route-matches` se v této etapě neaplikují a nenasazují.

### D. Ověření před testováním

- jednotkové testy mapování a skóre;
- regresní test ochrany soukromých adres;
- test kvót, timeoutů a chyb Google API;
- nativní end-to-end test se dvěma fiktivními účty;
- kontrola, že anonymní marketplace nikdy nevrací place ID, přesnou adresu, souřadnice ani polyline.

## Runbook: nasazení rate limitu a funkce pro výpočet trasy (ruční kroky)

Tyto kroky se provádějí ručně a v tomto pořadí. Dokud nejsou hotové, funkce pro výpočet trasy se NENASADZUJE. Žádný z nich se nespouští automaticky a v přípravném kroku se reálně neprovádí ani jeden.

1. **Ručně ověřit Google Cloud**: denní kvótu pro Compute Routes, rozpočtové upozornění a API klíč omezený jen na potřebná API — zvlášť pro preview a produkci.
2. **Aplikovat migraci `0015_verified_route_metrics.sql`** (idempotentní; přidává jen nullable sloupce a all-or-none CHECKy).
3. **Aplikovat migraci `0016_google_routes_rate_limit.sql`** (interní bucket tabulka + RPC `consume_google_routes_rate_limit`).
4. **Read-only ověřit schéma a oprávnění**: sloupce a CHECKy z 0015; RLS a žádné policy na bucket tabulce; žádná přímá práva pro `public`/`anon`/`authenticated`; execute na RPC jen pro `authenticated`.
5. **Počkat na začátek čerstvé minuty** (minutové okno limitu je pevné a počítá se od `date_trunc('minute', now())`).
6. **Spustit integrační RPC harness** [.roadlink/google-routes-rate-limit-integration.mjs](.roadlink/google-routes-rate-limit-integration.mjs) s krátkodobým access tokenem jednoho testovacího uživatele a přepínačem `--confirm-live-rate-limit-test`.
7. **Ověřit, že povolených volání nebylo více než 10** a že odmítnutá volání vrátila bezpečný `retry_after_seconds`. Hodnota `1–60` odpovídá minutovému omezení. Hodnota `61–86 400` znamená, že testovací účet pravděpodobně narazil na denní limit; v takovém případě harness bezpečně skončí samostatným nenulovým kódem pro nesplněnou podmínku minutového testu a denní limit se nevyčerpává živými voláními. Denní limit 100 zůstává ověřený staticky, ne živým vyčerpáním.
8. **Teprve nyní nasadit Edge Function** pro výpočet trasy (`supabase functions deploy`).
9. **Provést jedno kontrolované testovací volání** Edge Function s platným přihlášením a ověřit, že vrací jen normalizovanou vzdálenost a dobu.
10. **Teprve následně zapojovat formuláře** — ukládat ověřené metriky trasy do poptávek a volných kapacit.

Bezpečnostní poznámky k harnessu: skript bez přepínače `--confirm-live-rate-limit-test` neprovede žádné síťové volání; volá výhradně RPC limiteru, nikdy Edge Function ani Google API; nepoužívá privilegovaný klíč; nečte ani nemění bucket tabulku a nikdy ji neresetuje; token ani ID uživatele nikdy nevypisuje.

## Podmínky zahájení integrace

- Google Cloud projekt s aktivním billingem;
- povolené Places API (New) a Routes API;
- samostatný serverový API klíč omezený pouze na tyto dvě API;
- nízké denní kvóty a rozpočtová upozornění pro preview;
- klíč uložen přes `supabase secrets set`, nikdy v `.env` mobilní aplikace nebo v GitHubu.
