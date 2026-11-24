import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { isAlightingStopAfter } from "../js/routeUtils.js";
import { getBusGuide, getEstimatedArrivalTime } from "../js/busService.js";
import { getTranslation } from "../js/translations.js";

// 実際に画面が利用する加工済みデータを読み込み、データ更新時の不整合もテストします。
const [destinationsFile, routesFile, htmlFile] = await Promise.all([
  readFile(new URL("../data/destinations.json", import.meta.url), "utf8"),
  readFile(new URL("../data/bus-routes.json", import.meta.url), "utf8"),
  readFile(new URL("../index.html", import.meta.url), "utf8")
]);
const htmlTranslationKeys = [...htmlFile.matchAll(/data-i18n(?:-aria-label|-placeholder)?="([^"]+)"/g)]
  .map((match) => match[1]);
const generatedData = {
  destinations: JSON.parse(destinationsFile).destinations,
  routes: JSON.parse(routesFile).routes
};

const sampleData = {
  // 順序の異常などを独立して確認するための、最小限のテスト用データです。
  destinations: [{
    id: "ueno-zoo",
    nameEn: "Ueno Zoo",
    routeId: "070",
    alightingStopId: "0133-09"
  }],
  routes: [{
    routeId: "070",
    routeShortName: "上23",
    fare: { price: 210, currency: "JPY", icPrice: null },
    destinations: [{
      destinationId: "ueno-zoo",
      alightingStopId: "0133-09",
      alightingStop: { nameJa: "上野公園山下" },
      boardingStops: [{
        stopId: "0032-04",
        stopSequence: 21,
        alightingStopSequence: 28,
        headsigns: [{ headsignJa: "上野松坂屋前", tripCount: 114 }],
        estimatedRideMinutes: 11,
        scheduledTripCount: 114
      }]
    }]
  }]
};

test("降車停留所は乗車停留所より後の順序でなければならない", () => {
  assert.equal(isAlightingStopAfter(21, 28), true);
  assert.equal(isAlightingStopAfter(28, 21), false);
  assert.equal(isAlightingStopAfter(21, 21), false);
});

test("欠損値や数値以外の停車順序は無効と判定する", () => {
  assert.equal(isAlightingStopAfter(undefined, 28), false);
  assert.equal(isAlightingStopAfter(21, Number.NaN), false);
});

test("GTFS所要時間を現在時刻に加えて到着予定時刻を計算する", () => {
  const currentTime = new Date("2026-11-24T14:53:00+09:00");
  assert.equal(
    getEstimatedArrivalTime(11, currentTime)?.toISOString(),
    "2026-11-24T06:04:00.000Z"
  );
  assert.equal(getEstimatedArrivalTime(null, currentTime), null);
  assert.equal(getEstimatedArrivalTime(0, currentTime), null);
});

test("目的地と検証済み路線・停留所を結び付けて案内を作る", () => {
  const guide = getBusGuide(sampleData, "ueno-zoo", "0032-04");

  assert.equal(guide.route.routeShortName, "上23");
  assert.equal(guide.headsignJa, "上野松坂屋前");
  assert.equal(guide.boardingStop.stopId, "0032-04");
  assert.equal(guide.alightingStop.nameJa, "上野公園山下");
  assert.deepEqual(guide.headsigns, [{ headsignJa: "上野松坂屋前", tripCount: 114 }]);
  assert.equal(guide.estimatedRideMinutes, 11);
  assert.equal(guide.fare.price, 210);
});

test("降車停留所より後の乗車停留所は案内対象外にする", () => {
  const dataWithInvalidOrder = structuredClone(sampleData);
  dataWithInvalidOrder.routes[0].destinations[0].boardingStops[0].alightingStopSequence = 20;

  assert.throws(
    () => getBusGuide(dataWithInvalidOrder, "ueno-zoo", "0032-04"),
    (error) => error.code === "invalidStopOrder"
  );
});

// 複数の適合便がある場合に、便数の多い行き先表示を先頭候補として使います。
test("乗降順を満たす便の行き先表示を便数順に案内する", () => {
  const dataWithMultipleHeadsigns = structuredClone(sampleData);
  dataWithMultipleHeadsigns.routes[0].destinations[0].boardingStops[0].headsigns = [
    { headsignJa: "別の行き先", tripCount: 2 },
    { headsignJa: "上野松坂屋前", tripCount: 10 }
  ];

  const guide = getBusGuide(dataWithMultipleHeadsigns, "ueno-zoo", "0032-04");
  assert.equal(guide.headsignJa, "上野松坂屋前");
  assert.deepEqual(guide.headsigns.map((item) => item.headsignJa), [
    "上野松坂屋前",
    "別の行き先"
  ]);
});

// 適合便の行き先表示が欠けたデータでは、行き先を推測せずエラーにします。
test("適合便の行き先表示がなければ理由を付けて失敗する", () => {
  const dataWithoutHeadsign = structuredClone(sampleData);
  dataWithoutHeadsign.routes[0].destinations[0].boardingStops[0].headsigns = [];

  assert.throws(
    () => getBusGuide(dataWithoutHeadsign, "ueno-zoo", "0032-04"),
    (error) => error.code === "tripHeadsignMissing"
  );
});

test("生成したGTFSデータで設定済みの全目的地と乗車停留所から案内できる", () => {
  assert.equal(generatedData.destinations.length, 4);

  for (const destination of generatedData.destinations) {
    const route = generatedData.routes.find((item) => item.routeId === destination.routeId);
    const routeDestination = route?.destinations.find(
      (item) => item.destinationId === destination.id
    );

    assert.ok(route, `${destination.nameJa}の路線データが必要です`);
    assert.ok(routeDestination, `${destination.nameJa}のGTFS検証結果が必要です`);
    assert.equal(route.routeShortName, "上23");
    assert.equal(routeDestination.alightingStopId, destination.alightingStopId);
    assert.ok(routeDestination.verification.activeServiceTripCount > 0);
    assert.deepEqual(
      routeDestination.boardingStops.map((stop) => stop.stopId),
      destination.boardingStopIds
    );

    for (const stop of routeDestination.boardingStops) {
      assert.ok(stop.orderedTripCount > 0);
      assert.ok(stop.headsigns.length > 0);
      assert.equal(guideForStop(destination, stop.stopId).headsignJa, stop.headsigns[0].headsignJa);
      assert.ok(Number.isInteger(stop.estimatedRideMinutes));
      assert.ok(stop.estimatedRideMinutes > 0);
      assert.ok(stop.scheduledTripCount > 0);
      assert.equal(stop.itineraryStops[0].stopId, stop.stopId);
      assert.equal(
        stop.itineraryStops.at(-1).stopId,
        destination.alightingStopId
      );
      assert.ok(stop.itineraryStops.length >= 2);
      assert.ok(stop.itineraryStops.every(
        (itineraryStop, index, itinerary) =>
          index === 0 || itinerary[index - 1].stopSequence < itineraryStop.stopSequence
      ));
      assert.doesNotThrow(() => getBusGuide(generatedData, destination.id, stop.stopId));
    }
  }
});

// 目的地を通る便の表示と時刻表上の所要時間が生成データから取得できることを確認します。
function guideForStop(destination, stopId) {
  return getBusGuide(generatedData, destination.id, stopId);
}

test("画面文言を日本語と英語で取得できる", () => {
  assert.equal(getTranslation("ja", "welcomeHeading"), "はじめてでも、バスの乗り方がわかる。");
  assert.equal(getTranslation("en", "welcomeHeading"), "Ride the bus with confidence.");
  assert.equal(getTranslation("ja", "guideHeading"), "バスを見つける");
  assert.equal(getTranslation("en", "guideHeading"), "Find Your Bus");
  assert.equal(getTranslation("ja", "arrivalTimeLabel"), "到着予定時刻");
  assert.equal(getTranslation("en", "arrivalTimeLabel"), "Estimated arrival time");
  assert.equal(getTranslation("ja", "speakAlightingStop"), "停留所名を音声で聞く");
  assert.equal(
    getTranslation("ja", "speechStopUnavailable"),
    "読み上げる降車停留所が選択されていません。"
  );
  assert.equal(
    getTranslation("ja", "speechPlaying", { stopName: "上野公園山下" }),
    "「上野公園山下」を読み上げています。"
  );
  assert.equal(
    getTranslation("en", "speechError", { error: "audio-busy" }),
    "Could not play speech (audio-busy). Check your browser's audio settings."
  );
  assert.equal(
    getTranslation("ja", "routeMissing", { routeId: "070" }),
    "系統 070 のデータがありません。"
  );
  assert.equal(
    getTranslation("en", "routeMissing", { routeId: "070" }),
    "Route 070 is not available."
  );
  assert.equal(
    getTranslation("en", "icFare", { fare: "210" }),
    "IC card fare: JPY 210 (from GTFS)"
  );
});

test("HTMLで使うすべての翻訳キーが日本語と英語に登録されている", () => {
  for (const language of ["ja", "en"]) {
    for (const key of htmlTranslationKeys) {
      assert.doesNotThrow(() => getTranslation(language, key));
    }
  }
});

test("説明用ホームと5段階の案内画面はHTMLに定義する", () => {
  for (const screenName of ["welcome", "home", "boarding", "check", "aboard", "complete"]) {
    assert.ok(
      htmlFile.includes(`id="screen-${screenName}"`),
      `${screenName}画面のテンプレートが必要です`
    );
  }
  assert.match(htmlFile, /id="flow-progress"/);
  assert.match(htmlFile, /id="additional-headsigns"/);
  const arrivalTimeIndex = htmlFile.indexOf('id="arrival-time"');
  const checkScreenIndex = htmlFile.indexOf('id="screen-check"');
  const aboardScreenIndex = htmlFile.indexOf('id="screen-aboard"');
  const aboardArrivalTimeIndex = htmlFile.indexOf('id="aboard-arrival-time"');
  const completeScreenIndex = htmlFile.indexOf('id="screen-complete"');
  const routeStopListIndex = htmlFile.indexOf('id="route-stop-list"');
  assert.ok(arrivalTimeIndex > checkScreenIndex && arrivalTimeIndex < aboardScreenIndex);
  assert.ok(aboardArrivalTimeIndex > aboardScreenIndex && aboardArrivalTimeIndex < completeScreenIndex);
  assert.ok(routeStopListIndex > checkScreenIndex && routeStopListIndex < aboardScreenIndex);
  assert.doesNotMatch(htmlFile, /<details class="route-details"|class="trip-endpoints"/);
  assert.doesNotMatch(htmlFile, /id="check-ride-minutes"/);
  assert.match(htmlFile, /id="speak-alighting-button"/);
  assert.match(htmlFile, /id="speech-status"[^>]*aria-live="polite"/);
  assert.match(htmlFile, /id="destination-list"/);
  assert.match(htmlFile, /id="bus-match-checkbox"/);
  assert.match(htmlFile, /id="welcome-action-button"/);
  assert.match(htmlFile, /class="welcome-steps"/);
  assert.doesNotMatch(htmlFile, /class="bus-illustration"/);
});
