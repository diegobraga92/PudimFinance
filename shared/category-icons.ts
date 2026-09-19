/** Shared category icon catalog. */
import type { TranslationKey } from './i18n';

/** Coarse buckets used to organise the category icon picker. */
export type CategoryIconGroup =
  | 'food'
  | 'shopping'
  | 'home'
  | 'transport'
  | 'health'
  | 'work'
  | 'education'
  | 'leisure'
  | 'family'
  | 'finance'
  | 'other';

/** A single selectable category icon. */
export interface CategoryIconOption {
  /** Stable identifier persisted as `categories.icon`. */
  name: string;
  group: CategoryIconGroup;
  /** Translation key holding the human-readable icon name. */
  labelKey: TranslationKey;
  /** Extra English/Portuguese search terms matched by the picker. */
  aliases?: readonly string[];
}

/** Picker sections, in display order. */
export const CATEGORY_ICON_GROUPS: readonly {
  key: CategoryIconGroup;
  labelKey: TranslationKey;
  options: readonly CategoryIconOption[];
}[] = [
  {
    key: 'food',
    labelKey: 'categories.icon.group.food',
    options: [
      { name: 'utensils', group: 'food', labelKey: 'categories.icon.utensils', aliases: ['meal', 'meals', 'restaurant', 'dining', 'lunch', 'dinner', 'breakfast', 'food', 'refeicao', 'refeicoes', 'comida', 'almoco', 'jantar', 'restaurante'] },
      { name: 'utensils-crossed', group: 'food', labelKey: 'categories.icon.utensilsCrossed', aliases: ['dining out', 'eating out', 'restaurant', 'delivery', 'takeout', 'ifood', 'comida fora', 'restaurante', 'entrega'] },
      { name: 'coffee', group: 'food', labelKey: 'categories.icon.coffee', aliases: ['coffee', 'cafe', 'cafeteria', 'cafes', 'coffee shop', 'starbucks'] },
      { name: 'pizza', group: 'food', labelKey: 'categories.icon.pizza', aliases: ['pizza', 'pizzaria'] },
      { name: 'sandwich', group: 'food', labelKey: 'categories.icon.sandwich', aliases: ['sandwich', 'fast food', 'burger', 'hamburger', 'lanche', 'lanchonete', 'hamburguer'] },
      { name: 'salad', group: 'food', labelKey: 'categories.icon.salad', aliases: ['salad', 'healthy', 'vegetarian', 'vegan', 'salada', 'saudavel', 'vegetariano', 'vegano'] },
      { name: 'soup', group: 'food', labelKey: 'categories.icon.soup', aliases: ['soup', 'broth', 'sopa', 'caldo'] },
      { name: 'ice-cream', group: 'food', labelKey: 'categories.icon.iceCream', aliases: ['ice cream', 'dessert', 'sorvete', 'gelato', 'sobremesa'] },
      { name: 'cake', group: 'food', labelKey: 'categories.icon.cake', aliases: ['bakery', 'cake', 'bread', 'padaria', 'bolo', 'pao', 'confeitaria'] },
      { name: 'croissant', group: 'food', labelKey: 'categories.icon.croissant', aliases: ['breakfast', 'brunch', 'croissant', 'cafe da manha', 'padaria'] },
      { name: 'wine', group: 'food', labelKey: 'categories.icon.wine', aliases: ['wine', 'drink', 'drinks', 'bar', 'vinho', 'bebida', 'bebidas', 'adega'] },
      { name: 'beer', group: 'food', labelKey: 'categories.icon.beer', aliases: ['beer', 'pub', 'cerveja', 'chopp', 'bar'] },
      { name: 'fish', group: 'food', labelKey: 'categories.icon.fish', aliases: ['fish', 'seafood', 'peixe', 'frutos do mar', 'pescado'] },
      { name: 'beef', group: 'food', labelKey: 'categories.icon.beef', aliases: ['meat', 'beef', 'steak', 'carne', 'acougue', 'churrasco'] },
      { name: 'carrot', group: 'food', labelKey: 'categories.icon.carrot', aliases: ['vegetables', 'produce', 'greengrocer', 'legumes', 'verduras', 'hortifruti', 'feira'] },
      { name: 'apple', group: 'food', labelKey: 'categories.icon.apple', aliases: ['fruit', 'fruits', 'fruta', 'frutas', 'hortifruti'] },
    ],
  },
  {
    key: 'shopping',
    labelKey: 'categories.icon.group.shopping',
    options: [
      { name: 'shopping-cart', group: 'shopping', labelKey: 'categories.icon.shoppingCart', aliases: ['groceries', 'grocery', 'supermarket', 'market', 'supermercado', 'mercado', 'compras', 'alimentacao'] },
      { name: 'shopping-bag', group: 'shopping', labelKey: 'categories.icon.shoppingBag', aliases: ['shopping', 'shop', 'retail', 'compras', 'loja', 'varejo'] },
      { name: 'store', group: 'shopping', labelKey: 'categories.icon.store', aliases: ['store', 'shop', 'loja', 'comercio', 'varejo'] },
      { name: 'package', group: 'shopping', labelKey: 'categories.icon.package', aliases: ['delivery', 'package', 'parcel', 'encomenda', 'entrega', 'correios', 'frete', 'marketplace'] },
      { name: 'shirt', group: 'shopping', labelKey: 'categories.icon.shirt', aliases: ['clothing', 'clothes', 'fashion', 'vestuario', 'roupa', 'roupas', 'calcado', 'moda'] },
      { name: 'gift', group: 'shopping', labelKey: 'categories.icon.gift', aliases: ['gift', 'gifts', 'present', 'presents', 'presente', 'presentes', 'doacao'] },
    ],
  },
  {
    key: 'home',
    labelKey: 'categories.icon.group.home',
    options: [
      { name: 'home', group: 'home', labelKey: 'categories.icon.home', aliases: ['home', 'housing', 'rent', 'mortgage', 'moradia', 'aluguel', 'casa', 'condominio', 'financiamento'] },
      { name: 'zap', group: 'home', labelKey: 'categories.icon.zap', aliases: ['electricity', 'power', 'energy', 'luz', 'energia', 'eletricidade'] },
      { name: 'droplet', group: 'home', labelKey: 'categories.icon.droplet', aliases: ['water', 'agua', 'saneamento'] },
      { name: 'flame', group: 'home', labelKey: 'categories.icon.flame', aliases: ['gas', 'gas bottle', 'gas', 'botijao', 'combustivel'] },
      { name: 'wifi', group: 'home', labelKey: 'categories.icon.wifi', aliases: ['internet', 'wifi', 'broadband', 'banda larga', 'provedor'] },
      { name: 'phone', group: 'home', labelKey: 'categories.icon.phone', aliases: ['phone', 'telephone', 'mobile', 'celular', 'telefone', 'plano'] },
      { name: 'lightbulb', group: 'home', labelKey: 'categories.icon.lightbulb', aliases: ['utilities', 'utility', 'utilidades', 'contas'] },
      { name: 'sofa', group: 'home', labelKey: 'categories.icon.sofa', aliases: ['furniture', 'sofa', 'moveis', 'decoracao'] },
      { name: 'bed', group: 'home', labelKey: 'categories.icon.bed', aliases: ['rent', 'lease', 'hotel', 'aluguel', 'hospedagem'] },
      { name: 'wrench', group: 'home', labelKey: 'categories.icon.wrench', aliases: ['maintenance', 'repair', 'manutencao', 'conserto', 'reforma'] },
      { name: 'hammer', group: 'home', labelKey: 'categories.icon.hammer', aliases: ['repairs', 'repair', 'fix', 'reparos', 'conserto', 'obra'] },
      { name: 'hard-hat', group: 'home', labelKey: 'categories.icon.hardHat', aliases: ['contractor', 'contractors', 'construction', 'renovation', 'obra', 'obras', 'construcao', 'reforma', 'pedreiro', 'empreiteiro'] },
      { name: 'drill', group: 'home', labelKey: 'categories.icon.drill', aliases: ['tools', 'tool', 'ferramentas', 'ferramenta', 'oficina'] },
      { name: 'ruler', group: 'home', labelKey: 'categories.icon.ruler', aliases: ['home improvement', 'renovation', 'diy', 'reforma', 'projeto', 'medicao'] },
      { name: 'paintbrush', group: 'home', labelKey: 'categories.icon.paintbrush', aliases: ['painting', 'paint', 'pintura', 'tinta', 'pintor'] },
      { name: 'key-round', group: 'home', labelKey: 'categories.icon.keyRound', aliases: ['keys', 'key', 'chaves', 'chave', 'imovel', 'aluguel'] },
      { name: 'trash-2', group: 'home', labelKey: 'categories.icon.trash2', aliases: ['waste', 'trash', 'garbage', 'lixo', 'coleta'] },
      { name: 'washing-machine', group: 'home', labelKey: 'categories.icon.washingMachine', aliases: ['laundry', 'lavanderia', 'lavagem', 'roupa'] },
      { name: 'refrigerator', group: 'home', labelKey: 'categories.icon.refrigerator', aliases: ['appliances', 'appliance', 'eletrodomesticos', 'eletrodomestico', 'geladeira'] },
    ],
  },
  {
    key: 'transport',
    labelKey: 'categories.icon.group.transport',
    options: [
      { name: 'car', group: 'transport', labelKey: 'categories.icon.car', aliases: ['car', 'auto', 'vehicle', 'carro', 'automovel', 'veiculo'] },
      { name: 'bus', group: 'transport', labelKey: 'categories.icon.bus', aliases: ['bus', 'transit', 'onibus', 'transporte publico', 'passagem'] },
      { name: 'train-front', group: 'transport', labelKey: 'categories.icon.trainFront', aliases: ['metro', 'train', 'subway', 'trem', 'metro', 'ferroviario'] },
      { name: 'bike', group: 'transport', labelKey: 'categories.icon.bike', aliases: ['bike', 'bicycle', 'bicicleta', 'ciclismo'] },
      { name: 'fuel', group: 'transport', labelKey: 'categories.icon.fuel', aliases: ['fuel', 'gas station', 'gasoline', 'combustivel', 'gasolina', 'etanol', 'posto'] },
      { name: 'truck', group: 'transport', labelKey: 'categories.icon.truck', aliases: ['freight', 'truck', 'cargo', 'frete', 'caminhao', 'logistica'] },
      { name: 'plane', group: 'transport', labelKey: 'categories.icon.plane', aliases: ['travel', 'trip', 'flight', 'viagem', 'voo', 'passagem', 'aviao'] },
      { name: 'sailboat', group: 'transport', labelKey: 'categories.icon.sailboat', aliases: ['boat', 'ferry', 'cruise', 'barco', 'balsa', 'navio'] },
      { name: 'map-pin', group: 'transport', labelKey: 'categories.icon.mapPin', aliases: ['places', 'location', 'address', 'locais', 'local', 'endereco', 'mapa'] },
      { name: 'navigation', group: 'transport', labelKey: 'categories.icon.navigation', aliases: ['rideshare', 'ride', 'taxi', 'uber', 'corrida', 'corridas', 'aplicativo'] },
    ],
  },
  {
    key: 'health',
    labelKey: 'categories.icon.group.health',
    options: [
      { name: 'heart', group: 'health', labelKey: 'categories.icon.heart', aliases: ['healthcare', 'health', 'saude', 'plano de saude', 'medico'] },
      { name: 'stethoscope', group: 'health', labelKey: 'categories.icon.stethoscope', aliases: ['doctor', 'physician', 'appointment', 'appointments', 'consultation', 'medico', 'consulta', 'consultas', 'doutor'] },
      { name: 'pill', group: 'health', labelKey: 'categories.icon.pill', aliases: ['medicine', 'medication', 'pharmacy', 'drug', 'remedio', 'remedios', 'farmacia', 'medicamento'] },
      { name: 'syringe', group: 'health', labelKey: 'categories.icon.syringe', aliases: ['vaccine', 'vaccination', 'shot', 'vacina', 'vacinas', 'injecao'] },
      { name: 'thermometer', group: 'health', labelKey: 'categories.icon.thermometer', aliases: ['symptoms', 'fever', 'illness', 'sintomas', 'febre', 'doenca'] },
      { name: 'activity', group: 'health', labelKey: 'categories.icon.activity', aliases: ['exams', 'tests', 'checkup', 'exames', 'exame', 'laboratorio'] },
      { name: 'brain', group: 'health', labelKey: 'categories.icon.brain', aliases: ['mental health', 'therapy', 'psychology', 'saude mental', 'terapia', 'psicologo', 'psicologia'] },
      { name: 'bone', group: 'health', labelKey: 'categories.icon.bone', aliases: ['orthopedics', 'bone', 'ortopedia', 'osso', 'fisioterapia'] },
      { name: 'eye', group: 'health', labelKey: 'categories.icon.eye', aliases: ['vision', 'eye', 'glasses', 'optometrist', 'visao', 'olho', 'oculos', 'oftalmologista'] },
      { name: 'ear', group: 'health', labelKey: 'categories.icon.ear', aliases: ['hearing', 'ear', 'audicao', 'ouvido', 'fonoaudiologia'] },
      { name: 'hospital', group: 'health', labelKey: 'categories.icon.hospital', aliases: ['hospital', 'clinic', 'emergency', 'clinica', 'pronto socorro', 'emergencia'] },
      { name: 'hand-heart', group: 'health', labelKey: 'categories.icon.handHeart', aliases: ['care', 'wellbeing', 'cuidado', 'cuidados', 'bem estar'] },
    ],
  },
  {
    key: 'work',
    labelKey: 'categories.icon.group.work',
    options: [
      { name: 'briefcase', group: 'work', labelKey: 'categories.icon.briefcase', aliases: ['work', 'job', 'salary', 'employment', 'trabalho', 'emprego', 'salario', 'holerite'] },
      { name: 'laptop', group: 'work', labelKey: 'categories.icon.laptop', aliases: ['freelance', 'freelancer', 'remote', 'laptop', 'notebook', 'autonomo'] },
      { name: 'monitor', group: 'work', labelKey: 'categories.icon.monitor', aliases: ['software', 'subscription', 'saas', 'technology', 'tecnologia', 'assinatura', 'computador'] },
      { name: 'printer', group: 'work', labelKey: 'categories.icon.printer', aliases: ['office', 'escritorio', 'impressora', 'papelaria', 'suprimentos'] },
      { name: 'calculator', group: 'work', labelKey: 'categories.icon.calculator', aliases: ['accounting', 'taxes', 'accountant', 'contabilidade', 'impostos', 'contador', 'imposto'] },
      { name: 'building-2', group: 'work', labelKey: 'categories.icon.building2', aliases: ['business', 'company', 'empresa', 'corporativo', 'negocio'] },
      { name: 'file-text', group: 'work', labelKey: 'categories.icon.fileText', aliases: ['contract', 'contracts', 'document', 'contrato', 'contratos', 'documento', 'boleto'] },
      { name: 'scale', group: 'work', labelKey: 'categories.icon.scale', aliases: ['legal', 'lawyer', 'juridico', 'advogado', 'justica'] },
      { name: 'id-card', group: 'work', labelKey: 'categories.icon.idCard', aliases: ['documents', 'credentials', 'documento', 'identidade', 'cpf', 'documentos'] },
      { name: 'contact', group: 'work', labelKey: 'categories.icon.contact', aliases: ['clients', 'customer', 'cliente', 'clientes', 'contato'] },
      { name: 'handshake', group: 'work', labelKey: 'categories.icon.handshake', aliases: ['partnership', 'deal', 'parceria', 'acordo', 'negocios'] },
      { name: 'presentation', group: 'work', labelKey: 'categories.icon.presentation', aliases: ['meeting', 'meetings', 'presentation', 'reuniao', 'reunioes', 'apresentacao'] },
      { name: 'megaphone', group: 'work', labelKey: 'categories.icon.megaphone', aliases: ['marketing', 'ads', 'advertising', 'publicidade', 'anuncios', 'propaganda'] },
      { name: 'warehouse', group: 'work', labelKey: 'categories.icon.warehouse', aliases: ['logistics', 'warehouse', 'inventory', 'logistica', 'armazem', 'estoque'] },
    ],
  },
  {
    key: 'education',
    labelKey: 'categories.icon.group.education',
    options: [
      { name: 'book', group: 'education', labelKey: 'categories.icon.book', aliases: ['education', 'school', 'educacao', 'escola', 'curso'] },
      { name: 'book-open', group: 'education', labelKey: 'categories.icon.bookOpen', aliases: ['study', 'studying', 'reading', 'estudo', 'estudar', 'leitura'] },
      { name: 'graduation-cap', group: 'education', labelKey: 'categories.icon.graduationCap', aliases: ['tuition', 'university', 'college', 'faculdade', 'universidade', 'mensalidade', 'formatura'] },
      { name: 'pencil', group: 'education', labelKey: 'categories.icon.pencil', aliases: ['stationery', 'supplies', 'papelaria', 'material', 'lapis', 'caneta'] },
      { name: 'notebook-pen', group: 'education', labelKey: 'categories.icon.notebookPen', aliases: ['course', 'courses', 'class', 'training', 'curso', 'cursos', 'aula', 'treinamento'] },
    ],
  },
  {
    key: 'leisure',
    labelKey: 'categories.icon.group.leisure',
    options: [
      { name: 'film', group: 'leisure', labelKey: 'categories.icon.film', aliases: ['entertainment', 'movie', 'cinema', 'streaming', 'netflix', 'entretenimento', 'filme', 'cinema'] },
      { name: 'music', group: 'leisure', labelKey: 'categories.icon.music', aliases: ['music', 'concert', 'musica', 'spotify', 'show', 'concerto'] },
      { name: 'gamepad-2', group: 'leisure', labelKey: 'categories.icon.gamepad2', aliases: ['games', 'gaming', 'game', 'jogos', 'videogame'] },
      { name: 'ticket', group: 'leisure', labelKey: 'categories.icon.ticket', aliases: ['events', 'tickets', 'evento', 'eventos', 'ingresso', 'teatro'] },
      { name: 'trophy', group: 'leisure', labelKey: 'categories.icon.trophy', aliases: ['sports', 'sport', 'esportes', 'esporte', 'futebol', 'competicao'] },
      { name: 'dumbbell', group: 'leisure', labelKey: 'categories.icon.dumbbell', aliases: ['gym', 'fitness', 'workout', 'academia', 'treino', 'musculacao'] },
      { name: 'palmtree', group: 'leisure', labelKey: 'categories.icon.palmtree', aliases: ['vacation', 'holiday', 'ferias', 'viagem', 'lazer'] },
      { name: 'tent', group: 'leisure', labelKey: 'categories.icon.tent', aliases: ['camping', 'camp', 'acampamento', 'trilha', 'natureza'] },
      { name: 'repeat', group: 'leisure', labelKey: 'categories.icon.repeat', aliases: ['subscription', 'subscriptions', 'recurring', 'assinatura', 'assinaturas', 'recorrente', 'mensalidade'] },
      { name: 'sparkles', group: 'leisure', labelKey: 'categories.icon.sparkles', aliases: ['hobbies', 'hobby', 'beauty', 'lazer', 'diversao', 'beleza'] },
    ],
  },
  {
    key: 'family',
    labelKey: 'categories.icon.group.family',
    options: [
      { name: 'users', group: 'family', labelKey: 'categories.icon.users', aliases: ['family', 'familia', 'filhos', 'dependentes'] },
      { name: 'baby', group: 'family', labelKey: 'categories.icon.baby', aliases: ['kids', 'children', 'baby', 'filhos', 'criancas', 'bebe', 'filho'] },
      { name: 'dog', group: 'family', labelKey: 'categories.icon.dog', aliases: ['dog', 'cachorro', 'cao'] },
      { name: 'paw-print', group: 'family', labelKey: 'categories.icon.pawPrint', aliases: ['pets', 'pet', 'animals', 'veterinarian', 'animais', 'veterinario', 'racao'] },
      { name: 'church', group: 'family', labelKey: 'categories.icon.church', aliases: ['donation', 'donations', 'charity', 'doacao', 'doacoes', 'igreja', 'caridade'] },
      { name: 'scissors', group: 'family', labelKey: 'categories.icon.scissors', aliases: ['personal care', 'haircut', 'barber', 'salon', 'salao', 'cabelo', 'barbearia', 'estetica', 'beleza'] },
    ],
  },
  {
    key: 'finance',
    labelKey: 'categories.icon.group.finance',
    options: [
      { name: 'trending-up', group: 'finance', labelKey: 'categories.icon.trendingUp', aliases: ['investment', 'investments', 'dividends', 'investimento', 'investimentos', 'rendimento', 'dividendos'] },
      { name: 'banknote', group: 'finance', labelKey: 'categories.icon.banknote', aliases: ['cash', 'money', 'withdrawal', 'dinheiro', 'especie', 'saque'] },
      { name: 'coins', group: 'finance', labelKey: 'categories.icon.coins', aliases: ['savings', 'coins', 'poupanca', 'reserva', 'moedas'] },
      { name: 'wallet', group: 'finance', labelKey: 'categories.icon.wallet', aliases: ['wallet', 'balance', 'carteira', 'saldo'] },
      { name: 'credit-card', group: 'finance', labelKey: 'categories.icon.creditCard', aliases: ['credit card', 'card bill', 'invoice', 'cartao', 'fatura', 'cartao de credito'] },
      { name: 'piggy-bank', group: 'finance', labelKey: 'categories.icon.piggyBank', aliases: ['savings goal', 'save', 'poupanca', 'meta', 'cofrinho'] },
      { name: 'receipt', group: 'finance', labelKey: 'categories.icon.receipt', aliases: ['bill', 'bills', 'invoice', 'conta', 'contas', 'boleto', 'fatura', 'recibo'] },
      { name: 'shield', group: 'finance', labelKey: 'categories.icon.shield', aliases: ['insurance', 'protection', 'seguro', 'seguros', 'protecao'] },
      { name: 'landmark', group: 'finance', labelKey: 'categories.icon.landmark', aliases: ['bank', 'fees', 'interest', 'banco', 'tarifa', 'taxas', 'juros'] },
      { name: 'plus-circle', group: 'finance', labelKey: 'categories.icon.plusCircle', aliases: ['other income', 'extra income', 'outras receitas', 'renda extra'] },
    ],
  },
  {
    key: 'other',
    labelKey: 'categories.icon.group.other',
    options: [
      { name: 'more-horizontal', group: 'other', labelKey: 'categories.icon.moreHorizontal', aliases: ['other', 'misc', 'miscellaneous', 'diversos', 'outros', 'geral'] },
      { name: 'star', group: 'other', labelKey: 'categories.icon.star', aliases: ['favorite', 'favorites', 'favorito', 'favoritos', 'destaque'] },
      { name: 'flag', group: 'other', labelKey: 'categories.icon.flag', aliases: ['goal', 'goals', 'meta', 'metas', 'objetivo', 'objetivos'] },
      { name: 'tag', group: 'other', labelKey: 'categories.icon.tag', aliases: ['tag', 'tags', 'label', 'etiqueta', 'etiquetas', 'categoria'] },
      { name: 'tv', group: 'other', labelKey: 'categories.icon.tv', aliases: ['tv', 'streaming', 'television', 'cable', 'tv a cabo', 'assinatura'] },
    ],
  },
];

/** Flat view of every option, in group order. */
export const CATEGORY_ICON_OPTIONS: readonly CategoryIconOption[] =
  CATEGORY_ICON_GROUPS.flatMap((group) => group.options);

/** Every known icon identifier. */
export const CATEGORY_ICON_NAMES: readonly string[] = CATEGORY_ICON_OPTIONS.map(
  (option) => option.name,
);

const CATEGORY_ICON_NAME_SET = new Set(CATEGORY_ICON_NAMES);

/** Default icon per category type, used when creating a category. */
export const DEFAULT_CATEGORY_ICON: Record<'income' | 'expense', string> = {
  income: 'briefcase',
  expense: 'shopping-cart',
};

/** Return whether a persisted value is one of the known category icon ids. */
export function isCategoryIconName(value?: string | null): boolean {
  return typeof value === 'string' && CATEGORY_ICON_NAME_SET.has(value);
}

/** Lower-case, accent- and punctuation-insensitive search normalisation. */
export function normalizeCategoryIconText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Every searchable token for an option (translated label plus aliases). */
export function categoryIconSearchIndex(
  option: CategoryIconOption,
  label: string,
): string {
  return normalizeCategoryIconText([label, ...(option.aliases ?? [])].join(' '));
}

/**
 * Suggest an icon from a category name using boundary-aware alias matching.
 * Accent/punctuation-insensitive, so "Farmácia" and "farmacia" both match.
 */
export function suggestCategoryIcon(name?: string | null): string | null {
  if (!name?.trim()) return null;
  const normalized = normalizeCategoryIconText(name);
  if (!normalized) return null;
  const tokens = new Set(normalized.split(' '));
  const matches = CATEGORY_ICON_OPTIONS.flatMap((option) =>
    (option.aliases ?? []).flatMap((alias) => {
      const normalizedAlias = normalizeCategoryIconText(alias);
      if (!normalizedAlias) return [];
      const position = normalized.indexOf(normalizedAlias);
      const isBoundary =
        position >= 0 &&
        (position === 0 || normalized[position - 1] === ' ') &&
        (position + normalizedAlias.length === normalized.length ||
          normalized[position + normalizedAlias.length] === ' ');
      return isBoundary || tokens.has(normalizedAlias)
        ? [{ name: option.name, position, length: normalizedAlias.length }]
        : [];
    }),
  );
  matches.sort((a, b) => a.position - b.position || b.length - a.length);
  return matches[0]?.name ?? null;
}
