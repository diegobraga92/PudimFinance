/**
 * Category icon catalog smoke test.
 * Run with: npx tsx --tsconfig=tsconfig.app.json scripts/category-icons-smoke.ts
 */
import {
  CATEGORY_ICON_GROUPS,
  CATEGORY_ICON_NAMES,
  CATEGORY_ICON_OPTIONS,
  DEFAULT_CATEGORY_ICON,
  isCategoryIconName,
  suggestCategoryIcon,
} from '@shared/category-icons';
import { en } from '@shared/i18n/en';
import { CATEGORY_ICON_COMPONENTS } from '../src/components/CategoryIcon';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
  }
  console.log(`PASS: ${message}`);
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  assert(
    actual === expected,
    `${message} (expected ${String(expected)}, got ${String(actual)})`,
  );
}

// Catalog integrity.
assert(CATEGORY_ICON_NAMES.length > 0, 'catalog is not empty');
assertEqual(
  new Set(CATEGORY_ICON_NAMES).size,
  CATEGORY_ICON_NAMES.length,
  'icon identifiers are unique',
);
assertEqual(
  CATEGORY_ICON_OPTIONS.length,
  CATEGORY_ICON_NAMES.length,
  'flat options match the name list',
);

const enKeys = new Set(Object.keys(en));
let missingComponent = 0;
let missingLabel = 0;
for (const group of CATEGORY_ICON_GROUPS) {
  if (!enKeys.has(group.labelKey)) {
    missingLabel += 1;
    console.error(`  missing group label: ${group.labelKey}`);
  }
  for (const option of group.options) {
    if (!CATEGORY_ICON_COMPONENTS[option.name]) {
      missingComponent += 1;
      console.error(`  missing Lucide component: ${option.name}`);
    }
    if (!enKeys.has(option.labelKey)) {
      missingLabel += 1;
      console.error(`  missing icon label: ${option.labelKey}`);
    }
    if (option.group !== group.key) {
      console.error(`  wrong group for ${option.name}: ${option.group} != ${group.key}`);
      process.exit(1);
    }
  }
}
assertEqual(missingComponent, 0, 'every icon has a Lucide component');
assertEqual(missingLabel, 0, 'every icon and group has an English label');

// Runtime validation helper.
assert(
  CATEGORY_ICON_NAMES.every((name) => isCategoryIconName(name)),
  'isCategoryIconName accepts every catalog id',
);
assert(!isCategoryIconName('definitely-not-an-icon'), 'isCategoryIconName rejects unknown ids');
assert(!isCategoryIconName(null), 'isCategoryIconName rejects null');

// Defaults.
assert(isCategoryIconName(DEFAULT_CATEGORY_ICON.income), 'income default is a known icon');
assert(isCategoryIconName(DEFAULT_CATEGORY_ICON.expense), 'expense default is a known icon');

// Name-based suggestions (accent-insensitive, English and Portuguese).
assertEqual(suggestCategoryIcon('Netflix'), 'film', 'suggests film for Netflix');
assertEqual(suggestCategoryIcon('Uber'), 'navigation', 'suggests navigation for Uber');
assertEqual(suggestCategoryIcon('Farmácia'), 'pill', 'suggests pill for Farmácia');
assertEqual(
  suggestCategoryIcon('Consulta médica'),
  'stethoscope',
  'suggests stethoscope for a doctor visit',
);
assertEqual(suggestCategoryIcon('Mercado'), 'shopping-cart', 'suggests shopping-cart for Mercado');
assertEqual(suggestCategoryIcon('Academia'), 'dumbbell', 'suggests dumbbell for Academia');
assertEqual(suggestCategoryIcon('Aluguel'), 'home', 'suggests home for Aluguel');
assertEqual(suggestCategoryIcon('zzzz'), null, 'returns null when nothing matches');
assertEqual(suggestCategoryIcon(''), null, 'returns null for empty input');

console.log(
  `\nCategory icon catalog OK: ${CATEGORY_ICON_NAMES.length} icons in ${CATEGORY_ICON_GROUPS.length} groups.`,
);
