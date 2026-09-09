# RoadLink v3 – GPS + mapa + matching prototyp

RoadLink je jedna aplikace se dvěma režimy:
- zákazník
- řidič / odtahová služba

## Co je ve v3 nové
- reálné získání GPS polohy přes `expo-location`
- mapa přes `react-native-maps`
- zákazník vytvoří zakázku s GPS souřadnicemi
- zakázka se okamžitě objeví v režimu řidiče
- řidič může zakázku přijmout
- stav zakázky lze posouvat: hledání → přijato → na cestě → dorazil → naloženo → dokončeno
- zákazník a řidič zůstávají v jedné aplikaci a lze mezi režimy přepínat

## Spuštění
```bash
npm install
npx expo start
```

## Důležitá poznámka
Toto je stále lokální MVP: zakázky jsou uloženy pouze v paměti aplikace. Není zde ještě připojený cloudový backend, autentizace ani skutečný realtime přenos mezi dvěma zařízeními.

## Další produkční krok
Napojit Supabase:
- Auth
- `profiles`
- `vehicles`
- `tow_requests`
- `driver_locations`
- Realtime
- Row Level Security

Poté přidat push notifikace, chat, fotografie, navigaci a platby.
