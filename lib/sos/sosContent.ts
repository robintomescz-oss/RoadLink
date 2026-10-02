/**
 * SOS „Emergency Wizard" – obsah a pravidla.
 *
 * Tento soubor je záměrně bez Reactu a bez přístupu k síti: všechny texty,
 * tísňová čísla a rozhodovací pravidla jsou čistá data + funkce. Díky tomu
 * je lze testovat v Node regresích a zároveň jsou dostupná OFFLINE (jsou
 * součástí balíčku aplikace, ne načítaná z internetu).
 *
 * BEZPEČNOSTNÍ A PRÁVNÍ TEXTY:
 * Právní a bezpečnostní obsah je držen odděleně od UI (viz SOS_LEGAL_METADATA).
 * Obsah je připravený k odborné revizi u Policie ČR, BESIP a HZS – dokud
 * revize neproběhne, reviewStatus to přiznává a aplikace texty nikdy
 * neprezentuje jako právní radu „na 100 %".
 */

// ── Metadata právního/bezpečnostního obsahu ────────────────────────────────

export type SosLegalMetadata = {
  country: "CZ";
  /** Datum odborného ověření. null = ještě neověřeno. */
  verifiedAt: string | null;
  reviewStatus: "pending_expert_review" | "verified";
  sources: string[];
  note: string;
};

export const SOS_LEGAL_METADATA: SosLegalMetadata = {
  country: "CZ",
  verifiedAt: null,
  reviewStatus: "pending_expert_review",
  sources: ["Policie ČR", "BESIP", "HZS"],
  note:
    "Texty o povinnosti přivolat policii a o bezpečnosti na místě nejsou " +
    "právní rada. Před nasazením je musí ověřit Policie ČR, BESIP a HZS. " +
    "Do té doby je ber jako orientační a vždy se řiď pokyny operátora a " +
    "návodem výrobce vozidla.",
};

/** Legal disclaimer zobrazený u nehodového checklistu. */
export const SOS_LEGAL_DISCLAIMER =
  "Orientační informace podle českých předpisů, zatím neověřená odborníkem. " +
  "Nenahrazuje právní radu ani pokyny složek IZS.";

// ── Tísňová čísla ──────────────────────────────────────────────────────────

export type EmergencyContactId = "medical" | "general" | "police";

export type EmergencyContact = {
  id: EmergencyContactId;
  number: string;
  tel: string;
  label: string;
  purpose: string;
  icon: string;
};

export const EMERGENCY_CONTACTS: EmergencyContact[] = [
  {
    id: "medical",
    number: "155",
    tel: "tel:155",
    label: "Zdravotnická záchranná služba",
    purpose: "Zranění nebo náhlá zdravotní potíže.",
    icon: "🚑",
  },
  {
    id: "general",
    number: "112",
    tel: "tel:112",
    label: "Tísňová linka 112",
    purpose: "Požár, bezprostřední nebezpečí, všechno ostatní.",
    icon: "🆘",
  },
  {
    id: "police",
    number: "158",
    tel: "tel:158",
    label: "Policie ČR",
    purpose: "Dopravní nehoda, kterou je nutné nahlásit.",
    icon: "🚓",
  },
];

export function getEmergencyContact(id: EmergencyContactId): EmergencyContact {
  const contact = EMERGENCY_CONTACTS.find((item) => item.id === id);
  if (!contact) throw new Error(`Neznámé tísňové číslo: ${id}`);
  return contact;
}

/** Do telefonu se vždy vstupuje přes odkaz – aplikace NIKDY nevolá sama. */
export const SOS_NEVER_AUTO_CALL_NOTE =
  "Hovor vždy spustíte vy klepnutím na číslo. Aplikace nikdy nevolá automaticky.";

export const SOS_OPERATOR_INSTRUCTION =
  "Řiďte se pokyny operátora. Operátor vidí vaši situaci lépe než aplikace.";

// ── Úvodní rozcestník ──────────────────────────────────────────────────────

export type IntroChoiceId = "injured" | "danger" | "breakdown";

export type IntroChoice = {
  id: IntroChoiceId;
  title: string;
  description: string;
  icon: string;
  /** Tísňová čísla nabízená hned po volbě. První je primární. */
  callContacts: EmergencyContactId[];
};

export const INTRO_CHOICES: IntroChoice[] = [
  {
    id: "injured",
    title: "Někdo je zraněný",
    description: "Zavolejte záchranku 155. Když nevíte, volejte 112.",
    icon: "🚑",
    callContacts: ["medical", "general"],
  },
  {
    id: "danger",
    title: "Požár nebo bezprostřední nebezpečí",
    description: "Zavolejte 112.",
    icon: "🔥",
    callContacts: ["general"],
  },
  {
    id: "breakdown",
    title: "Porucha / nehoda bez zranění",
    description: "Provedeme vás zajištěním místa a určením problému.",
    icon: "🛠️",
    callContacts: [],
  },
];

export const SOS_INTRO_HEADLINE = "Co se stalo?";

export const SOS_INTRO_SUBTEXT =
  "Tísňové volání máte dostupné pořád nahoře. Průvodce nemusíte dokončit, " +
  "abyste mohl(a) volat o pomoc.";

// ── Bezpečnost na místě ────────────────────────────────────────────────────

export type SafetyStepId = "hazard_lights" | "vest" | "safe_exit" | "triangle";

export type SafetyStep = {
  id: SafetyStepId;
  title: string;
  description: string;
  icon: string;
  /** Dodatečné poznámky (např. vzdálenosti trojúhelníku). */
  notes: string[];
};

export const SAFETY_STEPS: SafetyStep[] = [
  {
    id: "hazard_lights",
    title: "Zapněte výstražná světla",
    description:
      "Zapněte blikače, dokud stojíte. Zvyšují viditelnost vozidla pro ostatní.",
    icon: "🔶",
    notes: [],
  },
  {
    id: "vest",
    title: "Oblečte si reflexní vestu",
    description:
      "Než vystoupíte, oblečte si reflexní vestu – pokud ji máte po ruce.",
    icon: "🦺",
    notes: ["Když vestu nemáte, nevystavujte se zbytečně riziku."],
  },
  {
    id: "safe_exit",
    title: "Vystupte bezpečně a přesuňte se mimo vozovku",
    description:
      "Vystupujte na straně od provozu, pokud to jde. Přesuňte se mimo " +
      "jízdní pruhy na bezpečné místo.",
    icon: "🚶",
    notes: [
      "Na dálnici pokud možno za svodidla. Nevstupujte do jízdních pruhů.",
      "Nikdy se nepohybujte v pruzích kvůli kontrole vozidla.",
    ],
  },
  {
    id: "triangle",
    title: "Umístěte výstražný trojúhelník",
    description: "Postavte trojúhelník tak, aby byl včas a zřetelně vidět.",
    icon: "⚠️",
    notes: [
      "Nejméně 50 m za vozidlem, na dálnici nejméně 100 m.",
      "V obci může být vzdálenost podle okolností kratší.",
      "Vzdálenost nepočítejte na kroky – jde o odhad, ne přesné měření.",
    ],
  },
];

/** Volby u každého bezpečnostního kroku. Žádná z nich neblokuje přivolání pomoci. */
export type SafetyActionId = "done" | "already_done" | "not_possible";

export type SafetyAction = {
  id: SafetyActionId;
  label: string;
};

export const SAFETY_ACTIONS: SafetyAction[] = [
  { id: "done", label: "Hotovo" },
  { id: "already_done", label: "Už hotovo" },
  { id: "not_possible", label: "Nelze bezpečně provést" },
];

export const SOS_SAFETY_HEADLINE = "Bezpečnost na místě";

export const SOS_SAFETY_NEVER_BLOCKS =
  "Žádný krok vás nezastaví v přivolání pomoci. Tísňová čísla máte nahoře stále.";

export const SOS_SAFETY_NO_MOVE_INJURED =
  "Se zraněnými nemanipulujte, pokud nejste v bezprostředním ohrožení. " +
  "Postupujte podle pokynů operátora.";

// ── Určení problému ────────────────────────────────────────────────────────

export type ProblemCategoryId =
  | "warning_light"
  | "tyre"
  | "no_start"
  | "out_of_fuel"
  | "wrong_fuel"
  | "accident"
  | "other";

export type ProblemCategory = {
  id: ProblemCategoryId;
  title: string;
  description: string;
  icon: string;
  /** Krátké, bezpečné obecné pokyny – nikdy ne návod na opravu u silnice. */
  guidance: string[];
};

export const PROBLEM_CATEGORIES: ProblemCategory[] = [
  {
    id: "warning_light",
    title: "Kontrolka / hlášení vozidla",
    description: "Svítí nebo bliká kontrolka, případně se objevilo hlášení.",
    icon: "⚠️",
    guidance: [
      "Barva sama o sobě nerozhoduje o tom, jestli můžete pokračovat.",
      "Rozhoduje konkrétní symbol, zda svítí nepřetržitě nebo bliká, hlášení " +
        "vozidla a doprovodné příznaky.",
      "Návod výrobce vašeho vozidla má vždy přednost.",
    ],
  },
  {
    id: "tyre",
    title: "Defekt pneumatiky",
    description: "Prázdná nebo poškozená pneumatika.",
    icon: "🛞",
    guidance: [
      "Zastavte na bezpečném místě mimo jízdní pruhy a zajistěte místo.",
      "Pneumatiku neměňte v jízdním pruhu ani na krajnici dálnice.",
      "Když to nejde bezpečně, zavolejte asistenci.",
    ],
  },
  {
    id: "no_start",
    title: "Nelze nastartovat",
    description: "Vozidlo nestartuje nebo nenaskočí.",
    icon: "🔑",
    guidance: [
      "Nejde automaticky o vybitou baterii – příčin může být víc.",
      "Neprovádějte složité opravy u silnice.",
      "Nechte si poradit nebo zavolejte asistenci.",
    ],
  },
  {
    id: "out_of_fuel",
    title: "Došlo palivo",
    description: "Došel benzín, nafta nebo jiné palivo.",
    icon: "⛽",
    guidance: [
      "Zastavte bezpečně a zajistěte místo.",
      "Doplňování paliva u silnice je rizikové – využijte asistenci.",
    ],
  },
  {
    id: "wrong_fuel",
    title: "Nesprávné palivo",
    description: "Natankovali jste jiné palivo, než vozidlo vyžaduje.",
    icon: "⛔",
    guidance: [
      "Nestartujte a nejeďte – mohlo by dojít k poškození motoru.",
      "Zavolejte asistenci a řiďte se jejími pokyny.",
    ],
  },
  {
    id: "accident",
    title: "Dopravní nehoda",
    description: "Nehoda, při které jde o nahlášení policii.",
    icon: "🚗",
    guidance: [
      "Nejprve zajistěte bezpečnost, potom řešte nahlášení.",
      "Aplikace vám pomůže zkontrolovat, kdy volat policii.",
    ],
  },
  {
    id: "other",
    title: "Jiný problém / nevím",
    description: "Nevíte, o co jde, nebo problém není v seznamu.",
    icon: "❓",
    guidance: [
      "Když si nejste jistí, popište situaci asistenci a nechte si poradit.",
    ],
  },
];

export function getProblemCategory(id: ProblemCategoryId): ProblemCategory {
  const category = PROBLEM_CATEGORIES.find((item) => item.id === id);
  if (!category) throw new Error(`Neznámá kategorie problému: ${id}`);
  return category;
}

// ── Kontrolky – orientační posouzení ───────────────────────────────────────

/**
 * Vstup pro posouzení kontrolky ZÁMĚRNĚ neobsahuje barvu. Aplikace tak nemůže
 * „rozhodnout podle barvy" – posuzuje symbol, chování (svítí/bliká), hlášení
 * vozidla a doprovodné příznaky.
 */
export type WarningLightState = "steady" | "blinking" | "unknown";

export type WarningLightInput = {
  symbol: string;
  state: WarningLightState;
  hasVehicleMessage: boolean;
  symptoms: string[];
};

export type WarningLightAssessment = {
  kind: "orientational";
  headline: string;
  urgent: boolean;
  considerations: string[];
  recommendation: string;
  manufacturerTakesPrecedence: boolean;
  disclaimers: string[];
};

/** Příznaky, které indikují bezprostřední nebezpečí a urgují zastavení. */
export const WARNING_LIGHT_URGENT_SYMPTOMS = [
  "smoke",
  "fire",
  "brakes",
  "steering",
  "overheating",
];

export const WARNING_LIGHT_COMMON_SYMPTOMS: Array<{ id: string; label: string }> = [
  { id: "loss_of_power", label: "Ztráta výkonu" },
  { id: "smoke", label: "Kouř" },
  { id: "fire", label: "Zážeh nebo oheň" },
  { id: "brakes", label: "Problém s brzdami" },
  { id: "steering", label: "Problém s řízením" },
  { id: "overheating", label: "Přehřívání" },
  { id: "smell", label: "Netypický zápach" },
  { id: "noise", label: "Netypický zvuk" },
];

export function assessWarningLight(input: WarningLightInput): WarningLightAssessment {
  const urgent = input.symptoms.some((symptom) =>
    WARNING_LIGHT_URGENT_SYMPTOMS.includes(symptom)
  );

  const considerations: string[] = [];
  considerations.push(
    "Záleží na konkrétním symbolu, ne na barvě. Stejná barva může znamenat " +
      "různě vážné věci podle vozidla."
  );
  if (input.state === "blinking") {
    considerations.push(
      "Blikající kontrolka bývá naléhavější než trvale svítící."
    );
  } else if (input.state === "steady") {
    considerations.push(
      "Trvale svítící kontrolka může znamenat různě vážné stavy podle vozidla."
    );
  } else {
    considerations.push(
      "Nevíte, zda kontrolka svítí nebo bliká – berte to jako nejistotu."
    );
  }
  if (input.hasVehicleMessage) {
    considerations.push(
      "Hlášení vozidla na displeji často upřesní, co kontrolka znamená."
    );
  }
  if (input.symptoms.length > 0) {
    considerations.push(
      "Doprovodné příznaky rozhodují víc než samotná kontrolka."
    );
  }

  const recommendation = urgent
    ? "Bezpečně zastavte mimo jízdní pruhy, zajistěte místo a volejte " +
      "odbornou pomoc. V případě ohně nebo kouře volejte 112."
    : "Nepokračujte v jízdě naslepo. Ověřte význam v návodu vozidla, a když " +
      "si nejste jistí, zavolejte asistenci místo hádání diagnózy.";

  return {
    kind: "orientational",
    headline: urgent
      ? "Možné bezprostřední nebezpečí – bezpečně zastavte"
      : "Orientační posouzení – ověřte v návodu vozidla",
    urgent,
    considerations,
    recommendation,
    manufacturerTakesPrecedence: true,
    disclaimers: [
      "Výsledek je orientační, nejde o diagnózu.",
      "Návod výrobce vašeho vozidla má přednost.",
      "Neexistuje obecné pravidlo „oranžová = dojet“ ani „červená = hned vypnout motor“.",
    ],
  };
}

// ── Dopravní nehoda – český checklist ──────────────────────────────────────

export type AccidentAnswer = "yes" | "no" | "unknown";

export type AccidentChecklistItem = {
  id: string;
  question: string;
  /** true = zákonný důvod přivolat policii. */
  legal: boolean;
  note?: string;
};

/**
 * Zákonné důvody, kdy je nutné přivolat policii. Limit 200 000 Kč platí pro
 * KAŽDÉ zúčastněné vozidlo zvlášť (včetně přepravovaných věcí), NENÍ to součet.
 */
export const ACCIDENT_CHECKLIST: AccidentChecklistItem[] = [
  {
    id: "injury",
    question: "Došlo ke zranění nebo úmrtí?",
    legal: true,
  },
  {
    id: "damage_over_200k",
    question:
      "Přesahuje škoda zřejmě 200 000 Kč na některém ze zúčastněných vozidel " +
      "včetně přepravovaných věcí?",
    legal: true,
    note:
      "Limit se posuzuje u každého vozidla zvlášť. Není to součet škod všech vozidel.",
  },
  {
    id: "third_party_property",
    question:
      "Došlo ke škodě na majetku třetí osoby (např. plot, budova, jiné vozidlo " +
      "mimo účastníky), s výjimkou zákonných výjimek?",
    legal: true,
  },
  {
    id: "road_damage",
    question: "Byla poškozena součást nebo příslušenství komunikace?",
    legal: true,
  },
  {
    id: "traffic_flow",
    question:
      "Nelze obnovit plynulost provozu vlastními silami bez nepřiměřeného úsilí?",
    legal: true,
  },
];

/** Doporučení (NE zákonná povinnost) zavolat policii. */
export type AccidentRecommendation = {
  id: string;
  question: string;
};

export const ACCIDENT_RECOMMENDATIONS: AccidentRecommendation[] = [
  { id: "dispute", question: "Vzniká spor o tom, kdo nehodu zavinil?" },
  {
    id: "refusal",
    question: "Odmítá druhý účastník sdělit potřebné údaje?",
  },
  {
    id: "uncertainty",
    question: "Nejste si jistí, co je správné udělat?",
  },
];

export type AccidentEvaluation = {
  callPolice: boolean;
  hasUnknownLegal: boolean;
  legalReasons: string[];
  recommendations: string[];
  note: string;
};

/**
 * Vyhodnotí checklist. Odděluje zákonné důvody (legal) od doporučení.
 * callPolice = true, jakmile je některý zákonný bod „yes", NEBO zákonný bod
 * zůstal „unknown" (raději ověřit).
 */
export function evaluateAccidentChecklist(
  answers: Record<string, AccidentAnswer>
): AccidentEvaluation {
  const legalReasons: string[] = [];
  let hasUnknownLegal = false;
  let hasLegalYes = false;

  for (const item of ACCIDENT_CHECKLIST) {
    const answer = answers[item.id] ?? "unknown";
    if (answer === "yes") {
      hasLegalYes = true;
      legalReasons.push(item.question);
    } else if (answer === "unknown") {
      hasUnknownLegal = true;
    }
  }

  const recommendations = ACCIDENT_RECOMMENDATIONS.filter(
    (item) => (answers[item.id] ?? "no") === "yes"
  ).map((item) => item.question);

  return {
    callPolice: hasLegalYes || hasUnknownLegal,
    hasUnknownLegal,
    legalReasons,
    recommendations,
    note:
      "Zákonné důvody jsou oddělené od doporučení. U nejistoty je bezpečnější " +
      "policii kontaktovat.",
  };
}

export const SOS_ACCIDENT_NO_POLICE_REMINDER =
  "Pokud policii nevoláte: sepište společný podepsaný záznam o nehodě " +
  "(co, kdy, kde, jak) a vyměňte si potřebné údaje. Fotografujte jen z " +
  "bezpečného místa, nikdy ne z jízdních pruhů.";

export const SOS_ACCIDENT_HEADLINE = "Mám volat policii?";

// ── Předání údajů partnerovi / asistenci ───────────────────────────────────

export const SOS_DATA_SHARING_INTRO =
  "Pokud objednáte asistenci u partnera, budou mu předány jen údaje potřebné " +
  "ke zásahu. Nic se neodesílá, dokud objednávku nepotvrdíte.";

export const SOS_DATA_SHARED_ITEMS = [
  "Poloha a její přesnost (nebo popis místa, který zadáte ručně).",
  "Zvolený problém.",
  "Údaje o vozidle (z profilu nebo zadané ručně).",
  "Kontakt, který zadáte pro zpětnou vazbu.",
];

export const SOS_ORDER_ONE_CONFIRMATION =
  "Objednávku potvrdíte jedním klepnutím. Opakované klepnutí nevytvoří duplicitní objednávku.";

export const SOS_ORDER_NO_PARTNER_YET =
  "Objednání u partnerské asistence zatím není dostupné – tento projekt nemá " +
  "připojené žádné reálné partnerské API. Můžete místo toho volat pomoc " +
  "přímo. Aplikace nic nepředstírá.";
