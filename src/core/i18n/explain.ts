// Language Mode — user-facing safety explanations in en/hi/hinglish.
// Internal policy IDs, tool names, audit events, and machine states stay in English.
// Translation never changes permissions; English fallback when missing.
export type ExplainLang = "en" | "hi" | "hinglish";

export const EXPLAIN_KEYS = [
  "hard-denied",
  "approval-required",
  "cooling-active",
  "leak-blocked",
  "kill-active",
  "pass-expired",
  "budget-exhausted",
  "pocket-unavailable",
  "delivery-preview",
] as const;

export type ExplainKey = (typeof EXPLAIN_KEYS)[number];

const T: Record<ExplainKey, Record<ExplainLang, string>> = {
  "hard-denied": {
    en: "Blocked by a hard safety rule. This action can never be auto-approved.",
    hi: "कठिन सुरक्षा नियम द्वारा रोका गया। यह कार्रवाई स्वतः अनुमोदित नहीं हो सकती।",
    hinglish: "Hard safety rule ne block kiya. Ye action auto-approve nahi ho sakta.",
  },
  "approval-required": {
    en: "Needs your explicit approval before it can run. Nothing has executed yet.",
    hi: "चलाने से पहले आपकी स्पष्ट अनुमति आवश्यक है। अभी कुछ निष्पादित नहीं हुआ है।",
    hinglish: "Chalne se pehle aapki explicit approval chahiye. Abhi kuch execute nahi hua.",
  },
  "cooling-active": {
    en: "Cooling period is active. The action stays paused until the delay ends, and expiry alone never executes it.",
    hi: "कूलिंग अवधि सक्रिय है। देरी समाप्त होने तक कार्रवाई रुकी रहेगी, और समय समाप्त होने पर स्वतः निष्पादित नहीं होगी।",
    hinglish: "Cooling period active hai. Delay khatm hone tak action paused rahega; expiry par auto-execute nahi hoga.",
  },
  "leak-blocked": {
    en: "Outbound payload blocked because it looked like sensitive data. The raw value was never sent.",
    hi: "संवेदनशील डेटा जैसा दिखने पर आउटबाउंड सामग्री रोकी गई। मूल मान कभी भेजा नहीं गया।",
    hinglish: "Sensitive data jaisa lagne par outbound payload block kiya gaya. Raw value kabhi bheja nahi gaya.",
  },
  "kill-active": {
    en: "Kill switch is active for this task. Everything stays stopped until you clear it.",
    hi: "इस कार्य के लिए किल स्विच सक्रिय है। आपके हटाने तक सब कुछ रुका रहेगा।",
    hinglish: "Is task ke liye kill switch active hai. Aapke clear karne tak sab ruka rahega.",
  },
  "pass-expired": {
    en: "The task permission (Task Pass) expired. Renew it before retrying.",
    hi: "कार्य अनुमति (Task Pass) समाप्त हो गई है। पुनः प्रयास से पहले इसे नवीनीकृत करें।",
    hinglish: "Task permission (Task Pass) expire ho gaya. Retry se pehle renew karo.",
  },
  "budget-exhausted": {
    en: "Trust Budget is exhausted or unavailable. The action stays paused; no bypass is possible.",
    hi: "ट्रस्ट बजट समाप्त या अनुपलब्ध है। कार्रवाई रुकी रहेगी; कोई बायपास संभव नहीं है।",
    hinglish: "Trust Budget khatm ya unavailable hai. Action paused rahega; koi bypass possible nahi.",
  },
  "pocket-unavailable": {
    en: "Phone approval is not connected. Use this device to approve; nothing was sent to a phone.",
    hi: "फ़ोन अनुमोदन जुड़ा नहीं है। इसी डिवाइस पर अनुमोदन करें; फ़ोन पर कुछ नहीं भेजा गया।",
    hinglish: "Phone approval connected nahi hai. Isi device par approve karo; phone par kuch nahi bheja gaya.",
  },
  "delivery-preview": {
    en: "Local preview only — no message was delivered. Delivery needs explicit configuration.",
    hi: "केवल स्थानीय पूर्वावलोकन — कोई संदेश वितरित नहीं हुआ। वितरण के लिए स्पष्ट कॉन्फ़िगरेशन आवश्यक है।",
    hinglish: "Sirf local preview — koi message deliver nahi hua. Delivery ke liye explicit configuration chahiye.",
  },
};

export function explain(key: ExplainKey, lang: ExplainLang, opts?: { tool?: string; detail?: string }): string {
  const table = T[key];
  const base = table?.[lang] ?? table?.en ?? key;
  const suffix = opts?.tool ? ` [${opts.tool}]` : "";
  const detail = opts?.detail ? ` ${opts.detail.slice(0, 160)}` : "";
  return `${base}${suffix}${detail}`;
}

export function explainLang(code: string): ExplainLang {
  if (code === "hi") return "hi";
  if (code === "hinglish") return "hinglish";
  return "en";
}
