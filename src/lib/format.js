const fmt = new Intl.NumberFormat("ko-KR");

export function fmtWon(value) {
  return `${fmt.format(Math.round(Number(value) || 0))}원`;
}

export function fmtCount(value) {
  return `${fmt.format(Math.round(Number(value) || 0))}건`;
}

export function fmtNum(value) {
  return fmt.format(Math.round(Number(value) || 0));
}
