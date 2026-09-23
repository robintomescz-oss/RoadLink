# legacy/ — zmrazené pozůstatky refaktoru

Tenhle adresář **není součástí běžící aplikace** a nic z něj nikdo neimportuje.
Vstupní bod projektu je `index.js` → `navigation/AppNavigator`.

## Co tu je a proč

| soubor | původně | stav |
|---|---|---|
| `App.tsx` | kořen projektu | původní monolitický `App.tsx` (3013 řádků) před rozdělením do `screens/`, `hooks/`, `lib/` a `contexts/` |
| `useAuth.ts` | `hooks/useAuth.ts` | stará implementace auth, nahrazená živým `hooks/useAuthSession.ts` |
| `useJobFilters.ts` | `hooks/useJobFilters.ts` | starý filtr zakázek, odkudsi z původního `App.tsx` |

Drží se zde jako referenční záloha původního chování (např. pro dohledání
původních textací, průměrů a toků). Plnohodnotná historie je i v gitu
(`14280ab Záloha MVP - funkční App.tsx před rozdělením`), takže smazání
je vratné.

## Pravidla

- `legacy/` je vyloučený z typechecku (`tsconfig.json` → `exclude`), takže se
  v něm neprojeví žádná změna typů ani rozhraní živého kódu.
- **Neopravujte v něm chyby.** Kopie handlerů tu jsou zastaralé. Živá spodní
  lišta používá uživatelský klíč `"overview"`, který naviguje na route `"home"`.
- **Nehledejte tu aktuální pravdu.** Živá logika je v `components/`, `hooks/`,
  `lib/`, `navigation/` a `screens/`.
- Importy jsou přepsané tak, aby ukazovaly do živého stromu (`../lib/...`,
  `../hooks/...`), aby soubor zůstal čitelný jako reference. Spustit ho ale
  nelze bez vrácení `index.js` na původní entry point.
