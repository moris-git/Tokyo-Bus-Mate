// 停留所の順序を判定する共通処理です。
// 画面処理から分離することで、路線ルールを個別にテスト・再利用できます。

/**
 * 降車停留所が乗車停留所より後にあるかを判定します。
 *
 * GTFSのstop_sequenceは数値です。欠損値や文字列などの不正値はfalseとし、
 * 誤った順序の経路を有効と判定しないようにします。
 *
 * @param {number} boardingSequence 乗車停留所のstop_sequence
 * @param {number} alightingSequence 降車停留所のstop_sequence
 * @returns {boolean} 降車順が後ならtrue、それ以外ならfalse
 */
export function isAlightingStopAfter(boardingSequence, alightingSequence) {
  return Number.isFinite(boardingSequence)
    && Number.isFinite(alightingSequence)
    && alightingSequence > boardingSequence;
}
