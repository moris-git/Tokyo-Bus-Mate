import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { isAlightingStopAfter } from "../js/routeUtils.js";
import { getBusGuide } from "../js/busService.js";
import { getTranslation } from "../js/translations.js";

// 実際に画面が利用する加工済みデータを読み込み、データ更新時の不整合もテストします。
const [destinationsFile, routesFile, htmlFile] = await Promise.all([
  readFile(new URL("../data/destinations.json", import.meta.url), "utf8"),
  readFile(new URL("../data/bus-routes.json", import.meta.url), "utf8"),
  readFile(new URL("../index.html", import.meta.url), "utf8")
]);
const htmlTranslationKeys = [...htmlFile.matchAll(/data-i18n(?:-aria-label)?="([^"]+)"/g)]
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
      headsignJa: "上野松坂屋前",
      alightingStop: { nameJa: "上野公園山下" },
      boardingStops: [{
        stopId: "0032-04",
        stopSequence: 21,
        alightingStopSequence: 28
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

test("目的地と検証済み路線・停留所を結び付けて案内を作る", () => {
  const guide = getBusGuide(sampleData, "ueno-zoo", "0032-04");

  assert.equal(guide.route.routeShortName, "上23");
  assert.equal(guide.headsignJa, "上野松坂屋前");
  assert.equal(guide.boardingStop.stopId, "0032-04");
  assert.equal(guide.alightingStop.nameJa, "上野公園山下");
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

test("画面文言を日本語と英語で取得できる", () => {
  assert.equal(getTranslation("ja", "guideHeading"), "乗るバスを確認");
  assert.equal(getTranslation("en", "guideHeading"), "Check your bus");
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
