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

## Matching v2 – trasy s průjezdními body

Matching v1 uměl vložit poptávku jen mezi odjezd a cíl přímé trasy, proto byly
trasy s `via_place_ids` z předvýběru vyřazené. Matching v2 počítá celou
plánovanou trasu:

`start → průjezdní body v zadaném pořadí → cíl`

Pro každou poptávku se vygenerují přípustná vložení nakládky a vykládky tak, aby
zůstalo zachováno pořadí původních průjezdních bodů a nakládka byla před
vykládkou. Body, které už na trase leží (odjezd, cíl, průjezdní bod), se
nevkládají znovu. Google se volá s `optimizeWaypointOrder: false`, takže pořadí
zastávek nemůže změnit. Vybere se varianta s nejmenší dodatečnou vzdáleností;
při shodě rozhoduje kratší dodatečný čas a nakonec stabilní klíč varianty.

Zajížďka se počítá proti uloženým metrikám celé trasy za stejných podmínek
(TRAFFIC_UNAWARE). Drobné záporné rozdíly ze zaokrouhlení se srovnají na nulu,
ale materiálně kratší varianta (rozdíl větší než 1 km) je odmítnuta jako
nesrovnatelná, aby nevznikla falešná shoda. Nulová zajížďka znamená jen to, že
naplánovaná trasa vede přes daná místa — ne že přepravník nakládku fyzicky
zvládne.

### Polohový předvýběr a řazení variant ze soukromých souřadnic

Průjezdní body volné kapacity se ukládají i se svými soukromými souřadnicemi
(`carrier_routes.via_latitudes`, `via_longitudes`) — stejně jako už jsou uložené
souřadnice odjezdu a cíle. Do databáze se dostanou jen jako úplná dvojice se
stejným počtem prvků, jako má `via_place_ids`; rozbitý pár odmítne validační
trigger. Souřadnice jsou citlivá data: interní RPC je vrací jen `service_role` a
veřejný feed volných kapacit je nikdy nevybírá.

Edge Function díky tomu dělá dva levné kroky bez jediného Google volání:

1. **Předvýběr kandidátů v SQL.** Databáze si drží ohraničující obdélník celé
   naplánované trasy (`carrier_routes.bbox_*`, dopočítaný triggerem ze souřadnic
   odjezdu, cíle i průjezdních bodů). RPC kandidáty nejprve odfiltruje
   obdélníkem rozšířeným o `max_deviation_km` + 10 km rezerva a pak je seřadí
   podle součtu havérsine vzdálenosti nakládky a vykládky od bodů celé trasy
   (před termínem). Vrátí jen `MAX_MATCH_CANDIDATES` nejbližších, takže se
   žádné široké okno netáhne přes síť. Protože se měří vůči celé trase, poptávka
   poblíž vzdáleného průjezdního bodu se neztratí a kandidáti bez souřadnic se
   filtru vyhnou — v pořadí skončí až na konci.
2. **Řazení variant vložení.** Z hrubé havérsine zajížďky se seřadí varianty a
   přesně přes Compute Routes se ověří jen `MAX_EXACT_VARIANTS_PER_CANDIDATE`
   nejlepších. Přímé trasy mají jedinou variantu a chovají se jako dřív.

Trasa s `n` průjezdními body má až `(n+1)(n+2)/2` přípustných vložení. Když
souřadnice chybí (starší data), spadne server na záložní `computeRouteMatrix`
(jedno Google volání) a teprve pak na deterministické pořadí. Matrix vrací jen
čísla (žádnou geometrii ani adresy).

### Prostorový předvýběr přes PostGIS (fázované zavedení)

Předvýběr jde ještě dál: místo čtyř obyčejných sloupců `bbox_*` se trasa ukládá
jako `route_line geography(LineString, 4326)` s GiST indexem a kandidáti se
filtrují dotazem `ST_DWithin(route_line, bod, radius)` přímo v databázi.
Řazení pak používá `ST_Distance` od trasy místo haversine vzdálenosti od
nejbližšího bodu.

Zavedení je rozdělené na čtyři kroky, aby se dalo mezi nimi zastavit a otočit
zpět (čtvrtý je už úklid a je jednosměrný):

1. `20261005150000_enable_postgis.sql` — `create extension if not exists postgis
   schema extensions` a okamžité ověření, že typ `geography(linestring)` existuje.
   Kdyby extension nebylo v plánu dostupná, skript skončí chybou a další kroky se
   nespustí.
2. `20261005160000_carrier_route_spatial_line.sql` — sloupec `route_line`,
   trigger `assign_carrier_route_line` (geometrii nikdy nezadává klient),
   dopočet existujících řádků a GiST index.
3. `20261005170000_matching_spatial_preselection.sql` — RPC přepsaná přes
   `create or replace` (bez `DROP`, tedy bez okna bez grantu) s prostorovým
   filtrem a řazením podle `ST_Distance`.
4. `20261005180000_matching_spatial_cleanup.sql` — až po ověření produkčního
   chodu: odstraní `bbox_*`, helper i starý trigger a nechá jediný zdroj pravdy
   pro odvozenou geometrii.

Proč filtr bezpečně netrhá platné shody: varianta trasy, která vloží vyzvednutí
P a vyložení D, je oproti základní trase delší nejméně o
`dist(P, trasa) + dist(D, trasa)` — silniční vzdálenost je vždy nejméně
vzdálenost po nejkratším oblouku a obě odbočky jsou nesouběžné části trasy.
Kandidát, jehož některý bod je dále než `max_deviation_km`, by tedy shodu
stejně nedostal. Radius je povolená zajížďka + 10 km rezerva.

Sloupce `bbox_*` se **nemížou hned** — zůstávají v databázi, dokud se nové RPC
neověří v produkci; předchozí krok tak zůstává použitelný jako návratová cesta.
Úklid je samostatný čtvrtý krok (viz níže) a jde o jednosměrnou změnu.

### Úklid po ověření (`20261005180000_matching_spatial_cleanup.sql`)

Teprve když prostorový předvýběr běží v produkci a chovává se správně, odstraní
zastaralý mezikrok:

* trigger `carrier_routes_bbox_assign`, funkci `assign_carrier_route_bbox()`,
  indexy `carrier_routes_bbox_lat_idx`/`_lng_idx` a sloupce `bbox_min_lat`,
  `bbox_max_lat`, `bbox_min_lng`, `bbox_max_lng` (jejich CHECK omezení zmizí
  spolu se sloupci),
* helper `roadlink_haversine_meters`.

Zároveň přepojí odvozování geometrie na **jediný zdroj pravdy** — funkci
`assign_carrier_route_geometry()` s triggerem `carrier_routes_route_geometry_assign`,
a zahodí starou `assign_carrier_route_line()`. Chování je beze změny: klient
geometrii nikdy nezadává, `search_path = ''` i revokace zůstávají. Validační
trigger `carrier_routes_via_places_validate` zůstává nedotčený záměrně — hlídá
vstup, odvozování je věc jediného triggeru.

Migrace je idempotentní (každý `DROP` je přes `if exists`) a běží jako jedna
transakce. Nejdřív běží blok předpokladů, který **skončí výjimkou a nic neuklidí**,
pokud:

1. RPC `get_route_matching_candidates_internal` ještě nečte `bbox_*` nebo
   `roadlink_haversine_meters` (tedy je opravdu použitý prostorový krok),
2. existuje trasa s úplnými souřadnicemi, která má `route_line IS NULL`,
3. nad `carrier_routes` není platný a připravený GiST index.

Migrace nemění žádná data (`route_line`, souřadnice i geometrie zůstávají),
nemění RLS, grants ani RPC, neprovádí žádný `UPDATE`/`DELETE` a nesahá na
veřejný feed. **Vratná není** — sloupce zmizí. Návratová cesta, když je nutná,
je znovu aplikovat `20261005140000_matching_sql_geo_preselection.sql`.

### Ověření po nasazení prostorových kroků

Dva nástroje, oba read-only:

1. **Smoke test v SQL** — `supabase/smoke/matching_spatial_smoke.sql`
   (Supabase SQL Editor nebo `psql`). Ověří předpoklady (extension, typy, sloupec,
   trigger, platný GiST index, RPC bez závislosti na `bbox_*`), pokrytí dat
   (trasa s úplnými souřadnicemi má `route_line`), vypíše `EXPLAIN (ANALYZE,
   BUFFERS)` — izolovanou sondu i celého dotazu předvýběru — a nakonec
   automaticky ověří smlouvu RPC: limit, monotónní pořadí od nejbližšího
   kandidáta a to, že kandidáti bez vypočtené vzdálenosti jsou až na konci.
   V `EXPLAIN` je důležité rozlišit dvě situace. Izolovaná sonda (hledání
   tras v okruhu napříč tabulkou) má v plánu `Index Scan`/`Bitmap Index Scan`
   přes `carrier_routes_route_line_gist_idx`; `Seq Scan` tam znamená, že je v
   datech málo tras a plánovač volí správně. **Plán samotného RPC ale GiST
   nikdy neobsahuje** — RPC filtruje `cr.id = p_route_id`, tedy jednu trasu, a
   prostorová podmínka se vyhodnocuje nad jediným řádkem; očekávaný je tedy
   `Index Scan using carrier_routes_pkey`. Úzké místo předvýběru je spojení
   s `tow_requests`, ne `carrier_routes`.
   Podrobná diagnostika je v `supabase/smoke/matching_spatial_index_proof.sql`.
   Kontrola „RPC nesahá na `bbox_*`“ je
   historická — po úklidu (`20261005180000`) je triviálně splněná, ale nijak
   neublíží, protože i pak má před úklidem co odhalit.
2. **Živý harness RPC** — `.roadlink/matching-spatial-integration.mjs`
   Ověří smlouvu RPC proti živé databázi: limit, pořadí, že cizí trasa nevrátí
   nic a že cizí řidič neuvidí žádného kandidáta. Bez přepínače
   `--confirm-live-spatial-smoke` skončí bez jediného síťového volání.
   Neprochází se do běžného regresního runneru, nevolá Google API ani žádnou
   Edge Function, nemění žádná data a nevypisuje place ID, souřadnice, geometrii
   ani ID trasy — jen počty.

Oba nástroje jsou staticky kryté regresí
[.roadlink/matching-spatial-regression.js](../.roadlink/matching-spatial-regression.js),
takže se smazání bezpečnostních mantinelů zachytí v běžném `npm run check`.

### Omezení a neúplnost

Havérsine i matrix jsou jen bodové odhady pro seřazení — rozhoduje vždy přesné
ověření přes Compute Routes. Pokud se některé varianty nebo kandidáti neověří
(vyčerpaný rozpočet, selhání Google, oříznutí na `MAX_MATCH_CANDIDATES`), odpověď
má `incomplete = true` a UI to zobrazí („Výsledek může být neúplný“). Výsledek
tedy není globálně nejlepší možné vložení, ale nejlepší z přesně ověřených
variant; chyba Google API se nikdy netváří jako „žádné shody“.

### Soukromí

`via_latitudes`/`via_longitudes` zůstávají soukromé: jsou součástí interního RPC
pro `service_role`, veřejný feed je nevybírá a do odpovědi klienta se nikdy
dostanou jen ID poptávky, skóre, kilometry/minuty zajížďky a bezpečné důvody.
Place ID, adresy ani souřadnice se nevrací.

### Nasazení (ruční kroky)

1. Aplikovat dopřednou migraci `20261005120000_matching_includes_via_routes.sql`
   (interní RPC vrací `route_via_place_ids`; grant zůstává jen `service_role`).
2. Aplikovat dopřednou migraci `20261005130000_matching_via_coordinates.sql`
   (přidá `via_latitudes`/`via_longitudes`, validační trigger a RPC s polohou).
3. Aplikovat dopřednou migraci `20261005140000_matching_sql_geo_preselection.sql`
   (přidá `bbox_*`, trigger, indexy, funkci `roadlink_haversine_meters` a RPC
   s polohovým filtrem a pořadím podle blízkosti).
4. Aplikovat `20261005150000_enable_postgis.sql` — pokud skončí chybou, zastavit
   a zjistit, zda je prostorová extension v plánu dostupná.
5. Aplikovat `20261005160000_carrier_route_spatial_line.sql` a read-only ověřit,
   že `route_line` je naplněný u tras se souřadnicemi.
6. Teprve poté `20261005170000_matching_spatial_preselection.sql`.
7. Ověřit nasazení: `supabase/smoke/matching_spatial_smoke.sql` (předpoklady,
   pokrytí, `EXPLAIN`, smlouva RPC) a volitelně
   `.roadlink/matching-spatial-integration.mjs --confirm-live-spatial-smoke`.
8. Nasadit Edge Function `google-route-matches`.
9. Počkat na ověřený produkční chod (alespoň pár dní reálných dotazů) a teprve
   pak aplikovat `20261005180000_matching_spatial_cleanup.sql`. Migrace nejdřív
   ověří předpoklady a při nesplnění skončí výjimkou bez jakékoli změny. Je
   jednosměrná — návrat je znovu aplikovat `20261005140000`.
10. Ověřit read-only, že RPC vrací `route_via_place_ids`, `route_via_latitudes`,
    `route_via_longitudes`, souřadnice poptávky a `route_proximity_meters`, že
    `anon` ani `authenticated` nemají EXECUTE a že `security definer` +
    `search_path = ''` zůstaly.
11. Ověřit limity Google Routes pro mezilehlé body: maximum je 25 intermediátů,
    matching v2 jich použije nejvýše 6 (3 vias + nakládka + vykládka + odjezd).
12. Po úklidu znovu pustit smoke test — celý musí doběhnout bez výjimky.

Vědomé omezení kroku s `bbox_*`: btree index nad dvěma sloupci obdélníku plné
prostorové dotazy neobslouží. Po zavedení a **ověření** `route_line` tento krok
slouží už jen jako návratová cesta a je odstraňován migrací
`20261005180000_matching_spatial_cleanup.sql` — viz výše.

Nic z toho se v tomto kroku nenasazuje.

## Podmínky zahájení integrace

- Google Cloud projekt s aktivním billingem;
- povolené Places API (New) a Routes API;
- samostatný serverový API klíč omezený pouze na tyto dvě API;
- nízké denní kvóty a rozpočtová upozornění pro preview;
- klíč uložen přes `supabase secrets set`, nikdy v `.env` mobilní aplikace nebo v GitHubu.
