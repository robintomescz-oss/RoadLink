import React from "react";
import {
  Alert,
  Linking,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "../../components/SafeAreaViewCompat";
import { useAppContext } from "../../contexts/AppContext";
import { navigateLegacy } from "../../navigation/navigationRef";
import { sosStyles as S, SOS } from "../../lib/sosStyles";
import {
  ACCIDENT_CHECKLIST,
  ACCIDENT_RECOMMENDATIONS,
  EMERGENCY_CONTACTS,
  INTRO_CHOICES,
  PROBLEM_CATEGORIES,
  SAFETY_ACTIONS,
  SAFETY_STEPS,
  SOS_ACCIDENT_HEADLINE,
  SOS_ACCIDENT_NO_POLICE_REMINDER,
  SOS_DATA_SHARED_ITEMS,
  SOS_DATA_SHARING_INTRO,
  SOS_INTRO_HEADLINE,
  SOS_INTRO_SUBTEXT,
  SOS_LEGAL_DISCLAIMER,
  SOS_LEGAL_METADATA,
  SOS_NEVER_AUTO_CALL_NOTE,
  SOS_OPERATOR_INSTRUCTION,
  SOS_ORDER_ONE_CONFIRMATION,
  SOS_SAFETY_HEADLINE,
  SOS_SAFETY_NEVER_BLOCKS,
  SOS_SAFETY_NO_MOVE_INJURED,
  WARNING_LIGHT_COMMON_SYMPTOMS,
  assessWarningLight,
  getEmergencyContact,
  evaluateAccidentChecklist,
  type AccidentAnswer,
  type EmergencyContactId,
  type IntroChoiceId,
  type ProblemCategoryId,
  type SafetyActionId,
  type WarningLightInput,
} from "../../lib/sos/sosContent";
import {
  ROAD_TYPE_LABELS,
  SOS_ETA_IS_ESTIMATE,
  SOS_LOCATION_COORDINATES_ARE_SEPARATE,
  SOS_OFFLINE_NOTE,
  SOS_OFFLINE_SAFETY_STEPS,
  SUGGESTED_ROAD_TYPES,
  applyAccidentAnswer,
  applyIntroChoice,
  applySafetyAction,
  applyWarningLight,
  beginOrder,
  buildRequestSummary,
  canSubmitOrder,
  describeLocation,
  goToStage,
  isOrderBusy,
  orderFailed,
  orderSent,
  orderStatusChanged,
  orderStatusView,
  resetFailedOrder,
  selectProblem,
  setManualLocation,
  setRoadType,
  setVehicle,
  suggestRoadType,
  type RoadType,
  type SosState,
} from "../../lib/sos/sosState";
import { personalVehicleDisplayLabel } from "../../lib/personalVehicles";
import {
  defaultClientRequestId,
  cancelConfirmedOrder,
  getAssistanceProvider,
  resolveClientRequestId,
} from "../../lib/sos/assistanceProvider";

// ── Tísňové volání (trvale dostupné) ───────────────────────────────────────

function callNumber(contactId: EmergencyContactId) {
  const contact = getEmergencyContact(contactId);
  Linking.openURL(contact.tel).catch(() => {
    Alert.alert(
      "Nelze otevřít volání",
      `Číslo ${contact.number} se nepodařilo otevřít. Zkontrolujte prosím ` +
        "telefonní signál a zkuste to znovu.",
      [{ text: "Rozumím" }]
    );
  });
}

function EmergencyCallBar() {
  return (
    <View style={S.emergencyBar}>
      <Text style={S.emergencyBarTitle}>TÍSŇOVÉ VOLÁNÍ</Text>
      <View style={S.emergencyRow}>
        {EMERGENCY_CONTACTS.map((contact) => (
          <TouchableOpacity
            key={contact.id}
            style={[
              S.emergencyButton,
              contact.id === "police" && S.emergencyButtonPolice,
            ]}
            onPress={() => callNumber(contact.id)}
            accessibilityRole="button"
            accessibilityLabel={`Zavolat ${contact.label} ${contact.number}`}
            accessibilityHint="Otevře telefonní aplikaci s předvyplněným číslem. Hovor spustíte vy."
          >
            <Text style={S.emergencyNumber} allowFontScaling>
              {contact.icon} {contact.number}
            </Text>
            <Text style={S.emergencyLabel} allowFontScaling>
              {contact.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={S.neverAutoCall} allowFontScaling>
        {SOS_NEVER_AUTO_CALL_NOTE}
      </Text>
    </View>
  );
}

// ── Opakovaně použitelné stavební prvky ────────────────────────────────────

function BigButton({
  label,
  onPress,
  variant = "primary",
  disabled,
  accessibilityHint,
}: {
  label: string;
  onPress: () => void;
  variant?: "primary" | "danger" | "secondary";
  disabled?: boolean;
  accessibilityHint?: string;
}) {
  const style =
    variant === "secondary"
      ? [S.secondary, disabled && S.disabled]
      : [S.primary, variant === "danger" && S.primaryDanger, disabled && S.disabled];
  return (
    <TouchableOpacity
      style={style}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
    >
      <Text style={variant === "secondary" ? S.secondaryText : S.primaryText} allowFontScaling>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function Chip({
  label,
  active,
  onPress,
  accessibilityLabel,
}: {
  label: string;
  active?: boolean;
  onPress: () => void;
  accessibilityLabel?: string;
}) {
  return (
    <TouchableOpacity
      style={[S.chip, active && S.chipActive]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: Boolean(active) }}
      accessibilityLabel={accessibilityLabel || label}
    >
      <Text style={S.chipText} allowFontScaling>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

// ── Úvodní rozcestník ──────────────────────────────────────────────────────

function IntroPanel({ onChoose }: { onChoose: (id: IntroChoiceId) => void }) {
  return (
    <View style={S.content}>
      <Text style={S.bigTitle} allowFontScaling accessibilityRole="header">
        {SOS_INTRO_HEADLINE}
      </Text>
      <Text style={S.sectionText} allowFontScaling>
        {SOS_INTRO_SUBTEXT}
      </Text>
      {INTRO_CHOICES.map((choice) => (
        <TouchableOpacity
          key={choice.id}
          style={S.choiceCard}
          onPress={() => onChoose(choice.id)}
          accessibilityRole="button"
          accessibilityLabel={`${choice.title}. ${choice.description}`}
        >
          <Text style={S.choiceIcon} allowFontScaling>
            {choice.icon}
          </Text>
          <View style={S.choiceBody}>
            <Text style={S.choiceTitle} allowFontScaling>
              {choice.title}
            </Text>
            <Text style={S.choiceDesc} allowFontScaling>
              {choice.description}
            </Text>
          </View>
          <Text style={S.choiceArrow}>›</Text>
        </TouchableOpacity>
      ))}
      <Text style={S.footnote} allowFontScaling>
        Modul funguje i bez registrace. Bezpečnostní pokyny a tísňová čísla máte
        i offline.
      </Text>
    </View>
  );
}

// ── Volání po úvodu ────────────────────────────────────────────────────────

function CallPanel({
  choice,
  onContinue,
}: {
  choice: IntroChoiceId;
  onContinue: () => void;
}) {
  const contacts =
    choice === "injured" ? ["medical", "general"] : choice === "danger" ? ["general"] : [];
  return (
    <View style={S.content}>
      <Text style={S.bigTitle} allowFontScaling accessibilityRole="header">
        {choice === "injured" ? "Zavolejte pomoc" : "Volejte 112"}
      </Text>
      <Text style={S.sectionText} allowFontScaling>
        {SOS_OPERATOR_INSTRUCTION}
      </Text>
      {contacts.map((id) => {
        const contact = getEmergencyContact(id as EmergencyContactId);
        return (
          <TouchableOpacity
            key={contact.id}
            style={[S.emergencyButton, { minHeight: 84 }]}
            onPress={() => callNumber(contact.id)}
            accessibilityRole="button"
            accessibilityLabel={`Zavolat ${contact.label} ${contact.number}`}
          >
            <Text style={S.emergencyNumber} allowFontScaling>
              {contact.icon} ZAVOLAT {contact.number}
            </Text>
            <Text style={S.emergencyLabel} allowFontScaling>
              {contact.label}
            </Text>
          </TouchableOpacity>
        );
      })}
      <BigButton label="Pokračovat – zajištění místa" onPress={onContinue} variant="secondary" />
      <Text style={S.footnote} allowFontScaling>
        Volání není podmíněné dokončením průvodce.
      </Text>
    </View>
  );
}

// ── Bezpečnost na místě ────────────────────────────────────────────────────

function SafetyPanel({
  state,
  onAction,
  onContinue,
}: {
  state: SosState;
  onAction: (stepId: string, action: SafetyActionId) => void;
  onContinue: () => void;
}) {
  return (
    <View style={S.content}>
      <Text style={S.bigTitle} allowFontScaling accessibilityRole="header">
        {SOS_SAFETY_HEADLINE}
      </Text>
      <Text style={S.sectionText} allowFontScaling>
        {SOS_SAFETY_NEVER_BLOCKS}
      </Text>
      <Text style={S.dangerText} allowFontScaling>
        {SOS_SAFETY_NO_MOVE_INJURED}
      </Text>
      {SAFETY_STEPS.map((step) => {
        const chosen = state.safety[step.id];
        return (
          <View key={step.id} style={S.card}>
            <View style={S.stepHeaderRow}>
              <Text style={S.stepIcon} allowFontScaling>
                {step.icon}
              </Text>
              <Text style={S.stepTitle} allowFontScaling>
                {step.title}
              </Text>
            </View>
            <Text style={S.cardText} allowFontScaling>
              {step.description}
            </Text>
            {step.notes.map((note) => (
              <Text key={note} style={S.noteText} allowFontScaling>
                • {note}
              </Text>
            ))}
            <View style={S.actionRow}>
              {SAFETY_ACTIONS.map((action) => {
                const active = chosen === action.id;
                const activeStyle =
                  action.id === "not_possible"
                    ? S.actionButtonWarn
                    : action.id === "done" || action.id === "already_done"
                    ? S.actionButtonDone
                    : S.actionButtonActive;
                return (
                  <TouchableOpacity
                    key={action.id}
                    style={[S.actionButton, active && activeStyle]}
                    onPress={() => onAction(step.id, action.id)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={`${step.title}: ${action.label}`}
                  >
                    <Text style={S.actionButtonText} allowFontScaling>
                      {action.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        );
      })}
      <BigButton label="Pokračovat – určit problém" onPress={onContinue} />
      <View style={S.disclosureCard}>
        <Text style={S.cardTitle} allowFontScaling>
          Offline bezpečnostní pokyny
        </Text>
        {SOS_OFFLINE_SAFETY_STEPS.map((step) => (
          <Text key={step} style={S.noteText} allowFontScaling>
            • {step}
          </Text>
        ))}
        <Text style={S.footnote} allowFontScaling>
          {SOS_OFFLINE_NOTE}
        </Text>
      </View>
    </View>
  );
}

// ── Určení problému ────────────────────────────────────────────────────────

function ProblemPanel({
  state,
  onSelect,
  onWarningLightChange,
  onContinue,
}: {
  state: SosState;
  onSelect: (id: ProblemCategoryId) => void;
  onWarningLightChange: (input: WarningLightInput) => void;
  onContinue: () => void;
}) {
  const isWarningLight = state.problem === "warning_light";
  return (
    <View style={S.content}>
      <Text style={S.bigTitle} allowFontScaling accessibilityRole="header">
        Co se pokazilo?
      </Text>
      <Text style={S.sectionText} allowFontScaling>
        Vyberte, co nejlépe odpovídá situaci. Když si nejste jistí, zvolte „Jiný
        problém / nevím".
      </Text>
      {PROBLEM_CATEGORIES.map((category) => {
        const active = state.problem === category.id;
        return (
          <View key={category.id} style={[S.card, active && S.chipActive]}>
            <Text style={S.cardTitle} allowFontScaling>
              {category.icon} {category.title}
            </Text>
            <Text style={S.cardText} allowFontScaling>
              {category.description}
            </Text>
            {category.guidance.map((line) => (
              <Text key={line} style={S.noteText} allowFontScaling>
                • {line}
              </Text>
            ))}
            <BigButton
              label={active ? "Vybráno" : "Vybrat"}
              variant={active ? "primary" : "secondary"}
              onPress={() => onSelect(category.id)}
              accessibilityHint={`Nastaví problém: ${category.title}`}
            />
          </View>
        );
      })}
      {isWarningLight ? (
        <WarningLightPanel input={state.warningLight} onChange={onWarningLightChange} />
      ) : null}
      <BigButton label="Pokračovat k přivolání pomoci" onPress={onContinue} />
    </View>
  );
}

function WarningLightPanel({
  input,
  onChange,
}: {
  input: WarningLightInput | null;
  onChange: (input: WarningLightInput) => void;
}) {
  const [symbol, setSymbol] = React.useState(input?.symbol ?? "");
  const [state, setState] = React.useState<WarningLightInput["state"]>(
    input?.state ?? "unknown"
  );
  const [hasMessage, setHasMessage] = React.useState(input?.hasVehicleMessage ?? false);
  const [symptoms, setSymptoms] = React.useState<string[]>(input?.symptoms ?? []);

  const assessment = assessWarningLight({
    symbol,
    state,
    hasVehicleMessage: hasMessage,
    symptoms,
  });

  function toggleSymptom(id: string) {
    setSymptoms((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    );
  }

  return (
    <View style={S.disclosureCard}>
      <Text style={S.cardTitle} allowFontScaling accessibilityRole="header">
        ⚠️ Kontrolka – orientační posouzení
      </Text>
      <Text style={S.inputLabel} allowFontScaling>
        Jaký symbol kontrolka ukazuje? (popište slovy)
      </Text>
      <TextInput
        style={S.input}
        value={symbol}
        onChangeText={(text) => {
          setSymbol(text);
          onChange({ symbol: text, state, hasVehicleMessage: hasMessage, symptoms });
        }}
        placeholder="např. olejnička, motor, baterie"
        placeholderTextColor={SOS.textFaint}
        accessibilityLabel="Popis symbolu kontrolky"
        allowFontScaling
      />
      <Text style={S.inputLabel} allowFontScaling>
        Svítí, nebo bliká?
      </Text>
      <View style={S.chipRow}>
        <Chip
          label="Svítí"
          active={state === "steady"}
          onPress={() => {
            setState("steady");
            onChange({ symbol, state: "steady", hasVehicleMessage: hasMessage, symptoms });
          }}
        />
        <Chip
          label="Bliká"
          active={state === "blinking"}
          onPress={() => {
            setState("blinking");
            onChange({ symbol, state: "blinking", hasVehicleMessage: hasMessage, symptoms });
          }}
        />
        <Chip
          label="Nevím"
          active={state === "unknown"}
          onPress={() => {
            setState("unknown");
            onChange({ symbol, state: "unknown", hasVehicleMessage: hasMessage, symptoms });
          }}
        />
      </View>
      <Text style={S.inputLabel} allowFontScaling>
        Doprovodné příznaky
      </Text>
      <View style={S.chipRow}>
        {WARNING_LIGHT_COMMON_SYMPTOMS.map((symptom) => (
          <Chip
            key={symptom.id}
            label={symptom.label}
            active={symptoms.includes(symptom.id)}
            onPress={() => {
              const next = symptoms.includes(symptom.id)
                ? symptoms.filter((item) => item !== symptom.id)
                : [...symptoms, symptom.id];
              setSymptoms(next);
              onChange({ symbol, state, hasVehicleMessage: hasMessage, symptoms: next });
            }}
          />
        ))}
      </View>
      <View style={S.actionRow}>
        <TouchableOpacity
          style={[S.chip, hasMessage && S.chipActive]}
          onPress={() => {
            const next = !hasMessage;
            setHasMessage(next);
            onChange({ symbol, state, hasVehicleMessage: next, symptoms });
          }}
          accessibilityRole="button"
          accessibilityState={{ selected: hasMessage }}
          accessibilityLabel="Vozidlo zobrazuje textové hlášení"
        >
          <Text style={S.chipText} allowFontScaling>
            {hasMessage ? "☑" : "☐"} Vozidlo ukazuje hlášení
          </Text>
        </TouchableOpacity>
      </View>

      <View style={S.divider} />
      <Text style={assessment.urgent ? S.dangerText : S.cardTitle} allowFontScaling>
        {assessment.headline}
      </Text>
      {assessment.considerations.map((line) => (
        <Text key={line} style={S.noteText} allowFontScaling>
          • {line}
        </Text>
      ))}
      <Text style={S.cardText} allowFontScaling>
        {assessment.recommendation}
      </Text>
      {assessment.disclaimers.map((line) => (
        <Text key={line} style={S.footnote} allowFontScaling>
          {line}
        </Text>
      ))}
    </View>
  );
}

// ── Dopravní nehoda ────────────────────────────────────────────────────────

const ACCIDENT_ANSWER_OPTIONS: Array<{ id: AccidentAnswer; label: string }> = [
  { id: "yes", label: "Ano" },
  { id: "no", label: "Ne" },
  { id: "unknown", label: "Nevím" },
];

function AccidentPanel({
  state,
  onAnswer,
  onContinue,
}: {
  state: SosState;
  onAnswer: (id: string, answer: AccidentAnswer) => void;
  onContinue: () => void;
}) {
  const evaluation = evaluateAccidentChecklist(state.accident);
  return (
    <View style={S.content}>
      <Text style={S.bigTitle} allowFontScaling accessibilityRole="header">
        {SOS_ACCIDENT_HEADLINE}
      </Text>
      <Text style={S.sectionText} allowFontScaling>
        Zaškrtněte, co platí. Zelené ano znamená zákonný důvod volat policii.
      </Text>
      <Text style={S.footnote} allowFontScaling>
        {SOS_LEGAL_DISCLAIMER} Země: {SOS_LEGAL_METADATA.country}. Stav ověření:{" "}
        {SOS_LEGAL_METADATA.reviewStatus === "verified"
          ? `ověřeno ${SOS_LEGAL_METADATA.verifiedAt}`
          : "čeká na odbornou revizi (Policie ČR, BESIP, HZS)"}
        .
      </Text>

      {ACCIDENT_CHECKLIST.map((item) => (
        <View key={item.id} style={S.card}>
          <Text style={S.cardTitle} allowFontScaling>
            {item.question}
          </Text>
          {item.note ? (
            <Text style={S.noteText} allowFontScaling>
              {item.note}
            </Text>
          ) : null}
          <View style={S.actionRow}>
            {ACCIDENT_ANSWER_OPTIONS.map((option) => (
              <TouchableOpacity
                key={option.id}
                style={[
                  S.actionButton,
                  state.accident[item.id] === option.id && S.actionButtonActive,
                ]}
                onPress={() => onAnswer(item.id, option.id)}
                accessibilityRole="button"
                accessibilityState={{ selected: state.accident[item.id] === option.id }}
                accessibilityLabel={`${item.question} – ${option.label}`}
              >
                <Text style={S.actionButtonText} allowFontScaling>
                  {option.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      ))}

      <View style={S.card}>
        <Text style={S.cardTitle} allowFontScaling>
          Doporučení (ne zákonná povinnost) zavolat policii
        </Text>
        {ACCIDENT_RECOMMENDATIONS.map((item) => (
          <View key={item.id} style={S.actionRow}>
            <Text style={[S.noteText, { flex: 1 }]} allowFontScaling>
              {item.question}
            </Text>
            {ACCIDENT_ANSWER_OPTIONS.map((option) => (
              <TouchableOpacity
                key={option.id}
                style={[
                  S.actionButton,
                  { flexBasis: "auto", flexGrow: 0 },
                  state.accident[item.id] === option.id && S.actionButtonActive,
                ]}
                onPress={() => onAnswer(item.id, option.id)}
                accessibilityRole="button"
                accessibilityState={{ selected: state.accident[item.id] === option.id }}
                accessibilityLabel={`${item.question} – ${option.label}`}
              >
                <Text style={S.actionButtonText} allowFontScaling>
                  {option.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        ))}
      </View>

      <View style={S.card} accessibilityLiveRegion="polite">
        <Text style={S.cardTitle} allowFontScaling>
          Závěr
        </Text>
        {evaluation.callPolice ? (
          <>
            <Text style={S.dangerText} allowFontScaling>
              Podle odpovědí se doporučuje volat policii (158).
            </Text>
            {evaluation.legalReasons.map((reason) => (
              <Text key={reason} style={S.noteText} allowFontScaling>
                • {reason}
              </Text>
            ))}
            {evaluation.hasUnknownLegal ? (
              <Text style={S.noteText} allowFontScaling>
                • Ne všechny zákonné body jsou vyplněné – u nejistoty je
                bezpečnější policii kontaktovat.
              </Text>
            ) : null}
            <BigButton
              label="Zavolat 158 (Policie ČR)"
              onPress={() => callNumber("police")}
              variant="danger"
            />
          </>
        ) : (
          <Text style={S.successText} allowFontScaling>
            Podle vyplněných odpovědí není zákonný důvod volat policii.
          </Text>
        )}
        {evaluation.recommendations.length > 0 ? (
          <Text style={S.noteText} allowFontScaling>
            Doporučení: {evaluation.recommendations.join(" ")}
          </Text>
        ) : null}
        <Text style={S.noteText} allowFontScaling>
          {SOS_ACCIDENT_NO_POLICE_REMINDER}
        </Text>
      </View>

      <BigButton label="Pokračovat k přivolání pomoci" onPress={onContinue} />
    </View>
  );
}

// ── Přivolání asistence ────────────────────────────────────────────────────

function AssistancePanel({
  state,
  locationSummary,
  locationError,
  onRequestLocation,
  onManualLocation,
  onRoadType,
  vehicleOptions,
  onAddPersonalVehicle,
  onSelectVehicle,
  onConfirm,
  onGetOffer,
  onBack,
}: {
  state: SosState;
  locationSummary: ReturnType<typeof describeLocation>;
  locationError: string;
  onRequestLocation: () => void;
  onManualLocation: (text: string) => void;
  onRoadType: (type: RoadType) => void;
  vehicleOptions: Array<{ id: string; label: string; make: string; model: string; registration: string }>;
  /** Odkaz z prázdného stavu do profilu, kde se vozidlo přidá. */
  onAddPersonalVehicle: () => void;
  onSelectVehicle: (vehicle: { source: "profile" | "manual"; label: string; make: string; model: string; registration: string }) => void;
  onConfirm: () => void;
  onGetOffer: () => void;
  onBack: () => void;
}) {
  const { sosBooking, personalVehiclesState } = useAppContext();
  const [make, setMake] = React.useState(state.vehicle?.make ?? "");
  const [model, setModel] = React.useState(state.vehicle?.model ?? "");
  const [registration, setRegistration] = React.useState(state.vehicle?.registration ?? "");
  const [assistancePhone, setAssistancePhone] = React.useState("");
  const phoneNumber = assistancePhone.replace(/[\s()-]/g, "");
  const validPhone = /^\+?[0-9]{9,15}$/.test(phoneNumber);
  const providerConfigured = getAssistanceProvider().isConfigured();

  const roadSuggestion = suggestRoadType({
    mapDataAvailable: false,
    suggested: "unknown",
    userOverride: state.roadTypeEdited ? state.roadType : null,
  });

  const summary = buildRequestSummary({
    problemId: state.problem,
    location: locationSummary,
    vehicle: state.vehicle,
    roadType: state.roadType,
  });

  const busy = isOrderBusy(state);
  const canSubmit = canSubmitOrder(state);

  return (
    <View style={S.content}>
      <Text style={S.bigTitle} allowFontScaling accessibilityRole="header">
        Přivolání pomoci
      </Text>

      {/* Poloha */}
      <View style={S.card}>
        <Text style={S.cardTitle} allowFontScaling>
          📍 Poloha
        </Text>
        <Text style={S.cardText} allowFontScaling>
          {locationSummary.description}
        </Text>
        <Text style={S.noteText} allowFontScaling>
          {locationSummary.accuracyText}
        </Text>
        {locationSummary.freshness === "stale" ? (
          <Text style={S.dangerText} allowFontScaling>
            {locationSummary.disclaimer}
          </Text>
        ) : (
          <Text style={S.footnote} allowFontScaling>
            {locationSummary.disclaimer}
          </Text>
        )}
        {locationError ? (
          <Text style={S.dangerText} allowFontScaling>
            {locationError}
          </Text>
        ) : null}
        <BigButton
          label="Zjistit aktuální polohu"
          variant="secondary"
          onPress={onRequestLocation}
          accessibilityHint="Vyžádá polohu jen pro účel přivolání pomoci."
        />
        <Text style={S.inputLabel} allowFontScaling>
          Nebo popište místo ručně (např. dálnice D1, km 112, směr Brno)
        </Text>
        <TextInput
          style={[S.input, S.multilineInput]}
          value={state.manualLocation}
          onChangeText={onManualLocation}
          placeholder="Popis místa, směr, kilometr…"
          placeholderTextColor={SOS.textFaint}
          multiline
          accessibilityLabel="Ruční popis místa"
          allowFontScaling
        />
        <Text style={S.footnote} allowFontScaling>
          {SOS_LOCATION_COORDINATES_ARE_SEPARATE}
        </Text>
        <Text style={S.inputLabel} allowFontScaling>
          Typ komunikace (můžete opravit)
        </Text>
        <View style={S.chipRow}>
          {SUGGESTED_ROAD_TYPES.map((type) => (
            <Chip
              key={type}
              label={ROAD_TYPE_LABELS[type]}
              active={state.roadType === type}
              onPress={() => onRoadType(type)}
              accessibilityLabel={`Typ komunikace: ${ROAD_TYPE_LABELS[type]}`}
            />
          ))}
        </View>
        <Text style={S.footnote} allowFontScaling>
          {roadSuggestion.note}
        </Text>
      </View>

      {/* Vozidlo */}
      <View style={S.card}>
        <Text style={S.cardTitle} allowFontScaling>
          🚗 Vozidlo
        </Text>
        {vehicleOptions.length > 0 ? (
          <View style={S.chipRow}>
            {vehicleOptions.map((option) => (
              <Chip
                key={option.id}
                label={option.label}
                active={state.vehicle?.label === option.label && state.vehicle?.source === "profile"}
                onPress={() => {
                  // Výběr vozidla předvyplní i textová pole, aby je uživatel mohl
                  // libovolně upravit před odesláním.
                  setMake(option.make);
                  setModel(option.model);
                  setRegistration(option.registration);
                  onSelectVehicle({
                    source: "profile",
                    label: option.label,
                    make: option.make,
                    model: option.model,
                    registration: option.registration,
                  });
                }}
                accessibilityLabel={`Vozidlo z profilu: ${option.label}`}
              />
            ))}
          </View>
        ) : (
          <Text style={S.noteText} allowFontScaling>
            V profilu nemáte uložené žádné osobní vozidlo. Zadejte ho ručně – pomoc
            můžete přivolat i bez registrace.
          </Text>
        )}
        {personalVehiclesState.personalVehicles.length === 0 ? (
          <TouchableOpacity style={S.noteLink} onPress={onAddPersonalVehicle} accessibilityRole="button" accessibilityLabel="Přidat moje vozidlo do profilu">
            <Text style={S.noteLinkText} allowFontScaling>Přidat vozidlo do profilu</Text>
          </TouchableOpacity>
        ) : null}
        <Text style={S.inputLabel} allowFontScaling>
          Značka / model / registrační značka
        </Text>
        <TextInput
          style={S.input}
          value={make}
          onChangeText={setMake}
          placeholder="Značka"
          placeholderTextColor={SOS.textFaint}
          accessibilityLabel="Značka vozidla"
          allowFontScaling
        />
        <TextInput
          style={S.input}
          value={model}
          onChangeText={setModel}
          placeholder="Model"
          placeholderTextColor={SOS.textFaint}
          accessibilityLabel="Model vozidla"
          allowFontScaling
        />
        <TextInput
          style={S.input}
          value={registration}
          onChangeText={setRegistration}
          placeholder="Registrační značka"
          placeholderTextColor={SOS.textFaint}
          accessibilityLabel="Registrační značka"
          allowFontScaling
        />
        <BigButton
          label="Použít ručně zadané vozidlo"
          variant="secondary"
          onPress={() =>
            onSelectVehicle({
              source: "manual",
              label: [make, model].filter(Boolean).join(" ").trim(),
              make,
              model,
              registration,
            })
          }
        />
      </View>

      {/* Souhrn */}
      <View style={S.card}>
        <Text style={S.cardTitle} allowFontScaling>
          📋 Souhrn
        </Text>
        <View style={S.summaryRow}>
          <Text style={S.summaryLabel} allowFontScaling>
            Problém
          </Text>
          <Text style={S.summaryValue} allowFontScaling>
            {summary.problemLabel}
          </Text>
        </View>
        <View style={S.summaryRow}>
          <Text style={S.summaryLabel} allowFontScaling>
            Poloha
          </Text>
          <Text style={S.summaryValue} allowFontScaling>
            {summary.location.description}
          </Text>
        </View>
        <View style={S.summaryRow}>
          <Text style={S.summaryLabel} allowFontScaling>
            Vozidlo
          </Text>
          <Text style={S.summaryValue} allowFontScaling>
            {summary.vehicleLabel}
          </Text>
        </View>
        <View style={S.summaryRow}>
          <Text style={S.summaryLabel} allowFontScaling>
            Komunikace
          </Text>
          <Text style={S.summaryValue} allowFontScaling>
            {summary.roadTypeLabel}
          </Text>
        </View>
      </View>

      {/* Předání údajů a potvrzení */}
      <View style={S.disclosureCard}>
        <Text style={S.cardTitle} allowFontScaling>
          Co se partnerovi předá
        </Text>
        <Text style={S.cardText} allowFontScaling>
          {SOS_DATA_SHARING_INTRO}
        </Text>
        {SOS_DATA_SHARED_ITEMS.map((item) => (
          <Text key={item} style={S.noteText} allowFontScaling>
            • {item}
          </Text>
        ))}
        <Text style={S.footnote} allowFontScaling>
          {SOS_ORDER_ONE_CONFIRMATION}
        </Text>
      </View>

      <BigButton
        label="Získat nabídku asistence"
        onPress={onGetOffer}
        disabled={!providerConfigured || busy || !canSubmit || (Boolean(state.order.clientRequestId) && (state.order.status === "failed" || state.order.status === "idle"))}
      />
      {sosBooking ? (
        <View style={S.card}>
          <Text style={S.cardTitle} allowFontScaling>{sosBooking.offer.providerName}</Text>
          <Text style={S.cardText} allowFontScaling>{sosBooking.offer.serviceScope}</Text>
          <Text style={S.cardText} allowFontScaling>
            {sosBooking.offer.confirmedPrice ? `Konečná cena: ${sosBooking.offer.confirmedPrice}` : `Odhad ceny: ${sosBooking.offer.estimatedPrice}`}
          </Text>
          <Text style={S.cardText} allowFontScaling>Odhad příjezdu: {sosBooking.offer.etaMinutes == null ? "není dostupný" : `${sosBooking.offer.etaMinutes} min`}</Text>
          <Text style={S.cardText} allowFontScaling>Storno: {sosBooking.offer.cancellationTerms}</Text>
          <Text style={S.cardText} allowFontScaling>Problém nabídky: {sosBooking.request.problemLabel}</Text>
          <Text style={S.cardText} allowFontScaling>Poloha nabídky: {sosBooking.request.location.description}</Text>
          <Text style={S.cardText} allowFontScaling>Vozidlo nabídky: {sosBooking.request.vehicle ? [sosBooking.request.vehicle.label, sosBooking.request.vehicle.registration].filter(Boolean).join(" · ") : "Neuvedeno"}</Text>
          <Text style={S.noteText} allowFontScaling>Objedná se problém a poloha zobrazené při získání této nabídky. Pro změnu údajů si vyžádejte novou nabídku.</Text>
        </View>
      ) : null}
      <BigButton
        label={!providerConfigured ? "Online objednání není dostupné" : busy ? "Odesílám…" : canSubmit ? "Potvrdit objednávku asistence" : "Objednávka už existuje"}
        onPress={onConfirm}
        disabled={!providerConfigured || !sosBooking || busy || !canSubmit || (["completed", "cancelled", "rejected"].includes(state.order.status) && sosBooking.request.clientRequestId === state.order.clientRequestId)}
        accessibilityHint="Jedno potvrzení. Opakované klepnutí nevytvoří duplicitní objednávku."
      />

      {!providerConfigured ? (
        <View style={S.disclosureCard}>
          <Text style={S.cardTitle} allowFontScaling>
            Zavolejte svou asistenci
          </Text>
          <Text style={S.cardText} allowFontScaling>
            Online objednání zatím není dostupné. Použijte kontakt na asistenci
            své pojišťovny nebo odtahovou službu z pojistných dokumentů.
          </Text>
          <Text style={S.noteText} allowFontScaling>
            Zadejte telefonní číslo včetně předvolby, pokud voláte do zahraničí.
            Tísňové linky jsou určené pro naléhavé situace.
          </Text>
          <TextInput
            style={S.input}
            value={assistancePhone}
            onChangeText={setAssistancePhone}
            placeholder="Telefon na asistenci"
            placeholderTextColor={SOS.textFaint}
            keyboardType="phone-pad"
            accessibilityLabel="Telefonní číslo vlastní asistence nebo pojišťovny"
            allowFontScaling
          />
          {assistancePhone.length > 0 && !validPhone ? (
            <Text style={S.noteText} allowFontScaling>
              Zadejte 9 až 15 číslic, případně s předvolbou začínající +.
            </Text>
          ) : null}
          <BigButton
            label="Zavolat vlastní asistenci"
            disabled={!validPhone}
            onPress={() => {
              if (!validPhone) return;
              Linking.openURL(`tel:${phoneNumber}`).catch(() => {
                Alert.alert("Nelze otevřít volání", `Zavolejte číslo ${phoneNumber} ručně v telefonní aplikaci.`);
              });
            }}
            accessibilityHint="Otevře telefonní aplikaci se zadaným číslem."
          />
        </View>
      ) : null}

      <BigButton
        label="Zpět na určení problému"
        variant="secondary"
        onPress={onBack}
      />
    </View>
  );
}

// ── Stav zásahu ────────────────────────────────────────────────────────────

function StatusPanel({
  state,
  onRetry,
  onCancel,
  onBackToAssistance,
}: {
  state: SosState;
  onRetry: () => void;
  onCancel: () => void;
  onBackToAssistance: () => void;
}) {
  const view = orderStatusView(state.order.status);
  const cancellable = ["sent", "awaiting_acceptance", "accepted", "en_route", "arrived"].includes(
    state.order.status
  );
  return (
    <View style={S.content}>
      <Text style={S.bigTitle} allowFontScaling accessibilityRole="header">
        Stav zásahu
      </Text>
      <View style={S.card} accessibilityLiveRegion="polite">
        <View style={S.statusRow}>
          <Text style={S.statusIcon} allowFontScaling>
            {view.icon}
          </Text>
          <Text style={S.statusLabel} allowFontScaling>
            {view.label}
          </Text>
        </View>
        <Text style={S.statusDesc} allowFontScaling>
          {view.description}
        </Text>
        {state.order.etaMinutes != null ? (
          <>
            <Text style={S.statusDesc} allowFontScaling>
              Odhadovaný čas příjezdu: cca {state.order.etaMinutes} min.
            </Text>
            <Text style={S.footnote} allowFontScaling>
              {SOS_ETA_IS_ESTIMATE}
            </Text>
          </>
        ) : null}
        {state.order.error ? (
          <Text style={S.dangerText} allowFontScaling>
            {state.order.error}
          </Text>
        ) : null}
      </View>

      <View style={S.card}>
        <Text style={S.cardTitle} allowFontScaling>
          Potřebujete pomoc hned?
        </Text>
        <Text style={S.cardText} allowFontScaling>
          Tísňová čísla máte pořád nahoře. Živé sledování technika zobrazíme jen
          tehdy, když jsou k dispozici skutečná data – nic nepředstíráme.
        </Text>
      </View>

      {state.order.status === "failed" || state.order.status === "rejected" ? (
        <BigButton label="Zkusit objednávku znovu" onPress={onRetry} />
      ) : null}
      {cancellable ? (
        <BigButton label="Zrušit objednávku" variant="secondary" onPress={onCancel} />
      ) : null}
      <BigButton label="Zpět na přivolání pomoci" variant="secondary" onPress={onBackToAssistance} />
    </View>
  );
}

// ── Hlavní obrazovka ───────────────────────────────────────────────────────

export default function SosScreen() {
  const { locationState, sosState: state, setSosState: setState, sosBooking, setSosBooking, personalVehiclesState } = useAppContext();
  const operationBusy = React.useRef(false);

  async function handleGetOffer() {
    const provider = getAssistanceProvider();
    if (!provider.isConfigured() || operationBusy.current || !canSubmitOrder(state) || (state.order.clientRequestId && (state.order.status === "failed" || state.order.status === "idle"))) return;
    operationBusy.current = true;
    setSosBooking(null);
    const summary = buildRequestSummary({ problemId: state.problem, location: locationSummary, vehicle: state.vehicle, roadType: state.roadType });
    const request = { clientRequestId: defaultClientRequestId(), problemId: state.problem, problemLabel: summary.problemLabel, location: locationSummary, vehicle: state.vehicle, roadTypeLabel: summary.roadTypeLabel, disclosedItems: SOS_DATA_SHARED_ITEMS };
    try {
      const offer = await provider.getOffer(request);
      if (!offer.offerId || !offer.providerName || !offer.serviceScope || !(offer.confirmedPrice || offer.estimatedPrice) || !offer.cancellationTerms) throw new Error("Nabídka neobsahuje všechny potřebné podmínky.");
      setSosBooking({ offer, request: { ...request, offerId: offer.offerId }, providerId: provider.id });
    } catch {
      Alert.alert("Nabídka není dostupná", "Nabídku se nepodařilo získat. Zkuste to znovu nebo zavolejte vlastní asistenci.");
    } finally { operationBusy.current = false; }
  }

  async function handleCancelOrder() {
    const provider = getAssistanceProvider();
    const orderId = state.order.orderId;
    if (!orderId || operationBusy.current || provider.id !== state.order.providerName) return;
    operationBusy.current = true;
    try {
      const cancelled = await cancelConfirmedOrder(provider, state);
      setState(current => current.order.orderId === orderId ? { ...current, order: cancelled.order } : current);
    } catch { Alert.alert("Storno nebylo potvrzeno", "Nepodařilo se ověřit zrušení. Objednávka zůstává aktivní."); }
    finally { operationBusy.current = false; }
  }

  const nowMs = Date.now();
  const rawLocation = locationState.location
    ? {
        latitude: locationState.location.coords.latitude,
        longitude: locationState.location.coords.longitude,
        accuracyMeters: locationState.location.coords.accuracy ?? null,
        capturedAt: locationState.location.timestamp,
      }
    : null;

  const locationSummary = describeLocation({
    rawLocation,
    manualDescription: state.manualLocation,
    nowMs,
  });

  // SOS předvyplňuje OSOBNÍ vozidla (`personal_vehicles`), ne přepravní
  // (`carrier_vehicles`). Přepravní technika sem nepatří — v té je náklad, ne
  // auta jejího řidiče.
  const vehicleOptions = personalVehiclesState.personalVehicles.map((vehicle) => ({
    id: vehicle.id,
    label: personalVehicleDisplayLabel(vehicle),
    // Značka, model a registrace se z výběru rovnou propírají do formuláře.
    make: vehicle.make,
    model: vehicle.model,
    registration: vehicle.registration ?? "",
  }));

  function handleIntroChoice(id: IntroChoiceId) {
    setState((current) => applyIntroChoice(current, id));
  }

  async function handleConfirmOrder() {
    if (!canSubmitOrder(state) || isOrderBusy(state) || operationBusy.current || !sosBooking) return;
    const provider = getAssistanceProvider();
    if (!provider.isConfigured() || provider.id !== sosBooking.providerId) return;
    if (["completed", "cancelled", "rejected"].includes(state.order.status) && sosBooking.request.clientRequestId === state.order.clientRequestId) return;
    operationBusy.current = true;
    const retryKey = state.order.status === "failed" || state.order.status === "idle" ? state.order.clientRequestId : null;
    const clientRequestId = resolveClientRequestId(retryKey, () => sosBooking.request.clientRequestId);
    setState((current) =>
      beginOrder(
        current,
        clientRequestId,
        provider.isConfigured() ? provider.id : null,
        Date.now()
      )
    );

    try {
      const result = await provider.requestOrder({
        ...sosBooking.request,
        clientRequestId,
      });

      setState((current) => {
        if (
          current.order.clientRequestId !== clientRequestId ||
          current.order.status !== "sending"
        ) {
          return current;
        }
        if (result.status === "accepted_by_provider") {
          const sent = orderSent(current, {
            orderId: result.orderId,
            etaMinutes: result.offer.etaMinutes,
          });
          return orderStatusChanged(sent, "accepted", {
            etaMinutes: result.offer.etaMinutes,
          });
        }
        if (result.status === "rejected") {
          return orderStatusChanged(current, "rejected");
        }
        if (result.status === "unavailable") {
          return orderFailed(current, result.reason);
        }
        return orderFailed(current, result.message);
      });
    } catch {
      setState((current) => {
        if (
          current.order.clientRequestId !== clientRequestId ||
          current.order.status !== "sending"
        ) {
          return current;
        }
        // Síťová chyba NIKDY nezobrazí objednávku jako odeslanou.
        return orderFailed(
          current,
          "Objednávku se nepodařilo odeslat. Zkontrolujte připojení a zkuste to znovu, nebo volejte přímo."
        );
      });
    } finally { operationBusy.current = false; }
  }

  return (
    <View style={S.root}>
      <SafeAreaView style={S.root}>
        <View style={S.safeTop}>
          <View style={S.header}>
            <TouchableOpacity
              style={S.headerBack}
              onPress={() => navigateLegacy("home")}
              accessibilityRole="button"
              accessibilityLabel="Zpět na Přehled"
            >
              <Text style={S.headerBackText}>‹</Text>
            </TouchableOpacity>
            <View style={S.headerTitleWrap}>
              <Text style={S.headerTitle} allowFontScaling accessibilityRole="header">
                SOS pomoc na cestě
              </Text>
              <Text style={S.headerSubtitle} allowFontScaling>
                Průvodce pro poruchu nebo nehodu
              </Text>
            </View>
          </View>
          <EmergencyCallBar />
        </View>

        <ScrollView
          style={S.scroll}
          contentContainerStyle={S.content}
          keyboardShouldPersistTaps="handled"
        >
          {state.stage === "intro" ? <IntroPanel onChoose={handleIntroChoice} /> : null}

          {state.stage === "call" && state.introChoice ? (
            <CallPanel
              choice={state.introChoice}
              onContinue={() => setState((current) => goToStage(current, "safety"))}
            />
          ) : null}

          {state.stage === "safety" ? (
            <SafetyPanel
              state={state}
              onAction={(stepId, action) =>
                setState((current) => applySafetyAction(current, stepId, action))
              }
              onContinue={() => setState((current) => goToStage(current, "problem"))}
            />
          ) : null}

          {state.stage === "problem" ? (
            <ProblemPanel
              state={state}
              onSelect={(id) =>
                setState((current) =>
                  id === "warning_light"
                    ? { ...current, problem: id }
                    : selectProblem(current, id)
                )
              }
              onWarningLightChange={(input) =>
                setState((current) => applyWarningLight(current, input))
              }
              onContinue={() => setState((current) => goToStage(current, "assistance"))}
            />
          ) : null}

          {state.stage === "accident" ? (
            <AccidentPanel
              state={state}
              onAnswer={(id, answer) =>
                setState((current) => applyAccidentAnswer(current, id, answer))
              }
              onContinue={() => setState((current) => goToStage(current, "assistance"))}
            />
          ) : null}

          {state.stage === "assistance" ? (
            <AssistancePanel
              state={state}
              locationSummary={locationSummary}
              locationError={locationState.locationError}
              onRequestLocation={() => locationState.requestLocation()}
              onManualLocation={(text) =>
                setState((current) => setManualLocation(current, text))
              }
              onRoadType={(type) => setState((current) => setRoadType(current, type))}
              vehicleOptions={vehicleOptions}
              onAddPersonalVehicle={() => navigateLegacy("personalVehicles")}
              onSelectVehicle={(vehicle) =>
                setState((current) => setVehicle(current, vehicle))
              }
              onConfirm={handleConfirmOrder}
              onGetOffer={handleGetOffer}
              onBack={() => setState((current) => goToStage(current, "problem"))}
            />
          ) : null}

          {state.stage === "status" ? (
            <StatusPanel
              state={state}
              onRetry={() => {
                if (state.order.status === "rejected") setSosBooking(null);
                setState((current) => resetFailedOrder(current));
              }}
              onCancel={() => Alert.alert("Zrušit objednávku?", sosBooking?.offer.cancellationTerms || "Storno podmínky ověřte u poskytovatele.", [{ text: "Ponechat", style: "cancel" }, { text: "Požádat o storno", style: "destructive", onPress: handleCancelOrder }])}
              onBackToAssistance={() =>
                setState((current) => goToStage(current, "assistance"))
              }
            />
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
