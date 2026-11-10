import { getBusGuide, loadBusData } from "./busService.js";
import { getTranslation } from "./translations.js";

// HTMLに定義した画面要素を取得し、画面遷移と案内表示から再利用します。
const destinationSelect = document.querySelector("#destination-select");
const boardingStopSelect = document.querySelector("#boarding-stop-select");
const startGuideButton = document.querySelector("#start-guide-button");
const destinationNextButton = document.querySelector("#destination-next-button");
const boardingSubmitButton = document.querySelector("#boarding-submit-button");
const statusMessage = document.querySelector("#status-message");
const progressNavigation = document.querySelector("#screen-progress");
const headerHomeButton = document.querySelector("#header-home-button");
const languageButtons = document.querySelectorAll("[data-language]");
const screenNames = ["home", "destination", "boarding", "guide"];

// 読み込んだデータ、選択中の言語、現在の画面と案内情報を保持します。
let busData;
let currentLanguage = "ja";
let currentScreen = "home";
let currentGuide = null;
let currentError = null;
let currentErrorIncludesServerHint = false;

/**
 * 選択中の言語で文章を取得します。
 *
 * @param {string} key translations.jsに登録した文言のキー
 * @param {Record<string, string | number>} [values] 文中に埋め込む値
 * @returns {string} 選択中の言語に対応する文章
 */
function text(key, values = {}) {
  return getTranslation(currentLanguage, key, values);
}

/**
 * HTMLの翻訳キーを選択中の言語の文章へ置き換えます。
 *
 * @param {"ja" | "en"} language 表示言語
 */
function updateStaticText(language) {
  currentLanguage = language;
  document.documentElement.lang = language;
  document.title = text("pageTitle");

  // テンプレート内に置いた翻訳キーをすべて更新します。
  document.querySelectorAll("[data-i18n]").forEach((element) => {
    element.textContent = text(element.dataset.i18n);
  });

  // スクリーンリーダーが使うラベルも、画面の表示言語とそろえます。
  document.querySelectorAll("[data-i18n-aria-label]").forEach((element) => {
    element.setAttribute("aria-label", text(element.dataset.i18nAriaLabel));
  });

  // 押下状態を更新して、現在の言語を支援技術にも知らせます。
  languageButtons.forEach((button) => {
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.language === currentLanguage)
    );
  });

  renderStatusMessage();
  renderCurrentScreen();
}

/**
 * 停留所名を日本語または英語を先にした表示に整えます。
 *
 * @param {string} nameJa GTFSの日本語停留所名
 * @param {string} nameEn GTFSの英語停留所名。未登録なら空文字列
 * @returns {string} 選択中の言語に合わせた停留所名
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
 * select要素へ、HTMLとして解釈されない安全な選択肢を追加します。
 *
 * @param {HTMLSelectElement} select 選択肢を追加する要素
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
 * 目的地一覧を表示し、指定された目的地の選択状態を保ちます。
 *
 * @param {string} [selectedId] 選択状態を維持する目的地ID
 */
function populateDestinations(selectedId = "") {
  // 先頭の案内用選択肢は残し、以前作った目的地だけを入れ替えます。
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
 * 選択した目的地に対応する、GTFSで検証済みの乗車停留所を表示します。
 *
 * @param {string} [selectedId] 選択状態を維持する乗車停留所ID
 * @throws {Error} 選択目的地の路線データが存在しない場合
 */
function populateBoardingStops(selectedId = "") {
  const destination = busData.destinations.find(
    (item) => item.id === destinationSelect.value
  );

  // 目的地を変更した場合に、古い停留所候補が残らないようにします。
  while (boardingStopSelect.options.length > 1) {
    boardingStopSelect.remove(1);
  }
  boardingStopSelect.options[0].textContent = text(
    destination ? "boardingStopPlaceholder" : "chooseDestinationFirst"
  );
  boardingStopSelect.disabled = !destination;

  if (!destination) {
    boardingStopSelect.value = "";
    boardingSubmitButton.disabled = true;
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

  // 言語を切り替えても、選択済みの停留所を保ちます。
  boardingStopSelect.value = selectedId;
  boardingSubmitButton.disabled = boardingStopSelect.value === "";
}

/**
 * 現在のエラーを、選択中の言語で利用者に伝えます。
 */
function renderStatusMessage() {
  if (!currentError) {
    statusMessage.textContent = "";
    return;
  }

  // 翻訳辞書にない内部エラー名を画面へ出さないよう、既知のコードに限定します。
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
 * エラー情報を保持し、現在の言語で画面に表示します。
 *
 * @param {Error} error 発生したエラー
 * @param {boolean} [includeLocalServerHint] サーバー起動案内を追加する場合はtrue
 */
function showError(error, includeLocalServerHint = false) {
  currentError = error;
  currentErrorIncludesServerHint = includeLocalServerHint;
  renderStatusMessage();
}

/**
 * 画面を切り替え、進捗表示と見出しフォーカスを更新します。
 *
 * @param {"home" | "destination" | "boarding" | "guide"} screenName 移動先画面
 * @param {boolean} [moveFocus] 画面見出しへフォーカスを移す場合はtrue
 */
function setScreen(screenName, moveFocus = true) {
  if (!screenNames.includes(screenName)) {
    throw new Error(`画面が見つかりません: ${screenName}`);
  }

  currentScreen = screenName;
  renderCurrentScreen();

  if (screenName === "home") {
    progressNavigation.hidden = true;
  } else {
    progressNavigation.hidden = false;
    const activeStep = screenName === "destination" ? "destination"
      : screenName === "boarding" ? "boarding"
        : "guide";

    document.querySelectorAll("[data-progress-step]").forEach((step) => {
      if (step.dataset.progressStep === activeStep) {
        step.setAttribute("aria-current", "step");
      } else {
        step.removeAttribute("aria-current");
      }
    });
  }

  // 画面遷移後は見出しへ移動し、キーボード利用者にも変化を伝えます。
  if (moveFocus) {
    document.querySelector(`#screen-${screenName} .screen-heading`)?.focus();
    // 画面切り替えのたびにスクロール位置を即時に戻し、操作対象を安定させます。
    window.scrollTo(0, 0);
  }
}

/**
 * 選択中の画面に必要な説明と案内内容を更新します。
 */
function renderCurrentScreen() {
  const introductionKeys = {
    home: "pageIntroduction",
    destination: "destinationScreenIntro",
    boarding: "boardingScreenIntro",
    guide: "busComparisonHelp"
  };
  document.querySelector("#page-introduction").textContent =
    text(introductionKeys[currentScreen]);

  screenNames.forEach((screenName) => {
    document.querySelector(`#screen-${screenName}`).hidden =
      screenName !== currentScreen;
  });
  headerHomeButton.hidden = currentScreen === "home";
  document.querySelector("#home-note").textContent =
    text(busData ? "homeReady" : "homeNote");

  if (currentScreen === "guide" && currentGuide) {
    renderGuide();
  }
}

/**
 * 選択済みのバス情報、経路、降車場所、運賃を案内画面へ反映します。
 */
function renderGuide() {
  if (!currentGuide) {
    return;
  }

  document.querySelector("#route-number").textContent =
    currentGuide.route.routeShortName;
  document.querySelector("#bus-headsign").textContent =
    currentGuide.headsignJa;
  document.querySelector("#selected-boarding-stop").textContent =
    getPlaceLabel(currentGuide.boardingStop.nameJa, currentGuide.boardingStop.nameEn);

  // 停車順が変わらないよう、検証済み経路をそのまま順番に表示します。
  const routeStopList = document.querySelector("#route-stop-list");
  routeStopList.replaceChildren();
  currentGuide.boardingStop.itineraryStops.forEach((stop, index, stops) => {
    const item = document.createElement("li");
    item.className = "route-stop";
    item.setAttribute(
      "aria-current",
      index === 0 || index === stops.length - 1 ? "step" : "false"
    );

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
}

/**
 * 選択中の目的地と停留所から案内データを作り、案内画面へ移動します。
 */
function openGuide() {
  try {
    currentGuide = getBusGuide(
      busData,
      destinationSelect.value,
      boardingStopSelect.value
    );
    currentError = null;
    currentErrorIncludesServerHint = false;
    renderStatusMessage();
    setScreen("guide");
  } catch (error) {
    currentGuide = null;
    showError(error);
  }
}

/**
 * 言語を切り替え、選択内容を維持したまま画面内の表示を更新します。
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

  // 言語切り替え後も進捗表示の選択状態を現在画面に合わせます。
  if (currentScreen !== "home") {
    setScreen(currentScreen, false);
  }
}

/**
 * JSONを読み込んで検証し、目的地選択を利用可能にします。
 *
 * @returns {Promise<void>}
 */
async function initialize() {
  try {
    busData = await loadBusData();
    populateDestinations();
    destinationSelect.disabled = false;
    startGuideButton.disabled = false;
    document.querySelector("#home-note").textContent = text("homeReady");
  } catch (error) {
    showError(error, true);
  }
}

// HTMLの初期画面を、既定の日本語で表示します。
updateStaticText(currentLanguage);
destinationSelect.disabled = true;
startGuideButton.disabled = true;

// 言語ボタンは、どの画面からでも現在の選択状態を保ったまま動作します。
languageButtons.forEach((button) => {
  button.addEventListener("click", () => {
    changeLanguage(button.dataset.language);
  });
});

// ホームから案内を開始するときは、目的地選択画面へ進みます。
startGuideButton.addEventListener("click", () => {
  currentError = null;
  currentErrorIncludesServerHint = false;
  renderStatusMessage();
  setScreen("destination");
});

// 目的地が変わったら停留所候補を作り直し、以前の案内を無効にします。
destinationSelect.addEventListener("change", () => {
  currentGuide = null;
  currentError = null;
  currentErrorIncludesServerHint = false;
  destinationNextButton.disabled = destinationSelect.value === "";
  boardingSubmitButton.disabled = true;

  try {
    populateBoardingStops();
  } catch (error) {
    showError(error);
  }

  renderStatusMessage();
});

// 次へ進む前に、目的地に対応した乗車停留所を画面へ用意します。
destinationNextButton.addEventListener("click", () => {
  if (!destinationSelect.value) {
    return;
  }

  currentError = null;
  currentErrorIncludesServerHint = false;
  populateBoardingStops(boardingStopSelect.value);
  setScreen("boarding");
});

// 停留所が選ばれている場合だけ、案内画面へ進む操作を有効にします。
boardingStopSelect.addEventListener("change", () => {
  currentGuide = null;
  currentError = null;
  currentErrorIncludesServerHint = false;
  boardingSubmitButton.disabled = boardingStopSelect.value === "";
  renderStatusMessage();
});

// 選択内容を検証して、バスの情報を案内画面に表示します。
boardingSubmitButton.addEventListener("click", openGuide);

// 各戻る操作は、選択済みの内容を保ったまま対応する画面へ移動します。
document.querySelector("#destination-back-button").addEventListener("click", () => {
  setScreen("home");
});
document.querySelector("#boarding-back-button").addEventListener("click", () => {
  setScreen("destination");
});
document.querySelector("#guide-back-button").addEventListener("click", () => {
  currentGuide = null;
  setScreen("boarding");
});
document.querySelector("#guide-destination-button").addEventListener("click", () => {
  currentGuide = null;
  setScreen("destination");
});
headerHomeButton.addEventListener("click", () => {
  currentGuide = null;
  setScreen("home");
});

// データ読み込みが完了するまではホームの開始ボタンを無効にします。
initialize();
