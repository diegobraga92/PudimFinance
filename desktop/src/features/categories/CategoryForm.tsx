import * as React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useI18n } from '@/app/i18n';
import {
  createCategory,
  updateCategory,
  type Category,
  type CreateCategoryRequest,
} from '@/lib/api';
import { CATEGORY_ICON_EMOJI, CATEGORY_ICON_NAMES } from '@shared/category-icons';
import { cn } from '@/lib/utils';
import {
  CATEGORY_COLORS,
  firstAvailableCategoryColor,
} from '@/lib/category-colors';

const DEFAULT_EXPENSE_ICON = 'shopping-cart';
const DEFAULT_INCOME_ICON = 'briefcase';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: Category[];
  editing: Category | null;
  initialType: 'income' | 'expense';
  /** Pre-selected parent when adding a subcategory from the tree. */
  initialParentId?: string;
  onSaved: (name: string) => void;
}

export function CategoryForm({
  open,
  onOpenChange,
  categories,
  editing,
  initialType,
  initialParentId,
  onSaved,
}: Props) {
  const { t } = useI18n();
  const isEditing = editing !== null;

  const [name, setName] = React.useState('');
  const [type, setType] = React.useState<'income' | 'expense'>(initialType);
  const [icon, setIcon] = React.useState(DEFAULT_EXPENSE_ICON);
  const [color, setColor] = React.useState(CATEGORY_COLORS[0]);
  const [parentId, setParentId] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setName(editing?.name ?? '');
    setType(editing?.type === 'income' ? 'income' : initialType);
    setIcon(editing?.icon || (editing?.type === 'income' ? DEFAULT_INCOME_ICON : DEFAULT_EXPENSE_ICON));
    const sameType = categories.filter((category) => category.type === (editing?.type ?? initialType));
    setColor(editing?.color || firstAvailableCategoryColor(sameType));
    setParentId(editing?.parent_id ?? initialParentId ?? '');
    setError(null);
    setSaving(false);
  }, [open, editing, initialType, initialParentId, categories]);

  // Only top-level categories of the same type can be parents.
  const parentOptions = categories.filter(
    (c) => c.type === type && !c.parent_id && c.id !== editing?.id,
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError(t('common.nameRequired'));
      return;
    }
    setSaving(true);
    setError(null);
    const payload: CreateCategoryRequest = {
      name: trimmed,
      type,
      icon,
      color,
      parent_id: parentId || null,
    };
    try {
      if (isEditing && editing) {
        await updateCategory(editing.id, payload);
      } else {
        await createCategory(payload);
      }
      onSaved(trimmed);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('categories.failedSave'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? t('categories.form.edit') : t('categories.form.new')}
          </DialogTitle>
          <DialogDescription>
            {t('categories.form.name')} · {t('categories.form.type')}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="cat-name">{t('categories.form.name')}</Label>
              <Input
                id="cat-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('categories.form.namePlaceholder')}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t('categories.form.type')}</Label>
              <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
                {(['expense', 'income'] as const).map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => {
                      setType(opt);
                      if (!isEditing) {
                        setColor(
                          firstAvailableCategoryColor(
                            categories.filter((category) => category.type === opt),
                          ),
                        );
                      }
                    }}
                    className={cn(
                      'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                      type === opt
                        ? opt === 'income'
                          ? 'bg-income text-white shadow-sm'
                          : 'bg-expense text-white shadow-sm'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {opt === 'expense' ? t('common.expense') : t('common.income')}
                  </button>
                ))}
              </div>
            </div>
          </div>


          {/* Icon picker */}
          <div className="space-y-1.5">
            <Label>{t('categories.form.icon')}</Label>
            <div
              className="grid grid-cols-9 gap-1.5"
              role="radiogroup"
              aria-label={t('categories.form.icon')}
            >
              {CATEGORY_ICON_NAMES.map((iconName) => (
                <button
                  key={iconName}
                  type="button"
                  role="radio"
                  aria-checked={icon === iconName}
                  aria-label={t('categories.form.iconAria', { icon: iconName })}
                  onClick={() => setIcon(iconName)}
                  className={cn(
                    'flex h-9 w-9 items-center justify-center rounded-md border text-lg transition-colors',
                    icon === iconName
                      ? 'border-primary bg-accent'
                      : 'border-border bg-surface hover:bg-surface-hover',
                  )}
                >
                  {CATEGORY_ICON_EMOJI[iconName]}
                </button>
              ))}
            </div>
          </div>

          {/* Color palette */}
          <div className="space-y-1.5">
            <Label>{t('categories.form.color')}</Label>
            <div
              className="flex flex-wrap gap-2"
              role="radiogroup"
              aria-label={t('categories.form.color')}
            >
              {CATEGORY_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={color === c}
                  aria-label={t('categories.form.colorAria', { color: c })}
                  onClick={() => setColor(c)}
                  className={cn(
                    'h-7 w-7 rounded-full transition-transform hover:scale-110',
                    color === c && 'ring-2 ring-offset-2 ring-offset-background ring-foreground',
                  )}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>

          {/* Subcategory */}
          <div className="space-y-1.5">
            <Label htmlFor="cat-parent">
              {t('common.subcategory')} ({t('common.optional')})
            </Label>
            <select
              id="cat-parent"
              className="flex h-9 w-full rounded-md border border-input bg-surface px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
            >
              <option value="">— {t('common.topLevel')} —</option>
              {parentOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.icon ? `${CATEGORY_ICON_EMOJI[c.icon] ?? ''} ` : ''}
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={saving}>
              {saving
                ? t('common.saving')
                : isEditing
                  ? t('categories.form.saveChanges')
                  : t('categories.form.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

