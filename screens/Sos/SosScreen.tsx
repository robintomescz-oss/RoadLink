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
  SOS_ORDER_NO_PARTNER_YET,
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
  cancelOrder,
  createInitialSosState,
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
import {
  defaultClientRequestId,
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
  onSelectVehicle,
  onConfirm,
  onBack,
}: {
  state: SosState;
  locationSummary: ReturnType<typeof describeLocation>;
  locationError: string;
  onRequestLocation: () => void;
  onManualLocation: (text: string) => void;
  onRoadType: (type: RoadType) => void;
  vehicleOptions: Array<{ id: string; label: string }>;
  onSelectVehicle: (vehicle: { source: "profile" | "manual"; label: string; make: string; model: string; registration: string }) => void;
  onConfirm: () => void;
  onBack: () => void;
}) {
  const [make, setMake] = React.useState(state.vehicle?.make ?? "");
  const [model, setModel] = React.useState(state.vehicle?.model ?? "");
  const [registration, setRegistration] = React.useState(state.vehicle?.registration ?? "");

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
                onPress={() =>
                  onSelectVehicle({ source: "profile", label: option.label, make: "", model: "", registration: "" })
                }
                accessibilityLabel={`Vozidlo z profilu: ${option.label}`}
              />
            ))}
          </View>
        ) : (
          <Text style={S.noteText} allowFontScaling>
            V profilu není uložené žádné vozidlo. Zadejte ho ručně – pomoc můžete
            přivolat i bez registrace.
          </Text>
        )}
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
        label={busy ? "Odesílám…" : canSubmit ? "Potvrdit objednávku asistence" : "Objednávka už existuje"}
        onPress={onConfirm}
        disabled={busy || !canSubmit}
        accessibilityHint="Jedno potvrzení. Opakované klepnutí nevytvoří duplicitní objednávku."
      />

      {!getAssistanceProvider().isConfigured() ? (
        <View style={S.disclosureCard}>
          <Text style={S.cardTitle} allowFontScaling>
            Objednání u partnera
          </Text>
          <Text style={S.cardText} allowFontScaling>
            {SOS_ORDER_NO_PARTNER_YET}
          </Text>
          <Text style={S.noteText} allowFontScaling>
            Rozhraní pro budoucí napojení partnerského API je připravené.
          </Text>
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
  const { locationState, profileState } = useAppContext();
  const [state, setState] = React.useState<SosState>(createInitialSosState);

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

  const vehicleOptions = profileState.vehicles.map((vehicle) => ({
    id: vehicle.id,
    label:
      vehicle.name ||
      [vehicle.make, vehicle.model].filter(Boolean).join(" ") ||
      vehicle.registration_number ||
      "Vozidlo",
  }));

  function handleIntroChoice(id: IntroChoiceId) {
    setState((current) => applyIntroChoice(current, id));
  }

  async function handleConfirmOrder() {
    if (!canSubmitOrder(state) || isOrderBusy(state)) return;
    const provider = getAssistanceProvider();
    const clientRequestId = resolveClientRequestId(state.order.clientRequestId, defaultClientRequestId);
    const summary = buildRequestSummary({
      problemId: state.problem,
      location: locationSummary,
      vehicle: state.vehicle,
      roadType: state.roadType,
    });
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
        clientRequestId,
        problemId: state.problem,
        problemLabel: summary.problemLabel,
        location: locationSummary,
        vehicle: state.vehicle,
        roadTypeLabel: summary.roadTypeLabel,
        disclosedItems: SOS_DATA_SHARED_ITEMS,
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
    }
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
              onSelectVehicle={(vehicle) =>
                setState((current) => setVehicle(current, vehicle))
              }
              onConfirm={handleConfirmOrder}
              onBack={() => setState((current) => goToStage(current, "problem"))}
            />
          ) : null}

          {state.stage === "status" ? (
            <StatusPanel
              state={state}
              onRetry={() => setState((current) => resetFailedOrder(current))}
              onCancel={() => setState((current) => cancelOrder(current))}
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
