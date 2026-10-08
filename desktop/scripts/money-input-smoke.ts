/**
 * Money-input locale smoke test.
 * Run with: npx tsx --tsconfig=tsconfig.app.json scripts/money-input-smoke.ts
 */
import {
  decimalSeparator,
  moneyPlaceholder,
  toAmountInput,
} from '../src/lib/money-input';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
  }
  console.log(`PASS: ${message}`);
}

assert(decimalSeparator('pt-BR') === ',', 'pt-BR uses a comma as the decimal separator');
assert(decimalSeparator('en-US') === '.', 'en-US uses a dot as the decimal separator');

assert(moneyPlaceholder('pt-BR') === '0,00', 'pt-BR placeholder is 0,00');
assert(moneyPlaceholder('en-US') === '0.00', 'en-US placeholder is 0.00');
assert(moneyPlaceholder('pt-BR', '500') === '500,00', 'pt-BR placeholder accepts a sample');
assert(moneyPlaceholder('en-US', '500') === '500.00', 'en-US placeholder accepts a sample');
assert(moneyPlaceholder('pt-BR', 1000) === '1000,00', 'pt-BR placeholder accepts a number');

assert(toAmountInput('1234.56', 'pt-BR') === '1234,56', 'pt-BR renders a wire decimal with a comma');
assert(toAmountInput('1234.56', 'en-US') === '1234.56', 'en-US keeps the dot decimal');
assert(toAmountInput('0.00', 'pt-BR') === '0,00', 'pt-BR renders zero');
assert(toAmountInput('', 'pt-BR') === '', 'empty input stays empty');
assert(toAmountInput('  45.9  ', 'pt-BR') === '45,9', 'whitespace is trimmed');

// Round-trips through the submit normalization the forms already apply.
const typed = toAmountInput('150.00', 'pt-BR');
assert(Number.parseFloat(typed.replace(',', '.')) === 150, 'a pt-BR value normalizes back to the wire format');

console.log('All money-input checks passed.');
