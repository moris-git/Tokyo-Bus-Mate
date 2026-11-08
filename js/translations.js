// 画面に表示する文章を日本語・英語ごとにまとめます。
// 表示言語を追加・変更するときは、HTMLや画面処理に文章を散らさず、ここを編集します。
const messages = {
  ja: {
    pageTitle: "Tokyo Bus Mate - バス案内",
    languageSelection: "表示言語",
    pageHeading: "乗るバスを探す",
    pageIntroduction: "行き先と乗車する停留所を選ぶと、乗るバスと降車する停留所を確認できます。",
    destinationLabel: "行きたい場所を選ぶ",
    destinationPlaceholder: "目的地を選択してください",
    boardingStopLabel: "乗車する停留所を選ぶ",
    boardingStopPlaceholder: "乗車する停留所を選択してください",
    chooseDestinationFirst: "先に目的地を選択してください",
    boardingStopHelp: "実際に乗る予定の停留所を選択してください。",
    showBusGuide: "バスの案内を見る",
    guideHeading: "乗るバスを確認",
    busComparisonHelp: "系統番号と行き先表示を、実際のバスと照らし合わせてください。",
    busPhotoLineOne: "バスの写真",
    busPhotoLineTwo: "準備中",
    busPhotoDescription: "バスの写真は後で追加します",
    routeNumber: "系統番号",
    destinationDisplay: "行き先表示",
    boardingStop: "乗車する停留所",
    routeStopsHeading: "乗車停留所から降車停留所まで",
    boardingStopBadge: "乗車",
    alightingStopBadge: "降車",
    getOffAt: "ここで降ります",
    alightingHelp: "車内表示の日本語名、または車内アナウンスと照らし合わせてください。",
    fareInformation: "運賃情報",
    fareNotSpecified: "運賃はGTFSの記載値です。ICカード運賃はGTFSに記載されていません。",
    icFare: "ICカード運賃：{fare}円（GTFS記載値）",
    dataSource: "データ出典：東京都交通局、公共交通オープンデータ協議会の都営バスGTFS",
    prototypeNotice: "試作品です。路線・停留所情報は同梱GTFSに基づき、リアルタイム運行情報ではありません。",
    destinationLoadError: "目的地データの読み込みに失敗しました（HTTP {status}）。",
    routeDataLoadError: "路線データの読み込みに失敗しました（HTTP {status}）。",
    invalidDataFormat: "バス案内データの形式が正しくありません。",
    localServerHint: "Live ServerなどのローカルWebサーバーからページを開いてください。",
    destinationMissing: "有効な目的地を選択してください。",
    routeMissing: "系統 {routeId} のデータがありません。",
    destinationRouteMissing: "選択した目的地に対応する検証済みの停留所が見つかりません。",
    destinationNotVerified: "選択した目的地と路線の組み合わせは確認されていません。",
    boardingStopNotVerified: "選択した乗車停留所から目的地までの経路は確認されていません。",
    invalidStopOrder: "降車停留所が乗車停留所より後にありません。経路データを確認してください。",
    unexpectedError: "予期しないエラーが発生しました。"
  },
  en: {
    pageTitle: "Tokyo Bus Mate - Bus Guide",
    languageSelection: "Language",
    pageHeading: "Find your bus",
    pageIntroduction: "Choose your destination and boarding stop to see which bus to take and where to get off.",
    destinationLabel: "Choose your destination",
    destinationPlaceholder: "Select a destination",
    boardingStopLabel: "Choose your boarding stop",
    boardingStopPlaceholder: "Select a boarding stop",
    chooseDestinationFirst: "Choose a destination first",
    boardingStopHelp: "Select the stop where you plan to board.",
    showBusGuide: "Show bus guide",
    guideHeading: "Check your bus",
    busComparisonHelp: "Compare the route number and destination display with the bus.",
    busPhotoLineOne: "Bus photo",
    busPhotoLineTwo: "coming soon",
    busPhotoDescription: "Bus photo will be added later",
    routeNumber: "Route number",
    destinationDisplay: "Destination display (Japanese)",
    boardingStop: "Boarding stop",
    routeStopsHeading: "Stops from boarding to getting off",
    boardingStopBadge: "Board",
    alightingStopBadge: "Get off",
    getOffAt: "GET OFF AT",
    alightingHelp: "Check the Japanese stop name on the bus display or listen for the announcement.",
    fareInformation: "Fare information",
    fareNotSpecified: "Fare shown from GTFS. An IC card fare is not specified in the feed.",
    icFare: "IC card fare: JPY {fare} (from GTFS)",
    dataSource: "Data source: Toei Bus GTFS, provided by the Tokyo Metropolitan Bureau of Transportation and Public Transportation Open Data Center.",
    prototypeNotice: "Prototype. Route and stop information is based on the bundled GTFS feed and is not real-time.",
    destinationLoadError: "Could not load destination data (HTTP {status}).",
    routeDataLoadError: "Could not load route data (HTTP {status}).",
    invalidDataFormat: "The bus guide data has an unexpected format.",
    localServerHint: "Open this page through a local web server such as Live Server.",
    destinationMissing: "Please choose a valid destination.",
    routeMissing: "Route {routeId} is not available.",
    destinationRouteMissing: "No verified stops were found for the selected destination.",
    destinationNotVerified: "This destination and bus route combination has not been verified.",
    boardingStopNotVerified: "The selected boarding stop has not been verified for this destination.",
    invalidStopOrder: "The alighting stop does not come after the boarding stop. Check the route data.",
    unexpectedError: "An unexpected error occurred."
  }
};

/**
 * 選択中の言語に対応する画面文言を返します。
 * 未対応の言語やキーを指定した場合は、画面にキー名を出さず例外にします。
 *
 * @param {"ja" | "en"} language 表示言語
 * @param {string} key translationsに登録された文言のキー
 * @param {Record<string, string | number>} [values] 文中に埋め込む値
 * @returns {string} 言語に応じた文言
 */
export function getTranslation(language, key, values = {}) {
  const template = messages[language]?.[key];
  if (typeof template !== "string") {
    throw new Error(`翻訳が見つかりません: ${language}.${key}`);
  }

  return template.replace(/\{(\w+)\}/g, (placeholder, name) => {
    if (!(name in values)) {
      throw new Error(`翻訳に必要な値がありません: ${language}.${key}.${name}`);
    }

    return String(values[name]);
  });
}
