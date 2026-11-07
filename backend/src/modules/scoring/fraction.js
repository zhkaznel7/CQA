// Exact nonnegative rational arithmetic. No intermediate binary-float rounding.
function gcd(a, b) {
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

export function fraction(numerator, denominator = 1n) {
  if (numerator < 0n || denominator <= 0n) throw new RangeError('Invalid nonnegative fraction');
  const divisor = gcd(numerator, denominator);
  return { numerator: numerator / divisor, denominator: denominator / divisor };
}

export function add(a, b) {
  return fraction(a.numerator * b.denominator + b.numerator * a.denominator, a.denominator * b.denominator);
}

export function multiply(a, b) {
  return fraction(a.numerator * b.numerator, a.denominator * b.denominator);
}

export function asNumber(value) {
  // Reduced denominators can grow when adding many distinct scale fractions.
  // Convert the bounded quotient, never the potentially huge numerator/denominator.
  const whole = value.numerator / value.denominator;
  const decimal = ((value.numerator % value.denominator) * 10n ** 20n / value.denominator)
    .toString().padStart(20, '0');
  return Number(`${whole}.${decimal}`);
}

export function roundTwo(value) {
  // Positive half-up rounding: exactly 88.125 -> 88.13.
  return Number((value.numerator * 200n + value.denominator) / (value.denominator * 2n)) / 100;
}
