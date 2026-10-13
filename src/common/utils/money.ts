/**
 * Vietnamese number and money text for notifications, insights and payroll
 * lines. Built by hand instead of Intl / toLocaleString so the output does
 * not depend on the ICU data of the host Node build.
 */

/**
 * Số theo kiểu Việt Nam: "." ngăn hàng nghìn, "," thập phân, bỏ số 0 thừa ở
 * phần thập phân. Vd. formatVnNumber(1234.5, 2) → "1.234,5".
 */
export function formatVnNumber(value: number, decimals: number): string {
  const factor = 10 ** decimals;
  const rounded = Math.round(value * factor) / factor;
  const negative = rounded < 0;
  const [intPart, fracPart] = Math.abs(rounded).toFixed(decimals).split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const frac = fracPart ? fracPart.replace(/0+$/, '') : '';
  return `${negative ? '-' : ''}${grouped}${frac ? `,${frac}` : ''}`;
}

/**
 * The same digits `toLocaleString('vi-VN')` gives a money amount (up to three
 * decimals, as Intl does by default), with a unit glued on:
 * formatVnMoney(1500000) → "1.500.000đ", formatVnMoney(-200, ' VNĐ') → "-200 VNĐ".
 */
export function formatVnMoney(amount: number, unit = 'đ'): string {
  return `${formatVnNumber(amount, 3)}${unit}`;
}
