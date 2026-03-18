import { createSignal, createRoot } from 'solid-js'

export type Locale = 'en' | 'zh' | 'ja' | 'ko' | 'es' | 'fr' | 'de' | 'pt' | 'ru' | 'it'

const translations: Record<Locale, Record<string, string>> = {
  en: {
    // TextTerminal
    'tts.placeholder': 'Paste text or a URL to convert to speech...',
    'tts.placeholder.translate': 'Paste text or a URL to translate to {lang}...',
    'tts.onboard': 'Type or paste any text, drop a URL, or try a sample below.',
    'tts.onboard.press': 'to generate speech.',
    'tts.onboard.meta': '9 voices · 10 languages · free tier: 3000 chars/day',
    'tts.generate': 'GENERATE',
    'tts.regenerate': 'REGENERATE',
    'tts.cancel': 'CANCEL',
    'tts.done': 'DONE',
    'tts.fetch_speak': 'FETCH & SPEAK',
    'tts.translate_speak': 'TRANSLATE & SPEAK',
    'tts.url_detected': 'URL detected',
    'tts.urls_extract': 'URLs auto-extract',
    'tts.drop_file': 'Drop text file',
    'tts.drop_accept': 'any text file accepted',
    'tts.drop_load': 'Drop to load',
    'tts.input': 'Input',
    'tts.clear': 'Clear?',
    'tts.chars': 'chars',
    'tts.words': 'words',
    'tts.word': 'word',
    'tts.limit': 'limit',
    'tts.partial': 'partial',
    'tts.translate': 'Translate',
    'tts.synthesizing': 'Synthesizing {n}/{total}...',
    'tts.extracting': 'Extracting text...',
    'tts.translating': 'Translating...',
    // VoiceTerminal
    'voice.no_speech': 'No speech detected',
    'voice.cancelled': 'Cancelled',
    'voice.too_short': 'Too short — hold longer to record',
    'voice.hold_space': 'Hold SPACE to talk',
    'voice.type_message': 'Type a message...',
    'voice.clear_chat': 'Clear chat?',
    // Phases
    'phase.recording': 'Recording',
    'phase.transcribing': 'Transcribing',
    'phase.thinking': 'Thinking',
    'phase.translating': 'Translating',
    'phase.generating': 'Generating',
    'phase.speaking': 'Speaking',
    // Nav
    'nav.tts': 'TTS',
    'nav.voice': 'Voice',
    'nav.translate': 'Trans',
    'nav.call': 'Call',
    'nav.more': 'More',
    'nav.contacts': 'Contacts',
    'nav.signin': 'Sign in',
    'nav.profile': 'Profile',
    'nav.player': 'Now playing',
    // Auth
    'auth.login': 'Login',
    'auth.email_login': 'Email login',
    'auth.passphrase_login': 'Passphrase login',
    'auth.check_email': 'Check your email for the login link',
    // General
    'general.back': 'Back',
    'general.close': 'Close',
    'general.copy': 'Copy',
    'general.share': 'Share',
    'general.download': 'Download',
    'general.delete': 'Delete',
    'general.edit': 'Edit',
    'general.save': 'Save',
  },
  zh: {
    'tts.placeholder': '粘贴文本或网址来转换为语音...',
    'tts.placeholder.translate': '粘贴文本或网址翻译为{lang}...',
    'tts.onboard': '输入或粘贴任何文本、拖放网址，或试试下面的示例。',
    'tts.onboard.press': '生成语音。',
    'tts.onboard.meta': '9种声音 · 10种语言 · 免费额度: 每日3000字符',
    'tts.generate': '生成',
    'tts.regenerate': '重新生成',
    'tts.cancel': '取消',
    'tts.done': '完成',
    'tts.fetch_speak': '提取并朗读',
    'tts.translate_speak': '翻译并朗读',
    'tts.url_detected': '检测到网址',
    'tts.urls_extract': '自动提取网址',
    'tts.drop_file': '拖放文本文件',
    'tts.drop_accept': '接受任何文本文件',
    'tts.drop_load': '拖放以加载',
    'tts.input': '输入',
    'tts.clear': '清除？',
    'tts.chars': '字符',
    'tts.words': '词',
    'tts.word': '词',
    'tts.limit': '上限',
    'tts.partial': '部分',
    'tts.translate': '翻译',
    'tts.synthesizing': '合成中 {n}/{total}...',
    'tts.extracting': '提取文本中...',
    'tts.translating': '翻译中...',
    'voice.no_speech': '未检测到语音',
    'voice.cancelled': '已取消',
    'voice.too_short': '太短了，请按住更长时间',
    'voice.hold_space': '按住空格键说话',
    'voice.type_message': '输入消息...',
    'voice.clear_chat': '清除聊天？',
    'phase.recording': '录音中',
    'phase.transcribing': '转录中',
    'phase.thinking': '思考中',
    'phase.translating': '翻译中',
    'phase.generating': '生成中',
    'phase.speaking': '播放中',
    'nav.tts': '语音',
    'nav.voice': '对话',
    'nav.translate': '翻译',
    'nav.call': '通话',
    'nav.more': '更多',
    'nav.contacts': '联系人',
    'nav.signin': '登录',
    'nav.profile': '个人资料',
    'nav.player': '正在播放',
    'auth.login': '登录',
    'auth.email_login': '邮箱登录',
    'auth.passphrase_login': '密码登录',
    'auth.check_email': '请查收登录链接邮件',
    'general.back': '返回',
    'general.close': '关闭',
    'general.copy': '复制',
    'general.share': '分享',
    'general.download': '下载',
    'general.delete': '删除',
    'general.edit': '编辑',
    'general.save': '保存',
  },
  ja: {
    'tts.placeholder': 'テキストまたはURLを貼り付けて音声に変換...',
    'tts.placeholder.translate': 'テキストまたはURLを貼り付けて{lang}に翻訳...',
    'tts.onboard': 'テキストを入力・貼り付け、URLをドロップ、またはサンプルをお試しください。',
    'tts.onboard.press': 'で音声を生成。',
    'tts.onboard.meta': '9つの声 · 10言語 · 無料枠: 1日3000文字',
    'tts.generate': '生成',
    'tts.regenerate': '再生成',
    'tts.cancel': 'キャンセル',
    'tts.done': '完了',
    'tts.fetch_speak': '取得して読み上げ',
    'tts.translate_speak': '翻訳して読み上げ',
    'tts.url_detected': 'URL検出',
    'tts.urls_extract': 'URL自動抽出',
    'tts.drop_file': 'テキストファイルをドロップ',
    'tts.drop_accept': 'テキストファイル対応',
    'tts.drop_load': 'ドロップして読み込み',
    'tts.input': '入力',
    'tts.clear': 'クリア？',
    'tts.chars': '文字',
    'tts.words': '語',
    'tts.word': '語',
    'tts.translate': '翻訳',
    'tts.synthesizing': '合成中 {n}/{total}...',
    'voice.no_speech': '音声が検出されませんでした',
    'voice.hold_space': 'スペースキーを押して話す',
    'voice.type_message': 'メッセージを入力...',
    'nav.tts': '音声',
    'nav.voice': '会話',
    'nav.translate': '翻訳',
    'nav.call': '通話',
    'nav.more': 'その他',
    'nav.signin': 'ログイン',
    'general.back': '戻る',
    'general.copy': 'コピー',
    'general.share': '共有',
    'general.download': 'ダウンロード',
  },
  ko: {
    'tts.placeholder': '텍스트 또는 URL을 붙여넣어 음성으로 변환...',
    'tts.onboard': '텍스트를 입력하거나 붙여넣기, URL을 드롭하거나 아래 샘플을 시도해보세요.',
    'tts.onboard.press': '음성을 생성합니다.',
    'tts.onboard.meta': '9가지 음성 · 10개 언어 · 무료: 하루 3000자',
    'tts.generate': '생성',
    'tts.cancel': '취소',
    'tts.done': '완료',
    'voice.hold_space': '스페이스바를 눌러 말하기',
    'nav.tts': '음성',
    'nav.voice': '대화',
    'nav.translate': '번역',
    'nav.call': '통화',
    'nav.signin': '로그인',
  },
  es: {
    'tts.placeholder': 'Pega texto o una URL para convertir a voz...',
    'tts.onboard': 'Escribe o pega texto, arrastra una URL o prueba un ejemplo.',
    'tts.onboard.press': 'para generar voz.',
    'tts.onboard.meta': '9 voces · 10 idiomas · gratis: 3000 caracteres/día',
    'tts.generate': 'GENERAR',
    'tts.regenerate': 'REGENERAR',
    'tts.cancel': 'CANCELAR',
    'tts.done': 'LISTO',
    'tts.translate': 'Traducir',
    'voice.no_speech': 'No se detectó voz',
    'voice.hold_space': 'Mantén ESPACIO para hablar',
    'nav.tts': 'Voz',
    'nav.voice': 'Chat',
    'nav.translate': 'Traducir',
    'nav.call': 'Llamar',
    'nav.signin': 'Iniciar sesión',
  },
  fr: {
    'tts.placeholder': 'Collez du texte ou une URL pour convertir en voix...',
    'tts.onboard': 'Tapez ou collez du texte, déposez une URL ou essayez un exemple.',
    'tts.onboard.press': 'pour générer la voix.',
    'tts.generate': 'GÉNÉRER',
    'tts.cancel': 'ANNULER',
    'tts.done': 'TERMINÉ',
    'tts.translate': 'Traduire',
    'voice.hold_space': 'Maintenez ESPACE pour parler',
    'nav.tts': 'Voix',
    'nav.voice': 'Chat',
    'nav.translate': 'Traduire',
    'nav.call': 'Appel',
    'nav.signin': 'Connexion',
  },
  de: {
    'tts.placeholder': 'Text oder URL einfügen, um in Sprache umzuwandeln...',
    'tts.onboard': 'Text eingeben, URL einfügen oder ein Beispiel ausprobieren.',
    'tts.onboard.press': 'um Sprache zu erzeugen.',
    'tts.generate': 'ERZEUGEN',
    'tts.cancel': 'ABBRECHEN',
    'tts.done': 'FERTIG',
    'tts.translate': 'Übersetzen',
    'voice.hold_space': 'LEERTASTE halten zum Sprechen',
    'nav.tts': 'Sprache',
    'nav.voice': 'Chat',
    'nav.translate': 'Übersetzen',
    'nav.call': 'Anruf',
    'nav.signin': 'Anmelden',
  },
  pt: {
    'tts.placeholder': 'Cole texto ou URL para converter em voz...',
    'tts.generate': 'GERAR',
    'tts.cancel': 'CANCELAR',
    'tts.done': 'PRONTO',
    'tts.translate': 'Traduzir',
    'voice.hold_space': 'Segure ESPAÇO para falar',
    'nav.tts': 'Voz',
    'nav.voice': 'Chat',
    'nav.translate': 'Traduzir',
    'nav.call': 'Ligar',
    'nav.signin': 'Entrar',
  },
  ru: {
    'tts.placeholder': 'Вставьте текст или URL для преобразования в речь...',
    'tts.onboard': 'Введите текст, вставьте URL или попробуйте пример ниже.',
    'tts.onboard.press': 'для генерации речи.',
    'tts.generate': 'СОЗДАТЬ',
    'tts.cancel': 'ОТМЕНА',
    'tts.done': 'ГОТОВО',
    'tts.translate': 'Перевести',
    'voice.hold_space': 'Удерживайте ПРОБЕЛ для записи',
    'nav.tts': 'Речь',
    'nav.voice': 'Чат',
    'nav.translate': 'Перевод',
    'nav.call': 'Звонок',
    'nav.signin': 'Войти',
  },
  it: {
    'tts.placeholder': 'Incolla testo o URL per convertire in voce...',
    'tts.generate': 'GENERA',
    'tts.cancel': 'ANNULLA',
    'tts.done': 'FATTO',
    'tts.translate': 'Traduci',
    'voice.hold_space': 'Tieni SPAZIO per parlare',
    'nav.tts': 'Voce',
    'nav.voice': 'Chat',
    'nav.translate': 'Traduci',
    'nav.call': 'Chiama',
    'nav.signin': 'Accedi',
  },
}

/// Priority: explicit localStorage > URL ?lang= > default English.
/// We do NOT auto-detect from browser locale — nobody wants their UI
/// randomly localized because they're traveling.
function detectLocale(): Locale {
  // 1. Explicit user choice (from settings or language picker)
  const stored = localStorage.getItem('sonotxt_locale')
  if (stored && stored in translations) return stored as Locale

  // 2. URL param: sonotxt.com?lang=ja (for shared links)
  const params = new URLSearchParams(window.location.search)
  const urlLang = params.get('lang')
  if (urlLang && urlLang in translations) return urlLang as Locale

  // 3. Default: English. No browser sniffing.
  return 'en'
}

// Reactive i18n store
const { locale, setLocale, initFromAccount, t } = createRoot(() => {
  const [locale, setLocaleSignal] = createSignal<Locale>(detectLocale())

  // Set document lang on init
  document.documentElement.lang = detectLocale()

  function setLocale(l: Locale) {
    setLocaleSignal(l)
    localStorage.setItem('sonotxt_locale', l)
    document.documentElement.lang = l
  }

  /// Called after login — loads locale from account if user hasn't set one locally.
  function initFromAccount(accountLocale?: string) {
    // Only apply account locale if user hasn't explicitly chosen one
    if (!localStorage.getItem('sonotxt_locale') && accountLocale && accountLocale in translations) {
      setLocaleSignal(accountLocale as Locale)
      document.documentElement.lang = accountLocale
    }
  }

  function t(key: string, params?: Record<string, string | number>): string {
    const loc = locale()
    let str = translations[loc]?.[key] ?? translations.en[key] ?? key
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        str = str.replace(`{${k}}`, String(v))
      }
    }
    return str
  }

  return { locale, setLocale, initFromAccount, t }
})

export { locale, setLocale, initFromAccount, t }
export const LOCALES: { code: Locale; name: string; native: string }[] = [
  { code: 'en', name: 'English', native: 'English' },
  { code: 'zh', name: 'Chinese', native: '中文' },
  { code: 'ja', name: 'Japanese', native: '日本語' },
  { code: 'ko', name: 'Korean', native: '한국어' },
  { code: 'es', name: 'Spanish', native: 'Español' },
  { code: 'fr', name: 'French', native: 'Français' },
  { code: 'de', name: 'German', native: 'Deutsch' },
  { code: 'pt', name: 'Portuguese', native: 'Português' },
  { code: 'ru', name: 'Russian', native: 'Русский' },
  { code: 'it', name: 'Italian', native: 'Italiano' },
]
