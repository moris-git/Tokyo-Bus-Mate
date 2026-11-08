import { isAlightingStopAfter } from "./routeUtils.js";

const DESTINATIONS_URL = "./data/destinations.json";
const ROUTES_URL = "./data/bus-routes.json";

/**
 * エラーの分類コードと詳細情報を持つErrorを作ります。
 * 画面側が選択中の言語に合わせて適切な説明文を表示できます。
 *
 * @param {string} code translations.jsに登録したエラー文のキー
 * @param {Record<string, string | number>} [details] エラー文に埋め込む値
 * @returns {Error} 分類コードと詳細情報を持つエラー
 */
function createServiceError(code, details = {}) {
  const error = new Error(code);
  error.code = code;
  error.details = details;
  return error;
}

/**
 * ブラウザーで使う、加工済みの小さなJSONファイルを読み込みます。
 *
 * 巨大な元GTFSを利用者の端末へダウンロードさせず、観光地対応表と
 * GTFS加工後の路線データだけを取得します。ファイル取得とJSON解析で
 * 失敗した場合は、呼び出し元にエラーを返して画面から知らせます。
 *
 * @returns {Promise<{destinations: Array<object>, routes: Array<object>}>}
 *          目的地対応表と路線情報
 */
export async function loadBusData() {
  const [destinationsResponse, routesResponse] = await Promise.all([
    fetch(DESTINATIONS_URL),
    fetch(ROUTES_URL)
  ]);

  if (!destinationsResponse.ok) {
    throw createServiceError("destinationLoadError", { status: destinationsResponse.status });
  }

  if (!routesResponse.ok) {
    throw createServiceError("routeDataLoadError", { status: routesResponse.status });
  }

  const [destinationsData, routesData] = await Promise.all([
    destinationsResponse.json(),
    routesResponse.json()
  ]);

  if (!Array.isArray(destinationsData.destinations) || !Array.isArray(routesData.routes)) {
    throw createServiceError("invalidDataFormat");
  }

  return {
    destinations: destinationsData.destinations,
    routes: routesData.routes
  };
}

/**
 * 目的地対応表と、GTFSから作られた路線データを結び付けます。
 *
 * 選択された目的地・路線・乗車停留所がデータに存在することを確かめ、
 * 乗車停留所の後に降車停留所がある場合だけ案内データを返します。
 * 条件に合わない場合は、誤った案内を作らず理由をエラーとして返します。
 *
 * @param {object} data loadBusData()が返す全データ
 * @param {string} destinationId 選択された観光地の識別子
 * @param {string} boardingStopId 選択された乗車停留所のGTFS ID
 * @returns {object} 画面表示に必要な路線・目的地・停留所・運賃情報
 */
export function getBusGuide(data, destinationId, boardingStopId) {
  const destination = data.destinations.find((item) => item.id === destinationId);
  if (!destination) {
    throw createServiceError("destinationMissing");
  }

  const route = data.routes.find((item) => item.routeId === destination.routeId);
  if (!route) {
    throw createServiceError("routeMissing", { routeId: destination.routeId });
  }

  const routeDestination = route.destinations.find(
    (item) => item.destinationId === destination.id
  );
  if (!routeDestination || routeDestination.alightingStopId !== destination.alightingStopId) {
    throw createServiceError("destinationNotVerified");
  }

  const boardingStop = routeDestination.boardingStops.find(
    (item) => item.stopId === boardingStopId
  );
  if (!boardingStop) {
    throw createServiceError("boardingStopNotVerified");
  }

  if (!isAlightingStopAfter(
    boardingStop.stopSequence,
    boardingStop.alightingStopSequence
  )) {
    throw createServiceError("invalidStopOrder");
  }

  return {
    route,
    destination,
    headsignJa: routeDestination.headsignJa,
    boardingStop,
    alightingStop: routeDestination.alightingStop,
    fare: route.fare
  };
}
