// Picks which audio track to ask TorBox for when it converts a file for the
// browser (B26). Browsers play only the first audio track of an MKV and
// cannot switch it, so the preferred language (Settings > Playback > audio
// language) is chosen on TorBox's side through chosen_audio_index.

const LANGUAGE_ALIASES = {
  pt: "pt",
  por: "pt",
  pob: "pt",
  portuguese: "pt",
  portugues: "pt",
  en: "en",
  eng: "en",
  english: "en",
  es: "es",
  spa: "es",
  spanish: "es",
  espanol: "es",
  castellano: "es",
  fr: "fr",
  fre: "fr",
  fra: "fr",
  french: "fr",
  de: "de",
  ger: "de",
  deu: "de",
  german: "de",
  it: "it",
  ita: "it",
  italian: "it",
  ja: "ja",
  jpn: "ja",
  japanese: "ja",
  ko: "ko",
  kor: "ko",
  korean: "ko",
  zh: "zh",
  chi: "zh",
  zho: "zh",
  chinese: "zh",
  ru: "ru",
  rus: "ru",
  russian: "ru",
  hi: "hi",
  hin: "hi",
  hindi: "hi"
};

function plain(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

function baseLanguage(value) {
  const text = plain(value);
  if (!text) return "";
  const head = text.split(/[-_\s(]/)[0];
  return LANGUAGE_ALIASES[head] || LANGUAGE_ALIASES[text] || "";
}

// "pt-br" / "pt" / "en"... from a settings value; "" for none.
function settingTarget(value, systemLocale) {
  const configured = plain(value);
  if (!configured || ["default", "off", "none", "forced", "original"].includes(configured))
    return "";
  const raw = configured === "system" || configured === "device" ? plain(systemLocale) : configured;
  const base = baseLanguage(raw);
  if (!base) return "";
  return base === "pt" && /(^|[-_])br$/.test(raw) ? "pt-br" : base;
}

export function preferredAudioTargets(settings = {}, systemLocale = "") {
  return Array.from(
    new Set(
      [
        settingTarget(settings.preferredAudioLanguage ?? "system", systemLocale),
        settingTarget(settings.secondaryPreferredAudioLanguage, systemLocale)
      ].filter(Boolean)
    )
  );
}

function describeAudio(audio = {}) {
  const fields = [audio.language, audio.language_full, audio.title].map(plain);
  const base = fields.map(baseLanguage).find(Boolean) || "";
  const text = fields.join(" ");
  const hasBrazilToken =
    /\b(br|bra|brazil|brasil|brazilian|brasileiro|pob|pt-br|dublado|nacional)\b/.test(text) ||
    plain(audio.language) === "pob";
  return {
    base: base || (hasBrazilToken ? "pt" : ""),
    brazil: (base === "pt" || !base) && hasBrazilToken,
    portugal: base === "pt" && /\b(pt-pt|portugal|european|europeu)\b/.test(text),
    commentary: /comment|comentario/.test(text),
    untagged: !base && (!plain(audio.language) || plain(audio.language) === "und")
  };
}

// Relative index (0 = first audio) of the best track for the targets, or -1.
export function pickTorboxAudioIndex(
  audios = [],
  targets = [],
  { preferSecondaryForDual = false } = {}
) {
  const list = Array.isArray(audios) ? audios.map(describeAudio) : [];
  for (const target of targets) {
    const base = target === "pt-br" ? "pt" : target;
    const candidates = list
      .map((info, index) => ({ info, index }))
      .filter(({ info }) => info.base === base && !info.commentary);
    if (!candidates.length) continue;
    if (target === "pt-br") {
      const brazil = candidates.find(({ info }) => info.brazil);
      if (brazil) return brazil.index;
      const notPortugal = candidates.find(({ info }) => !info.portugal);
      return (notPortugal || candidates[0]).index;
    }
    return candidates[0].index;
  }
  if (preferSecondaryForDual && list.length > 1 && list[0]?.base === "en") {
    const untaggedSecondary = list.findIndex(
      (info, index) => index > 0 && info.untagged && !info.commentary
    );
    if (untaggedSecondary > 0) {
      return untaggedSecondary;
    }
  }
  return -1;
}

// Which audio track the converted TorBox stream starts on (B35): the track
// whose language or title says it is the preferred one; otherwise the best
// guess (for "Dual"/PT-BR sources, the untagged second track after an
// English first one); otherwise the file's first track. "confident" tells
// whether a track really said it was the preferred language.
export function decideTorboxAudio(
  audios = [],
  targets = [],
  { preferSecondaryForDual = false } = {}
) {
  const list = Array.isArray(audios) ? audios : [];
  const sure = pickTorboxAudioIndex(list, targets);
  if (sure >= 0) {
    return { index: sure, confident: true };
  }
  const guessed = pickTorboxAudioIndex(list, targets, { preferSecondaryForDual });
  return { index: guessed >= 0 ? guessed : 0, confident: false };
}
