import { getBusGuide, loadBusData } from "./busService.js";
import { getTranslation } from "./translations.js";

// HTML内の入力欄、言語ボタン、案内表示欄を取得しておきます。
const destinationSelect = document.querySelector("#destination-select");
const boardingStopSelect = document.querySelector("#boarding-stop-select");
const guideForm = document.querySelector("#bus-guide-form");
const showGuideButton = document.querySelector("#show-guide-button");
const statusMessage = document.querySelector("#status-message");
const guideResult = document.querySelector("#guide-result");
const languageButtons = document.querySelectorAll("[data-language]");

// 読み込んだデータ、選択中の言語、現在の案内・エラーを画面更新のために保持します。
let busData;
let currentLanguage = "ja";
let currentGuide = null;
let currentError = null;
let currentErrorIncludesServerHint = false;

/**
 * 選択中の言語で文章を取得します。
 *
 * @param {string} key translations.jsに登録された文言のキー
 * @param {Record<string, string | number>} [values] 文中に埋め込む値
 * @returns {string} 選択中の言語に対応する文章
 */
function text(key, values = {}) {
  return getTranslation(currentLanguage, key, values);
}

/**
 * 静的なHTML文言とページ言語設定を選択中の言語に更新します。
 *
 * @param {"ja" | "en"} language 表示言語
 */
function updateStaticText(language) {
  currentLanguage = language;
  document.documentElement.lang = language;
  document.title = text("pageTitle");

  // data-i18n属性を持つ要素の文章を、翻訳辞書の値に置き換えます。
  document.querySelectorAll("[data-i18n]").forEach((element) => {
    element.textContent = text(element.dataset.i18n);
  });

  // 言語グループのアクセシブルな名前も表示言語と一緒に変更します。
  document.querySelectorAll("[data-i18n-aria-label]").forEach((element) => {
    element.setAttribute("aria-label", text(element.dataset.i18nAriaLabel));
  });

  // 現在選ばれている言語を支援技術にも伝えます。
  languageButtons.forEach((button) => {
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.language === currentLanguage)
    );
  });

  renderStatusMessage();
}

/**
 * 選択肢に表示する停留所名を言語に合わせて組み立てます。
 * どちらの言語でも、日本語名とGTFSの英語名を併記します。
 *
 * @param {string} nameJa GTFSの日本語停留所名
 * @param {string} nameEn GTFSの英語停留所名。未登録なら空文字列
 * @returns {string} 選択中の言語を先にした停留所名
 */
function getPlaceLabel(nameJa, nameEn) {
  if (!nameEn) {
    return nameJa;
  }

  return currentLanguage === "en"
    ? `${nameEn} — ${nameJa}`
    : `${nameJa}（${nameEn}）`;
}

/**
 * select要素へ選択肢を1つ追加します。
 *
 * 表示文はinnerHTMLではなくtextContentに設定し、データがHTMLとして
 * 解釈されないようにします。
 *
 * @param {HTMLSelectElement} select 選択肢を追加するselect要素
 * @param {string} value 選択値として使う識別子
 * @param {string} label 画面に表示する文章
 */
function addOption(select, value, label) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  select.append(option);
}

/**
 * 選択済みの目的地を維持したまま、目的地の表示名を更新します。
 *
 * @param {string} [selectedId] 選択状態を維持する目的地ID
 */
function populateDestinations(selectedId = "") {
  // 最初の空の選択肢はHTMLの翻訳対象にしてあるため、追加済みの目的地だけ削除します。
  while (destinationSelect.options.length > 1) {
    destinationSelect.remove(1);
  }

  for (const destination of busData.destinations) {
    addOption(
      destinationSelect,
      destination.id,
      getPlaceLabel(destination.nameJa, destination.nameEn)
    );
  }

  destinationSelect.value = selectedId;
}

/**
 * 選択中の目的地に対応するGTFS検証済み乗車停留所を表示します。
 *
 * @param {string} [selectedId] 選択状態を維持する乗車停留所ID
 * @throws {Error} 選択目的地の路線データが存在しない場合
 */
function populateBoardingStops(selectedId = "") {
  const destination = busData.destinations.find(
    (item) => item.id === destinationSelect.value
  );

  // 既存の動的選択肢を削除し、目的地に合った案内文を表示します。
  while (boardingStopSelect.options.length > 1) {
    boardingStopSelect.remove(1);
  }
  boardingStopSelect.options[0].textContent = text(
    destination ? "boardingStopPlaceholder" : "chooseDestinationFirst"
  );
  boardingStopSelect.disabled = !destination;

  if (!destination) {
    boardingStopSelect.value = "";
    return;
  }

  const route = busData.routes.find((item) => item.routeId === destination.routeId);
  const routeDestination = route?.destinations.find(
    (item) => item.destinationId === destination.id
  );

  if (!routeDestination) {
    const error = new Error("destinationRouteMissing");
    error.code = "destinationRouteMissing";
    throw error;
  }

  for (const stop of routeDestination.boardingStops) {
    addOption(
      boardingStopSelect,
      stop.stopId,
      getPlaceLabel(stop.nameJa, stop.nameEn)
    );
  }

  // 言語切り替え後も、以前選んでいた停留所が存在すれば選択状態を戻します。
  boardingStopSelect.value = selectedId;
}

/**
 * 現在のエラーを選択中の言語で画面に表示します。
 *
 * @param {boolean} [includeLocalServerHint] サーバー起動案内も表示する場合はtrue
 */
function renderStatusMessage() {
  if (!currentError) {
    statusMessage.textContent = "";
    return;
  }

  const knownErrorCodes = [
    "destinationLoadError",
    "routeDataLoadError",
    "invalidDataFormat",
    "destinationMissing",
    "routeMissing",
    "destinationRouteMissing",
    "destinationNotVerified",
    "boardingStopNotVerified",
    "invalidStopOrder"
  ];
  const errorCode = knownErrorCodes.includes(currentError.code)
    ? currentError.code
    : "unexpectedError";

  statusMessage.textContent = text(errorCode, currentError.details ?? {});
  if (currentErrorIncludesServerHint) {
    statusMessage.textContent += ` ${text("localServerHint")}`;
  }
}

/**
 * エラー情報を保存し、現在の言語で利用者に知らせます。
 *
 * @param {Error} error 発生したエラー
 * @param {boolean} [includeLocalServerHint] 起動方法の案内を追加するか
 */
function showError(error, includeLocalServerHint = false) {
  currentError = error;
  currentErrorIncludesServerHint = includeLocalServerHint;
  renderStatusMessage();
}

/**
 * 選択中の言語で、現在の案内カードに表示する値を更新します。
 *
 * 系統番号と車両の行き先表示は、実物の表示板と照合できるよう
 * 日本語のGTFS表記を維持します。停留所名は英語訳と日本語名を併記します。
 */
function renderGuide() {
  if (!currentGuide) {
    guideResult.hidden = true;
    return;
  }

  document.querySelector("#route-number").textContent =
    currentGuide.route.routeShortName;
  document.querySelector("#bus-headsign").textContent =
    currentGuide.headsignJa;
  document.querySelector("#selected-boarding-stop").textContent =
    getPlaceLabel(currentGuide.boardingStop.nameJa, currentGuide.boardingStop.nameEn);

  // 検証済みデータにある停車順を使い、乗車地点から降車地点までの一覧を作り直します。
  const routeStopList = document.querySelector("#route-stop-list");
  routeStopList.replaceChildren();
  currentGuide.boardingStop.itineraryStops.forEach((stop, index, stops) => {
    const item = document.createElement("li");
    item.className = "route-stop";
    item.setAttribute("aria-current", index === 0 || index === stops.length - 1
      ? "step"
      : "false");

    const name = document.createElement("span");
    name.className = "route-stop-name";
    name.textContent = getPlaceLabel(stop.nameJa, stop.nameEn);
    item.append(name);

    if (index === 0 || index === stops.length - 1) {
      const badge = document.createElement("span");
      badge.className = "route-stop-badge";
      badge.textContent = text(index === 0 ? "boardingStopBadge" : "alightingStopBadge");
      item.append(badge);
    }

    routeStopList.append(item);
  });

  document.querySelector("#alighting-name-ja").textContent =
    currentGuide.alightingStop.nameJa;
  document.querySelector("#alighting-name-romaji").textContent =
    currentGuide.alightingStop.nameRomanized;
  document.querySelector("#alighting-name-en").textContent =
    currentGuide.alightingStop.nameEn;

  const fare = currentGuide.fare.price.toLocaleString(
    currentLanguage === "ja" ? "ja-JP" : "en-US"
  );
  document.querySelector("#fare-amount").textContent = currentLanguage === "ja"
    ? `${fare}円`
    : `${currentGuide.fare.currency} ${fare}`;

  document.querySelector("#fare-note").textContent =
    currentGuide.fare.icPrice === null
      ? text("fareNotSpecified")
      : text("icFare", {
        fare: currentGuide.fare.icPrice.toLocaleString(
          currentLanguage === "ja" ? "ja-JP" : "en-US"
        )
      });

  guideResult.hidden = false;
}

/**
 * 言語を切り替え、現在の選択内容や案内結果を保ったまま表示を更新します。
 *
 * @param {"ja" | "en"} language 切り替え先の言語
 */
function changeLanguage(language) {
  if (language !== "ja" && language !== "en") {
    return;
  }

  const selectedDestinationId = destinationSelect.value;
  const selectedBoardingStopId = boardingStopSelect.value;

  updateStaticText(language);

  if (busData) {
    populateDestinations(selectedDestinationId);
    populateBoardingStops(selectedBoardingStopId);
  }

  renderGuide();
}

/**
 * JSONを読み込んで内容を検証し、目的地の選択欄を利用可能にします。
 *
 * @returns {Promise<void>}
 */
async function initialize() {
  try {
    busData = await loadBusData();
    populateDestinations();
    destinationSelect.disabled = false;
  } catch (error) {
    showError(error, true);
  }
}

// 初期表示は開発時に確認しやすい日本語にします。
updateStaticText(currentLanguage);
destinationSelect.disabled = true;

// 言語ボタンを押したとき、選択中の言語に画面全体を更新します。
languageButtons.forEach((button) => {
  button.addEventListener("click", () => {
    changeLanguage(button.dataset.language);
  });
});

// 目的地が変わったら停留所候補を作り直し、以前の案内・エラーを消します。
destinationSelect.addEventListener("change", () => {
  currentGuide = null;
  currentError = null;
  currentErrorIncludesServerHint = false;
  guideResult.hidden = true;

  try {
    populateBoardingStops();
  } catch (error) {
    showError(error);
  }

  showGuideButton.disabled = true;
  renderStatusMessage();
});

// 停留所が選ばれている場合だけ、案内を表示するボタンを有効にします。
boardingStopSelect.addEventListener("change", () => {
  currentGuide = null;
  currentError = null;
  currentErrorIncludesServerHint = false;
  guideResult.hidden = true;
  showGuideButton.disabled = boardingStopSelect.value === "";
  renderStatusMessage();
});

// フォーム送信時にページを再読み込みせず、検証済みの案内カードを表示します。
guideForm.addEventListener("submit", (event) => {
  event.preventDefault();

  try {
    currentGuide = getBusGuide(
      busData,
      destinationSelect.value,
      boardingStopSelect.value
    );
    currentError = null;
    currentErrorIncludesServerHint = false;
    renderStatusMessage();
    renderGuide();
    guideResult.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    currentGuide = null;
    guideResult.hidden = true;
    showError(error);
  }
});

initialize();
