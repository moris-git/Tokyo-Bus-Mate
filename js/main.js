import { getBusGuide, loadBusData } from "./busService.js";
import { getTranslation } from "./translations.js";

// HTMLに定義した要素を取得し、画面更新とユーザー操作で共有します。
const page = document.querySelector(".page");
const homeBranding = document.querySelector("#home-branding");
const flowHeader = document.querySelector("#flow-header");
const welcomeActionButton = document.querySelector("#welcome-action-button");
const destinationSearch = document.querySelector("#destination-search");
const destinationList = document.querySelector("#destination-list");
const destinationCount = document.querySelector("#destination-count");
const emptyDestinations = document.querySelector("#empty-destinations");
const boardingStopList = document.querySelector("#boarding-stop-list");
const statusMessage = document.querySelector("#status-message");
const homeActionButton = document.querySelector("#home-action-button");
const flowActionButton = document.querySelector("#flow-action-button");
const flowActionLabel = document.querySelector("#flow-action-label");
const busMatchCheckbox = document.querySelector("#bus-match-checkbox");
const screenNames = ["welcome", "home", "boarding", "check", "aboard", "complete"];
const stepByScreen = { boarding: 2, check: 3, aboard: 4, complete: 5 };
const destinationArt = {
  "ueno-zoo": "🐼",
  "ueno-park": "🌸",
  "ueno-station": "🚉",
  "ueno-matsuzakaya": "🏬"
};
const actionLabels = {
  boarding: "confirmBoardingStop",
  check: "foundMyBus",
  aboard: "gotIt",
  complete: "returnHome"
};

// 読み込み済みデータ、選択内容、現在の案内画面を保持します。
let busData;
let currentLanguage = "ja";
let currentScreen = "welcome";
let currentDestinationId = "";
let currentBoardingStopId = "";
let currentGuide = null;
let currentError = null;
let currentErrorIncludesServerHint = false;

// 選択中の言語で翻訳文を取得します。
function text(key, values = {}) {
  return getTranslation(currentLanguage, key, values);
}

// HTMLの翻訳対象、入力ヒント、アクセシビリティラベルを選択言語に更新します。
function updateStaticText(language) {
  currentLanguage = language;
  document.documentElement.lang = language;
  document.title = text("pageTitle");

  document.querySelectorAll("[data-i18n]").forEach((element) => {
    element.textContent = text(element.dataset.i18n);
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((element) => {
    element.setAttribute("placeholder", text(element.dataset.i18nPlaceholder));
  });
  document.querySelectorAll("[data-i18n-aria-label]").forEach((element) => {
    element.setAttribute("aria-label", text(element.dataset.i18nAriaLabel));
  });
  document.querySelectorAll("[data-language]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.language === language));
  });

  renderDestinations();
  renderStatusMessage();
  renderCurrentScreen();
}

// 停留所名は、画面言語に応じて日本語または英語を優先して表示します。
function displayStopName(stop) {
  return currentLanguage === "en" && stop.nameEn ? stop.nameEn : stop.nameJa;
}

// 検索文字列で目的地を絞り込み、選択可能なカードとして描画します。
function renderDestinations() {
  if (!busData) {
    return;
  }

  const query = destinationSearch.value.trim().toLocaleLowerCase();
  const destinations = busData.destinations.filter((destination) =>
    `${destination.nameJa} ${destination.nameEn}`.toLocaleLowerCase().includes(query)
  );
  destinationList.replaceChildren();

  for (const destination of destinations) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "destination-card";
    card.setAttribute("aria-pressed", String(destination.id === currentDestinationId));
    card.setAttribute(
      "aria-label",
      `${destination.nameEn || destination.nameJa}, ${destination.nameJa}, ${
        destination.id === currentDestinationId ? text("selected") : text("choose")
      }`
    );
    card.addEventListener("click", () => {
      currentDestinationId = destination.id;
      currentGuide = null;
      renderDestinations();
      updateActionState();
    });

    const art = document.createElement("span");
    art.className = `destination-art destination-art--${destination.id}`;
    art.setAttribute("aria-hidden", "true");
    const subject = document.createElement("span");
    subject.className = "art-subject";
    subject.textContent = destinationArt[destination.id] ?? "📍";
    art.append(subject);

    const content = document.createElement("span");
    content.className = "destination-card-content";
    const japaneseName = document.createElement("span");
    japaneseName.className = "destination-name-ja";
    japaneseName.textContent = destination.nameJa;
    const englishName = document.createElement("span");
    englishName.className = "destination-name-en";
    englishName.textContent = destination.nameEn || destination.nameJa;
    const selection = document.createElement("span");
    selection.className = "destination-selection";
    selection.textContent = destination.id === currentDestinationId
      ? text("selected")
      : text("choose");
    content.append(japaneseName, englishName, selection);
    card.append(art, content);
    destinationList.append(card);
  }

  destinationCount.textContent = text("placeCount", { count: destinations.length });
  emptyDestinations.hidden = destinations.length > 0;
  updateActionState();
}

// 選択中の目的地と、それに対応する検証済み路線情報を取得します。
function getSelectedDestination() {
  return busData?.destinations.find((destination) => destination.id === currentDestinationId);
}

function getRouteDestination(destination) {
  const route = busData?.routes.find((item) => item.routeId === destination?.routeId);
  const routeDestination = route?.destinations.find(
    (item) => item.destinationId === destination?.id
  );
  return { route, routeDestination };
}

// 選択目的地の停留所候補を表示し、前回選んだ停留所があれば維持します。
function populateBoardingStops(selectedStopId = "") {
  const destination = getSelectedDestination();
  const { routeDestination } = getRouteDestination(destination);
  if (!destination || !routeDestination) {
    const error = new Error("destinationRouteMissing");
    error.code = "destinationRouteMissing";
    throw error;
  }

  document.querySelector("#boarding-destination-name").textContent =
    currentLanguage === "en" ? destination.nameEn : destination.nameJa;
  const destinationArtElement = document.querySelector("#boarding-destination-art");
  destinationArtElement.className = `mini-art destination-art--${destination.id}`;
  destinationArtElement.textContent = destinationArt[destination.id] ?? "📍";
  boardingStopList.replaceChildren();
  for (const stop of routeDestination.boardingStops) {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "boarding-stop-option";
    option.setAttribute("aria-pressed", String(stop.stopId === selectedStopId));
    option.addEventListener("click", () => {
      currentBoardingStopId = stop.stopId;
      currentGuide = null;
      renderBoardingStops();
      updateActionState();
    });

    const icon = document.createElement("span");
    icon.className = "stop-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "⌖";
    const copy = document.createElement("span");
    copy.className = "stop-copy";
    const englishName = document.createElement("strong");
    englishName.textContent = stop.nameEn || stop.nameJa;
    const japaneseName = document.createElement("small");
    japaneseName.textContent = stop.nameJa;
    const radio = document.createElement("span");
    radio.className = "radio-mark";
    radio.setAttribute("aria-hidden", "true");
    copy.append(englishName, japaneseName);
    option.append(icon, copy, radio);
    boardingStopList.append(option);
  }

  currentBoardingStopId = routeDestination.boardingStops.some(
    (stop) => stop.stopId === selectedStopId
  ) ? selectedStopId : "";
  renderBoardingStops();
}

// 停留所候補の選択状態を、現在選ばれているIDに合わせて表示します。
function renderBoardingStops() {
  const buttons = boardingStopList.querySelectorAll(".boarding-stop-option");
  buttons.forEach((button, index) => {
    const destination = getSelectedDestination();
    const { routeDestination } = getRouteDestination(destination);
    const stop = routeDestination?.boardingStops[index];
    button.setAttribute("aria-pressed", String(stop?.stopId === currentBoardingStopId));
  });
}

// 選択内容から案内を組み立て、バス確認・降車案内・旅程画面へ反映します。
function renderGuide() {
  if (!currentGuide) {
    return;
  }

  const { destination, route, headsignJa, boardingStop, alightingStop } = currentGuide;
  document.querySelector("#boarding-destination-name").textContent =
    currentLanguage === "en" ? destination.nameEn : destination.nameJa;
  const boardingArt = document.querySelector("#boarding-destination-art");
  boardingArt.className = `mini-art destination-art--${destination.id}`;
  boardingArt.textContent =
    destinationArt[destination.id] ?? "📍";
  document.querySelector("#route-number").textContent = route.routeShortName;
  document.querySelector("#bus-headsign").textContent = headsignJa;
  document.querySelector("#bus-headsign-translation").textContent = text("japaneseDisplay");
  document.querySelector("#check-boarding-stop").textContent = displayStopName(boardingStop);
  document.querySelector("#check-boarding-stop-en").textContent =
    currentLanguage === "en" ? boardingStop.nameJa : boardingStop.nameEn || "";
  document.querySelector("#check-alighting-stop").textContent = displayStopName(alightingStop);
  document.querySelector("#check-alighting-stop-en").textContent =
    currentLanguage === "en" ? alightingStop.nameJa : alightingStop.nameEn || "";

  const art = document.querySelector("#aboard-destination-art");
  art.className = `destination-photo destination-art--${destination.id}`;
  art.replaceChildren();
  const subject = document.createElement("span");
  subject.className = "art-subject";
  subject.setAttribute("aria-hidden", "true");
  subject.textContent = destinationArt[destination.id] ?? "📍";
  art.append(subject);
  art.setAttribute(
    "aria-label",
    currentLanguage === "en" ? `${destination.nameEn} illustration` : `${destination.nameJa}のイメージ`
  );
  document.querySelector("#aboard-heading").textContent = alightingStop.nameJa;
  document.querySelector("#alighting-name-romaji").textContent =
    alightingStop.nameRomanized || alightingStop.nameEn;

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

  document.querySelector("#summary-boarding-stop").textContent = displayStopName(boardingStop);
  document.querySelector("#summary-boarding-stop-en").textContent =
    currentLanguage === "en" ? boardingStop.nameJa : boardingStop.nameEn || "";
  document.querySelector("#summary-route").textContent = route.routeShortName;
  document.querySelector("#summary-direction").textContent = headsignJa;
  document.querySelector("#summary-alighting-stop").textContent = alightingStop.nameJa;
  document.querySelector("#summary-alighting-stop-en").textContent =
    alightingStop.nameRomanized || alightingStop.nameEn;
  document.querySelector("#summary-destination").textContent =
    currentLanguage === "en" ? destination.nameEn : destination.nameJa;
  document.querySelector("#summary-destination-ja").textContent =
    currentLanguage === "en" ? destination.nameJa : destination.nameEn || "";
  const summaryArt = document.querySelector("#summary-destination-art");
  summaryArt.className = `mini-art destination-art--${destination.id}`;
  summaryArt.textContent =
    destinationArt[destination.id] ?? "📍";
  renderRouteStops();
}

// 乗車停留所から降車停留所までの経路を、停車順に一覧表示します。
function renderRouteStops() {
  const routeStops = document.querySelector("#route-stop-list");
  routeStops.replaceChildren();
  currentGuide.boardingStop.itineraryStops.forEach((stop, index, stops) => {
    const item = document.createElement("li");
    item.className = "route-stop";
    const name = document.createElement("span");
    name.textContent = displayStopName(stop);
    item.append(name);

    if (index === 0 || index === stops.length - 1) {
      const badge = document.createElement("strong");
      badge.textContent = text(index === 0 ? "boardingStop" : "getOffAt");
      item.append(badge);
    }

    routeStops.append(item);
  });
}

// 必須の選択やバス一致確認の状態に応じて、次へ進むボタンを有効化します。
function updateActionState() {
  const selectedDestinationIsVisible =
    destinationList.querySelector('.destination-card[aria-pressed="true"]') !== null;
  homeActionButton.disabled = !busData || !currentDestinationId ||
    (currentScreen === "home" && !selectedDestinationIsVisible);
  welcomeActionButton.disabled = !busData;
  const enabled = currentScreen === "boarding"
    ? Boolean(currentBoardingStopId)
    : currentScreen === "check"
      ? busMatchCheckbox.checked
      : true;
  flowActionButton.disabled = !enabled;
}

// 画面表示、進捗、次の操作ボタンを現在のステップに合わせて更新します。
function renderCurrentScreen() {
  const isLandingScreen = currentScreen === "welcome" || currentScreen === "home";
  page.classList.toggle("is-welcome", currentScreen === "welcome");
  page.classList.toggle("is-home", currentScreen === "home");
  page.classList.toggle("is-aboard", currentScreen === "aboard");
  page.classList.toggle("is-complete", currentScreen === "complete");
  homeBranding.hidden = !isLandingScreen;
  flowHeader.hidden = isLandingScreen;
  welcomeActionButton.hidden = currentScreen !== "welcome";
  homeActionButton.hidden = currentScreen !== "home";
  flowActionButton.hidden = isLandingScreen;

  for (const screenName of screenNames) {
    document.querySelector(`#screen-${screenName}`).hidden = screenName !== currentScreen;
  }

  if (currentScreen === "home") {
    document.querySelector("#home-note").textContent =
      text(busData ? "homeReady" : "homeNote");
  } else if (!isLandingScreen) {
    const step = stepByScreen[currentScreen];
    document.querySelector("#step-count").textContent = `${step}/5`;
    document.querySelectorAll("[data-progress-bar]").forEach((bar) => {
      bar.classList.toggle("is-complete", Number(bar.dataset.progressBar) <= step);
    });
    flowActionLabel.textContent = text(actionLabels[currentScreen]);
    if (currentGuide) {
      renderGuide();
    }
  }

  updateActionState();
}

// 既知のエラーだけを翻訳して表示し、内部情報を画面へ出さないようにします。
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

// エラーを保持し、必要ならローカルサーバー起動の案内も添えて表示します。
function showError(error, includeLocalServerHint = false) {
  currentError = error;
  currentErrorIncludesServerHint = includeLocalServerHint;
  renderStatusMessage();
}

// 指定画面へ移動し、進捗表示を更新して見出しへフォーカスを移します。
function setScreen(screenName, moveFocus = true) {
  if (!screenNames.includes(screenName)) {
    throw new Error(`画面が見つかりません: ${screenName}`);
  }

  currentScreen = screenName;
  renderCurrentScreen();
  if (moveFocus) {
    document.querySelector(`#screen-${screenName} .screen-heading, #screen-${screenName} .home-heading`)
      ?.focus();
    window.scrollTo(0, 0);
  }
}

// 目的地に紐づく停留所候補を用意して、乗車地点選択へ進みます。
function openBoardingScreen() {
  try {
    const { routeDestination } = getRouteDestination(getSelectedDestination());
    if (!routeDestination) {
      const error = new Error("destinationRouteMissing");
      error.code = "destinationRouteMissing";
      throw error;
    }
    currentError = null;
    currentBoardingStopId = routeDestination.boardingStops[0]?.stopId ?? "";
    populateBoardingStops(currentBoardingStopId);
    setScreen("boarding");
  } catch (error) {
    showError(error);
  }
}

// 選択済みの目的地と停留所を検証し、バス確認画面を開きます。
function openBusCheck() {
  try {
    currentGuide = getBusGuide(busData, currentDestinationId, currentBoardingStopId);
    currentError = null;
    busMatchCheckbox.checked = false;
    renderStatusMessage();
    setScreen("check");
  } catch (error) {
    currentGuide = null;
    showError(error);
  }
}

// 現在の案内ステップに応じて、前の画面へ戻ります。
function goBack() {
  const previousScreen = {
    boarding: "home",
    check: "boarding",
    aboard: "check",
    complete: "welcome"
  }[currentScreen];
  if (previousScreen) {
    setScreen(previousScreen);
  }
}

// 目的地・路線データを読み込み、利用可能になったらホームを更新します。
async function initialize() {
  try {
    busData = await loadBusData();
    currentDestinationId = busData.destinations[0]?.id ?? "";
    renderDestinations();
    renderCurrentScreen();
  } catch (error) {
    showError(error, true);
  }
}

// 初期表示は日本語にし、データ読み込み中は開始ボタンを無効にします。
updateStaticText(currentLanguage);
renderCurrentScreen();

// 言語を切り替えても、選択内容と現在の案内画面を維持します。
document.querySelectorAll("[data-language]").forEach((button) => {
  button.addEventListener("click", () => {
    if (button.dataset.language !== currentLanguage) {
      updateStaticText(button.dataset.language);
    }
  });
});

// 検索、画面遷移、バス一致確認などのユーザー操作を登録します。
destinationSearch.addEventListener("input", renderDestinations);
welcomeActionButton.addEventListener("click", () => {
  currentError = null;
  renderStatusMessage();
  setScreen("home");
});
homeActionButton.addEventListener("click", openBoardingScreen);
flowActionButton.addEventListener("click", () => {
  if (currentScreen === "boarding") {
    openBusCheck();
  } else if (currentScreen === "check") {
    setScreen("aboard");
  } else if (currentScreen === "aboard") {
    setScreen("complete");
  } else if (currentScreen === "complete") {
    setScreen("welcome");
  }
});
document.querySelector("#back-button").addEventListener("click", goBack);
busMatchCheckbox.addEventListener("change", updateActionState);

// アプリ起動時に、目的地と路線のデータを読み込みます。
initialize();
