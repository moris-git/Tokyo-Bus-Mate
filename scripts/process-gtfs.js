// 元のGTFSテキストを読み込み、ブラウザー向けの小さなJSONを作成します。
// GTFSの原本は変更せず、加工結果だけをdata/フォルダーへ保存します。
import { createReadStream } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import path from "node:path";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const gtfsDirectory = path.join(projectRoot, "ToeiBus-GTFS");
const destinationsPath = path.join(projectRoot, "data", "destinations.json");
const outputPath = path.join(projectRoot, "data", "bus-routes.json");

/**
 * CSVの1行を、カンマや引用符の扱いに注意して列に分割します。
 *
 * CSVでは、値が二重引用符で囲まれている場合、その中のカンマは
 * 列の区切りとして扱いません。また、二重引用符2個は値中の引用符1個を表します。
 *
 * @param {string} line CSVファイルから読み込んだ1行
 * @returns {string[]} 列ごとに分割した値
 */
function parseCsvLine(line) {
  const values = [];
  let value = "";
  let insideQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];

    if (character === '"') {
      if (insideQuotes && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (character === "," && !insideQuotes) {
      values.push(value);
      value = "";
    } else {
      value += character;
    }
  }

  values.push(value);
  return values;
}

/**
 * GTFSの小さめの表を読み込み、ヘッダー名をキーにしたオブジェクトへ変換します。
 *
 * stop_times.txtは100万行以上あるため、この関数では読み込まず、
 * 後続処理で1行ずつ読み取ります。
 *
 * @param {string} fileName GTFSフォルダー内のファイル名
 * @returns {Promise<object[]>} 各行をヘッダー名で参照できる配列
 */
async function readCsvTable(fileName) {
  const contents = await readFile(path.join(gtfsDirectory, fileName), "utf8");
  const lines = contents.replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);

  if (lines.length === 0) {
    throw new Error(`${fileName}が空です。`);
  }

  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });
}

/**
 * 指定日の運行サービスIDをcalendar.txtとcalendar_dates.txtから求めます。
 *
 * まず曜日・有効期間に基づくcalendar.txtの運行便を追加し、
 * その後calendar_dates.txtの運行追加・運休例外を反映します。
 * 例外は通常の曜日設定より優先されます。
 *
 * @param {object[]} calendar 曜日ごとの定期運行カレンダー
 * @param {object[]} calendarDates 特定日の運行追加・運休情報
 * @param {string} date YYYYMMDD形式の日付
 * @returns {Set<string>} 指定日に運行するサービスIDの集合
 */
function getActiveServicesOnDate(calendar, calendarDates, date) {
  const weekdayNames = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday"
  ];
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(4, 6)) - 1;
  const day = Number(date.slice(6, 8));
  const weekday = weekdayNames[new Date(Date.UTC(year, month, day)).getUTCDay()];
  const activeServices = new Set();

  for (const service of calendar) {
    if (service.start_date <= date && date <= service.end_date && service[weekday] === "1") {
      activeServices.add(service.service_id);
    }
  }

  for (const exception of calendarDates) {
    if (exception.date !== date) {
      continue;
    }

    if (exception.exception_type === "1") {
      activeServices.add(exception.service_id);
    } else if (exception.exception_type === "2") {
      activeServices.delete(exception.service_id);
    }
  }

  return activeServices;
}

/**
 * translations.txtから、指定したGTFS項目の英語表記を探します。
 *
 * 英語の意訳とローマ字表記は同じとは限らないため、降車停留所のローマ字は
 * destinations.jsonで個別に管理し、この関数では英語訳だけを取得します。
 *
 * @param {object[]} translations translations.txtの内容
 * @param {string} tableName 翻訳対象のテーブル名
 * @param {string} fieldName 翻訳対象の項目名
 * @param {string} recordId 翻訳対象レコードのID
 * @returns {string} 見つかった英語訳。なければ空文字列
 */
function findEnglishTranslation(translations, tableName, fieldName, recordId) {
  return translations.find((item) =>
    item.table_name === tableName
    && item.field_name === fieldName
    && item.record_id === recordId
    && item.language === "en"
  )?.translation ?? "";
}

async function main() {
  // 参照用GTFS表と手動登録した目的地対応表をまとめて読み込みます。
  // Promise.allを使い、互いに依存しないファイルを並行して取得します。
  const [
    destinationsData,
    routes,
    trips,
    stops,
    translations,
    calendar,
    calendarDates,
    feedInfo,
    agencies,
    fareRules,
    fareAttributes
  ] = await Promise.all([
    readFile(destinationsPath, "utf8").then(JSON.parse),
    readCsvTable("routes.txt"),
    readCsvTable("trips.txt"),
    readCsvTable("stops.txt"),
    readCsvTable("translations.txt"),
    readCsvTable("calendar.txt"),
    readCsvTable("calendar_dates.txt"),
    readCsvTable("feed_info.txt"),
    readCsvTable("agency.txt"),
    readCsvTable("fare_rules.txt"),
    readCsvTable("fare_attributes.txt")
  ]);

  const feed = feedInfo[0];
  if (!feed?.feed_start_date) {
    throw new Error("feed_info.txtにデータの開始日がありません。");
  }

  // 出力JSONにはデータ出典・有効期間も含め、後から版を追跡できるようにします。
  const output = {
    source: {
      publisher: feed.feed_publisher_name,
      publisherUrl: feed.feed_publisher_url,
      feedStartDate: feed.feed_start_date,
      feedEndDate: feed.feed_end_date,
      feedVersion: feed.feed_version
    },
    routes: []
  };

  // GTFSフィード開始日の運行カレンダーを計算し、確認結果として記録します。
  const activeServicesOnFeedStart = getActiveServicesOnDate(
    calendar,
    calendarDates,
    feed.feed_start_date
  );
  // 頻繁に検索する表をIDから参照できるMapにし、検索を簡単にします。
  const stopById = new Map(stops.map((stop) => [stop.stop_id, stop]));
  const routeById = new Map(routes.map((route) => [route.route_id, route]));
  const agencyById = new Map(agencies.map((agency) => [agency.agency_id, agency]));
  const tripById = new Map();
  const destinationByRoute = new Map();

  // 目的地の設定漏れがある場合は、曖昧なまま処理を続けず終了します。
  for (const destination of destinationsData.destinations ?? []) {
    if (!destination.routeId || !destination.alightingStopId
      || !Array.isArray(destination.boardingStopIds)
      || destination.boardingStopIds.length === 0) {
      throw new Error(`目的地「${destination.id}」に路線または停留所の設定がありません。`);
    }

    const routeDestinations = destinationByRoute.get(destination.routeId) ?? [];
    routeDestinations.push(destination);
    destinationByRoute.set(destination.routeId, routeDestinations);
  }

  for (const [routeId, routeDestinations] of destinationByRoute) {
    const route = routeById.get(routeId);
    if (!route) {
      throw new Error(`destinations.jsonの路線ID ${routeId} がroutes.txtにありません。`);
    }

    // 選択された路線に属する便だけを検索用Mapへ登録します。
    const routeTrips = trips.filter((trip) => trip.route_id === routeId);
    for (const trip of routeTrips) {
      tripById.set(trip.trip_id, trip);
    }

    const fareRule = fareRules.find((rule) => rule.route_id === routeId);
    const fare = fareRule
      ? fareAttributes.find((item) => item.fare_id === fareRule.fare_id)
      : undefined;
    if (!fare) {
      throw new Error(`路線ID ${routeId} に適用できるGTFS運賃がありません。`);
    }

    // 行き先表記はGTFSの全角・半角の違いをそろえて出力します。
    const routeOutput = {
      routeId,
      routeShortName: route.route_short_name.normalize("NFKC"),
      agencyName: agencyById.get(route.agency_id)?.agency_name ?? "",
      fare: {
        price: Number(fare.price),
        currency: fare.currency_type,
        icPrice: Number(fare.ic_price) >= 0 ? Number(fare.ic_price) : null
      },
      destinations: []
    };

    for (const destination of routeDestinations) {
      const alightingStop = stopById.get(destination.alightingStopId);
      if (!alightingStop || alightingStop.stop_name !== destination.alightingNameJa) {
        throw new Error(
          `降車停留所ID ${destination.alightingStopId} と設定された停留所名が一致しません。`
        );
      }

      // 目的地ごとに、検証対象となる乗車停留所と行き先表示を決めます。
      const boardingStopStats = new Map();
      const wantedBoardingStopIds = new Set(destination.boardingStopIds);
      const expectedHeadsign = destination.headsignJa;
      const compatibleTrips = new Map();

      // stop_times全件を配列にせず、対象系統・行き先表示の便だけを順番に読み込みます。
      // 各便の停留所順を保持し、乗車地点から降車地点までの区間を作ります。
      const stopTimesReader = createInterface({
        input: createReadStream(path.join(gtfsDirectory, "stop_times.txt"), { encoding: "utf8" }),
        crlfDelay: Infinity
      });

      let isHeader = true;
      let headers = [];
      for await (const line of stopTimesReader) {
        // 先頭行は列名なので、以降の各値と対応付けるために保存します。
        if (isHeader) {
          headers = parseCsvLine(line.replace(/^\uFEFF/, ""));
          isHeader = false;
          continue;
        }

        if (!line) {
          continue;
        }

        const values = parseCsvLine(line);
        const record = Object.fromEntries(
          headers.map((header, index) => [header, values[index] ?? ""])
        );
        const trip = tripById.get(record.trip_id);
        // 乗る方向の便だけを対象にし、便に含まれる全停留所を保持します。
        if (!trip || trip.trip_headsign !== expectedHeadsign) {
          continue;
        }

        const tripStops = compatibleTrips.get(record.trip_id) ?? [];
        tripStops.push({
          stopId: record.stop_id,
          stopSequence: Number(record.stop_sequence)
        });
        compatibleTrips.set(record.trip_id, tripStops);
      }

      for (const [tripId, tripStops] of compatibleTrips) {
        // 停車順に並べ、同じ便の中で乗車停留所と降車停留所を探します。
        tripStops.sort((first, second) => first.stopSequence - second.stopSequence);
        const stopSequenceById = new Map(tripStops.map((item) => [
          item.stopId,
          item.stopSequence
        ]));
        const alightingSequence = stopSequenceById.get(destination.alightingStopId);
        if (!Number.isFinite(alightingSequence)) {
          continue;
        }

        for (const boardingStopId of wantedBoardingStopIds) {
          const boardingSequence = stopSequenceById.get(boardingStopId);
          // 乗車位置が降車位置と同じか後なら、その便は案内候補にしません。
          if (!Number.isFinite(boardingSequence) || boardingSequence >= alightingSequence) {
            continue;
          }

          const stats = boardingStopStats.get(boardingStopId) ?? {
            orderedTripCount: 0,
            activeTripCount: 0,
            stopSequence: boardingSequence,
            alightingStopSequence: alightingSequence,
            itineraryStopIds: null,
            itineraryStops: null
          };

          // 乗車停留所から降車停留所までの順序どおりの経路を作ります。
          const itinerary = tripStops.filter((stop) =>
            stop.stopSequence >= boardingSequence
            && stop.stopSequence <= alightingSequence
          );
          const itineraryStopIds = itinerary.map((stop) => stop.stopId);
          if (stats.itineraryStopIds
            && (itineraryStopIds.length !== stats.itineraryStopIds.length
              || itineraryStopIds.some(
                (stopId, index) => stopId !== stats.itineraryStopIds[index]
              ))) {
            throw new Error(
              `乗車停留所ID ${boardingStopId} から降車停留所ID ${destination.alightingStopId} までに複数の経路があります。`
            );
          }

          if (!stats.itineraryStopIds) {
            stats.itineraryStopIds = itineraryStopIds;
            stats.itineraryStops = itinerary.map((stop) => {
              const stopData = stopById.get(stop.stopId);
              if (!stopData) {
                throw new Error(`GTFSの停留所ID ${stop.stopId} がstops.txtにありません。`);
              }

              return {
                stopId: stop.stopId,
                stopSequence: stop.stopSequence,
                nameJa: stopData.stop_name,
                nameEn: findEnglishTranslation(
                  translations,
                  "stops",
                  "stop_name",
                  stop.stopId
                )
              };
            });
          }

          stats.orderedTripCount += 1;
          // フィード開始日に運行予定かどうかも、通常のカレンダーと例外日で確認します。
          if (activeServicesOnFeedStart.has(tripById.get(tripId).service_id)) {
            stats.activeTripCount += 1;
          }
          boardingStopStats.set(boardingStopId, stats);
        }
      }

      // 設定された全乗車停留所について、同じ便で移動できることを確認します。
      const boardingStops = destination.boardingStopIds.map((stopId) => {
        const stop = stopById.get(stopId);
        const stats = boardingStopStats.get(stopId);
        if (!stop || !stats) {
          throw new Error(
            `乗車停留所ID ${stopId} から降車停留所ID ${destination.alightingStopId} までの便がありません。`
          );
        }

        return {
          stopId,
          nameJa: stop.stop_name,
          nameEn: findEnglishTranslation(translations, "stops", "stop_name", stopId),
          stopSequence: stats.stopSequence,
          alightingStopSequence: stats.alightingStopSequence,
          itineraryStops: stats.itineraryStops,
          orderedTripCount: stats.orderedTripCount,
          activeTripCountOnFeedStart: stats.activeTripCount
        };
      });

      const targetTrip = trips.find((trip) =>
        trip.route_id === routeId && trip.trip_headsign === expectedHeadsign
      );
      if (!targetTrip) {
        throw new Error(`行き先表示「${expectedHeadsign}」の便が見つかりません。`);
      }

      // ブラウザー側で表示する目的地と、停留所順序・カレンダーの検証結果をまとめます。
      routeOutput.destinations.push({
        destinationId: destination.id,
        alightingStopId: destination.alightingStopId,
        headsignJa: expectedHeadsign,
        headsignEn: findEnglishTranslation(
          translations,
          "trips",
          "trip_headsign",
          targetTrip.trip_id
        ),
        alightingStop: {
          nameJa: alightingStop.stop_name,
          nameEn: findEnglishTranslation(
            translations,
            "stops",
            "stop_name",
            alightingStop.stop_id
          ),
          nameRomanized: destination.alightingNameRomanized
        },
        boardingStops,
        verification: {
          feedStartDate: feed.feed_start_date,
          feedEndDate: feed.feed_end_date,
          feedVersion: feed.feed_version,
          activeServiceTripCount: boardingStops[0].activeTripCountOnFeedStart
        }
      });
    }

    routeOutput.destinations.forEach((destination) => {
      // 内部集計専用の運行便数を削除し、画面に必要な値だけを残します。
      for (const boardingStop of destination.boardingStops) {
        delete boardingStop.activeTripCountOnFeedStart;
      }
    });

    routeOutput.verification = {
      routeNameFromFeed: route.route_short_name,
      routeUrl: route.route_url,
      feedStartDate: feed.feed_start_date,
      feedEndDate: feed.feed_end_date,
      feedVersion: feed.feed_version
    };

    output.routes.push(routeOutput);
  }

  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(`${path.relative(projectRoot, outputPath)} をGTFSから作成しました。`);
  for (const route of output.routes) {
    for (const destination of route.destinations) {
      const stopSummary = destination.boardingStops
        .map((stop) => `${stop.nameJa}：停車順を確認した便 ${stop.orderedTripCount} 件`)
        .join("、");
      console.log(`${route.routeShortName}・${destination.alightingStop.nameJa}：${stopSummary}`);
    }
  }
}

main().catch((error) => {
  console.error(`GTFSデータの加工に失敗しました：${error.message}`);
  process.exitCode = 1;
});
