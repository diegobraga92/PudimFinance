import * as React from 'react';
import { Search } from 'lucide-react';
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
import {
  CATEGORY_ICON_GROUPS,
  CATEGORY_ICON_OPTIONS,
  DEFAULT_CATEGORY_ICON,
  categoryIconSearchIndex,
  normalizeCategoryIconText,
  suggestCategoryIcon,
} from '@shared/category-icons';
import { CategoryIcon } from '@/components/CategoryIcon';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import {
  CATEGORY_COLORS,
  firstAvailableCategoryColor,
} from '@/lib/category-colors';

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
  const [icon, setIcon] = React.useState<string>(DEFAULT_CATEGORY_ICON.expense);
  const [iconTouched, setIconTouched] = React.useState(false);
  const [iconQuery, setIconQuery] = React.useState('');
  const [color, setColor] = React.useState(CATEGORY_COLORS[0]);
  const [parentId, setParentId] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    const nextType = editing?.type === 'income' ? 'income' : initialType;
    const parent = initialParentId
      ? categories.find((category) => category.id === initialParentId)
      : undefined;
    setName(editing?.name ?? '');
    setType(nextType);
    // Preserve the stored icon; otherwise inherit the parent's icon when adding
    // a subcategory, falling back to the per-type default.
    setIcon(editing?.icon || parent?.icon || DEFAULT_CATEGORY_ICON[nextType]);
    setIconTouched(false);
    setIconQuery('');
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

  // Icon groups filtered by the picker search (label + bilingual aliases).
  const iconGroups = React.useMemo(() => {
    const needle = normalizeCategoryIconText(iconQuery);
    return CATEGORY_ICON_GROUPS.map((group) => ({
      key: group.key,
      labelKey: group.labelKey,
      options: needle
        ? group.options.filter((option) =>
            categoryIconSearchIndex(option, t(option.labelKey)).includes(needle),
          )
        : group.options,
    })).filter((group) => group.options.length > 0);
  }, [iconQuery, t]);

  const selectedIconLabel = React.useMemo(() => {
    const match = CATEGORY_ICON_OPTIONS.find((option) => option.name === icon);
    return match ? t(match.labelKey) : icon;
  }, [icon, t]);

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
      <DialogContent className="sm:max-w-xl md:max-w-2xl">
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
                onChange={(e) => {
                  const nextName = e.target.value;
                  setName(nextName);
                  // Suggest an icon from the name until the user picks one.
                  if (!isEditing && !iconTouched) {
                    setIcon(suggestCategoryIcon(nextName) ?? DEFAULT_CATEGORY_ICON[type]);
                  }
                }}
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


          <div className="space-y-1.5">
            <div className="flex min-w-0 items-center justify-between gap-2">
              <Label>{t('categories.form.icon')}</Label>
              <span className="flex min-w-0 items-center gap-1.5 text-xs text-dim">
                <CategoryIcon name={icon} className="h-4 w-4 shrink-0" />
                <span className="min-w-0 truncate">
                  {t('categories.form.iconSelected', { icon: selectedIconLabel })}
                </span>
              </span>
            </div>
            <div className="relative">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                value={iconQuery}
                onChange={(event) => setIconQuery(event.target.value)}
                onKeyDown={(event) => {
                  // The picker lives inside the category form; Enter should not submit it.
                  if (event.key === 'Enter') event.preventDefault();
                }}
                placeholder={t('categories.form.iconSearch')}
                aria-label={t('categories.form.iconSearch')}
                className="pl-9 md:max-w-xs"
              />
            </div>
            <div
              className="space-y-3 md:max-h-64 md:overflow-y-auto md:overscroll-contain md:pr-1"
              role="radiogroup"
              aria-label={t('categories.form.icon')}
            >
              {iconGroups.map((group) => (
                <div key={group.key} className="space-y-1.5">
                  <p className="text-xs font-medium text-dim">{t(group.labelKey)}</p>
                  <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-8 md:grid-cols-10">
                    {group.options.map((option) => (
                      <button
                        key={option.name}
                        type="button"
                        role="radio"
                        aria-checked={icon === option.name}
                        aria-label={t('categories.form.iconAria', { icon: t(option.labelKey) })}
                        onClick={() => {
                          setIcon(option.name);
                          setIconTouched(true);
                        }}
                        className={cn(
                          'mx-auto flex aspect-square w-full max-w-[2.75rem] items-center justify-center rounded-md border transition-colors md:max-w-[2.25rem]',
                          icon === option.name
                            ? 'border-primary bg-accent'
                            : 'border-border bg-surface hover:bg-surface-hover',
                        )}
                      >
                        <CategoryIcon name={option.name} className="h-5 w-5 max-md:h-6 max-md:w-6" />
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              {iconGroups.length === 0 && (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  {t('categories.form.iconNoResults')}
                </p>
              )}
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

          <div className="space-y-1.5">
            <Label htmlFor="cat-parent">
              {t('common.subcategory')} ({t('common.optional')})
            </Label>
            <Select
              value={parentId || '__top__'}
              onValueChange={(value) => setParentId(value === '__top__' ? '' : value)}
            >
              <SelectTrigger id="cat-parent">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="z-[60]">
                <SelectItem value="__top__">— {t('common.topLevel')} —</SelectItem>
              {parentOptions.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  <span className="flex items-center gap-2">
                    <CategoryIcon name={c.icon} className="h-4 w-4" />
                    {c.name}
                  </span>
                </SelectItem>
              ))}
              </SelectContent>
            </Select>
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

