import { getBusGuide, getEstimatedArrivalTime, loadBusData } from "./busService.js";
import { getTranslation } from "./translations.js";

// HTMLに定義した要素を取得し、画面更新とユーザー操作で共有します。
const page = document.querySelector(".page");
const homeBranding = document.querySelector("#home-branding");
const flowHeader = document.querySelector("#flow-header");
const backButton = document.querySelector("#back-button");
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
const speakAlightingButton = document.querySelector("#speak-alighting-button");
const speechStatus = document.querySelector("#speech-status");
const screenNames = ["welcome", "home", "boarding", "check", "aboard", "complete"];
const stepByScreen = { home: 1, boarding: 2, check: 3, aboard: 4, complete: 5 };
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
let estimatedArrivalTime = null;
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
  updateSpeechSupportStatus();
}

// 英語表示ではGTFSの英訳から説明語を除いたローマ字を優先して停留所名を表示します。
function getRomanizedStopName(stop) {
  return stop.nameRomanized
    || stop.nameEn?.split(/\s+\(/, 1)[0].trim()
    || stop.nameJa;
}

// 既存の確認・完了画面では、日本語名とGTFS英訳の表示を従来どおり維持します。
function displayStopName(stop) {
  return currentLanguage === "en" && stop.nameEn ? stop.nameEn : stop.nameJa;
}

// 音声合成と日本語用の発話オブジェクトが両方利用できるブラウザーか確認します。
function supportsSpeechSynthesis() {
  return typeof window.speechSynthesis?.speak === "function"
    && typeof window.SpeechSynthesisUtterance === "function";
}

// 非対応環境ではボタンを無効にし、理由を読み上げ可能なステータス欄へ表示します。
function updateSpeechSupportStatus() {
  const isSupported = supportsSpeechSynthesis();
  speakAlightingButton.disabled = !isSupported;
  if (!isSupported) {
    speechStatus.textContent = text("speechNotSupported");
  }
}

// 選択中の降車停留所の日本語名を、利用者のクリックを受けて一度だけ読み上げます。
function readAlightingStop() {
  if (!supportsSpeechSynthesis()) {
    updateSpeechSupportStatus();
    return;
  }

  if (!currentGuide?.alightingStop?.nameJa) {
    speechStatus.textContent = text("speechStopUnavailable");
    return;
  }

  // 連続操作で発話が重ならないよう、前の読み上げを止めてから新しい発話を開始します。
  window.speechSynthesis.cancel();
  const utterance = new window.SpeechSynthesisUtterance(currentGuide.alightingStop.nameJa);
  utterance.lang = "ja-JP";
  utterance.rate = 0.9;
  utterance.onstart = () => {
    speechStatus.textContent = text("speechPlaying", {
      stopName: currentGuide.alightingStop.nameJa
    });
  };
  utterance.onend = () => {
    speechStatus.textContent = text("speechFinished", {
      stopName: currentGuide.alightingStop.nameJa
    });
  };
  utterance.onerror = (event) => {
    // 利用者の再操作や画面移動による停止は通常操作なので、再生エラーとして扱いません。
    if (event.error === "canceled" || event.error === "interrupted") {
      return;
    }

    speechStatus.textContent = text("speechError", {
      error: event.error || "unknown"
    });
  };
  window.speechSynthesis.speak(utterance);
}

// 目的地名だけでなく、その目的地に向かえる乗車停留所名も検索対象にします。
function destinationMatchesQuery(destination, query) {
  const destinationNames = `${destination.nameJa} ${destination.nameEn ?? ""}`.toLocaleLowerCase();
  if (destinationNames.includes(query)) {
    return true;
  }

  const { routeDestination } = getRouteDestination(destination);
  return routeDestination?.boardingStops.some((stop) =>
    `${stop.nameJa} ${stop.nameRomanized ?? ""} ${stop.nameEn ?? ""}`
      .toLocaleLowerCase()
      .includes(query)
  ) ?? false;
}

// 検索条件に合う目的地だけを、写真差し替え用の仮画像付きカードとして描画します。
function renderDestinations() {
  if (!busData) {
    return;
  }

  const query = destinationSearch.value.trim().toLocaleLowerCase();
  const destinations = busData.destinations.filter((destination) =>
    destinationMatchesQuery(destination, query)
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
      if (currentDestinationId !== destination.id) {
        currentBoardingStopId = "";
      }
      currentDestinationId = destination.id;
      currentGuide = null;
      renderDestinations();
      updateActionState();
    });

    const image = document.createElement("span");
    image.className = `destination-image destination-art--${destination.id}`;
    image.setAttribute("aria-hidden", "true");

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
    const photoNote = document.createElement("span");
    photoNote.className = "destination-photo-note";
    photoNote.textContent = text("photoComingSoon");
    content.append(japaneseName, englishName, selection);
    card.append(image, content, photoNote);
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

// 選択目的地の停留所候補を表示し、有効な選択があれば維持します。
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

    // 停留所の実写真を用意するまでは、写真予定を示すプレースホルダーを表示します。
    const thumbnail = document.createElement("span");
    thumbnail.className = "stop-thumbnail";
    thumbnail.setAttribute("aria-hidden", "true");
    const copy = document.createElement("span");
    copy.className = "stop-copy";
    const romanizedName = document.createElement("strong");
    romanizedName.textContent = `${stop.nameJa} (${getRomanizedStopName(stop)})`;
    const radio = document.createElement("span");
    radio.className = "radio-mark";
    radio.setAttribute("aria-hidden", "true");
    copy.append(romanizedName);
    option.append(thumbnail, copy, radio);
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

  const {
    destination,
    route,
    headsigns,
    headsignJa,
    boardingStop,
    alightingStop,
    estimatedRideMinutes
  } = currentGuide;
  // 停留所を切り替えたとき、前の停留所名に関する再生結果を残さないようにします。
  speechStatus.textContent = supportsSpeechSynthesis()
    ? ""
    : text("speechNotSupported");
  document.querySelector("#boarding-destination-name").textContent =
    currentLanguage === "en" ? destination.nameEn : destination.nameJa;
  const boardingArt = document.querySelector("#boarding-destination-art");
  boardingArt.className = `mini-art destination-art--${destination.id}`;
  boardingArt.textContent =
    destinationArt[destination.id] ?? "📍";
  document.querySelector("#route-number").textContent = route.routeShortName;
  document.querySelector("#bus-headsign").textContent = headsignJa;
  // 複数の適合する便が別の行き先表示を使う場合は、追加候補も一覧で確認できます。
  const additionalHeadsigns = document.querySelector("#additional-headsigns");
  additionalHeadsigns.replaceChildren();
  for (const headsign of headsigns.slice(1)) {
    const item = document.createElement("li");
    item.textContent = headsign.headsignJa;
    additionalHeadsigns.append(item);
  }
  additionalHeadsigns.hidden = headsigns.length <= 1;
  // 時刻表に所要時間がない場合は推測せず、未掲載であることを画面に明示します。
  const formattedRideMinutes = Number.isFinite(estimatedRideMinutes)
    ? text("approximateMinutes", { minutes: estimatedRideMinutes })
    : text("rideTimeUnavailable");
  document.querySelector("#arrival-estimate").textContent = formattedRideMinutes;
  // GTFS所要時間を加えた到着予定時刻を、日本時間で表示します。
  document.querySelector("#arrival-time").textContent = estimatedArrivalTime
    ? new Intl.DateTimeFormat(currentLanguage === "ja" ? "ja-JP" : "en-GB", {
      timeZone: "Asia/Tokyo",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    }).format(estimatedArrivalTime)
    : text("arrivalTimeUnavailable");
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
    const isBoardingStop = index === 0;
    const isAlightingStop = index === stops.length - 1;
    item.className = [
      "route-stop",
      isBoardingStop ? "is-boarding" : "",
      isAlightingStop ? "is-alighting" : ""
    ].filter(Boolean).join(" ");
    const marker = document.createElement("span");
    marker.className = "route-stop-marker";
    marker.setAttribute("aria-hidden", "true");
    const copy = document.createElement("span");
    copy.className = "route-stop-copy";
    const name = document.createElement("span");
    name.className = "route-stop-name";
    name.textContent = displayStopName(stop);
    copy.append(name);

    // 日本語表示には英語名、英語表示には日本語名を添えて停留所を見分けやすくします。
    const secondaryName = currentLanguage === "en"
      ? stop.nameJa
      : stop.nameEn || getRomanizedStopName(stop);
    if (secondaryName && secondaryName !== name.textContent) {
      const translation = document.createElement("span");
      translation.className = "route-stop-translation";
      translation.textContent = secondaryName;
      copy.append(translation);
    }

    if (isBoardingStop || isAlightingStop) {
      const status = document.createElement("strong");
      status.className = "route-stop-status";
      status.textContent = text(isBoardingStop ? "boardAt" : "getOffAt");
      copy.append(status);
    }

    item.append(marker, copy);
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
  const isWelcomeScreen = currentScreen === "welcome";
  page.classList.toggle("is-welcome", currentScreen === "welcome");
  page.classList.toggle("is-home", currentScreen === "home");
  page.classList.toggle("is-aboard", currentScreen === "aboard");
  page.classList.toggle("is-complete", currentScreen === "complete");
  homeBranding.hidden = !isWelcomeScreen;
  flowHeader.hidden = isWelcomeScreen;
  welcomeActionButton.hidden = currentScreen !== "welcome";
  homeActionButton.hidden = currentScreen !== "home";
  flowActionButton.hidden = isWelcomeScreen || currentScreen === "home";
  // 目的地画面ではホームアイコンを表示し、それ以降では前画面へ戻る矢印を表示します。
  backButton.textContent = currentScreen === "home" ? "⌂" : "‹";
  backButton.setAttribute(
    "aria-label",
    text(currentScreen === "home" ? "returnHome" : "goBack")
  );

  for (const screenName of screenNames) {
    document.querySelector(`#screen-${screenName}`).hidden = screenName !== currentScreen;
  }

  if (currentScreen === "home") {
    document.querySelector("#home-note").textContent =
      text(busData ? "homeReady" : "homeNote");
  }

  if (!isWelcomeScreen) {
    const step = stepByScreen[currentScreen];
    document.querySelector("#step-count").textContent = `${step}/5`;
    document.querySelectorAll("[data-progress-bar]").forEach((bar) => {
      bar.classList.toggle("is-complete", Number(bar.dataset.progressBar) <= step);
    });
    if (currentScreen !== "home") {
      flowActionLabel.textContent = text(actionLabels[currentScreen]);
    }
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
    "invalidStopOrder",
    "tripHeadsignMissing"
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

  // 降車画面を離れたら、読み上げが画面外で続かないよう音声キューを停止します。
  if (currentScreen === "aboard" && screenName !== "aboard" && supportsSpeechSynthesis()) {
    window.speechSynthesis.cancel();
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
    // 3/5画面を開いた時刻に、GTFSから算出した所要時間を加えて到着予定時刻を固定します。
    estimatedArrivalTime = getEstimatedArrivalTime(
      currentGuide.estimatedRideMinutes,
      new Date()
    );
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
  // 目的地選択画面のヘッダー操作は、最初の説明ホームへ戻します。
  if (currentScreen === "home") {
    setScreen("welcome");
    return;
  }

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
backButton.addEventListener("click", goBack);
busMatchCheckbox.addEventListener("change", updateActionState);
speakAlightingButton.addEventListener("click", readAlightingStop);

// アプリ起動時に、目的地と路線のデータを読み込みます。
initialize();
