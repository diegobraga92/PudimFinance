import { MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';

import { useI18n } from '@/app/i18n';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { Category } from '@/lib/api';
import { CategoryIcon } from '@/components/CategoryIcon';

interface Props {
  /** Categories of a single type, already filtered by the search box. */
  categories: Category[];
  onEdit: (category: Category) => void;
  onAddSubcategory: (parent: Category) => void;
  onDelete: (category: Category) => void;
}

/**
 * Two-level category tree.
 *
 * Parents carry their subcategories, indented under a tree rail so the
 * hierarchy is obvious without exposing `parent_id` anywhere. A category whose
 * parent was deleted (or filtered out by the search) is still listed as a
 * top-level row, so nothing ever disappears silently.
 */
export function CategoryTree({ categories, onEdit, onAddSubcategory, onDelete }: Props) {
  const { t } = useI18n();

  const ids = new Set(categories.map((c) => c.id));
  const childrenByParent = new Map<string, Category[]>();
  for (const category of categories) {
    if (category.parent_id && ids.has(category.parent_id)) {
      const list = childrenByParent.get(category.parent_id) ?? [];
      list.push(category);
      childrenByParent.set(category.parent_id, list);
    }
  }

  const parents = categories
    .filter((c) => !c.parent_id || !ids.has(c.parent_id))
    .sort((a, b) => a.name.localeCompare(b.name));

  const renderRow = (category: Category, children: Category[]) => {
    const isParent = !category.parent_id;
    return (
      <div className="group flex min-h-[58px] items-center gap-3 px-4 py-2.5 transition-colors hover:bg-primary/[0.045]">
        <span
          className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-md text-base"
          style={{ backgroundColor: `${category.color ?? '#60a5fa'}1f` }}
        >
          <CategoryIcon
            name={category.icon}
            className="h-[18px] w-[18px]"
            style={{ color: category.color ?? '#60a5fa' }}
          />
        </span>
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              'truncate',
              isParent ? 'text-[15px] font-semibold' : 'text-sm font-medium',
            )}
          >
            {category.name}
          </p>
          <p className="truncate text-xs text-dim">
            {isParent
              ? t(children.length === 1 ? 'categories.parentMeta_one' : 'categories.parentMeta_other', {
                  type: category.type === 'income' ? t('common.income') : t('common.expense'),
                  count: children.length,
                })
              : t('categories.childMeta', {
                  type: category.type === 'income' ? t('common.income') : t('common.expense'),
                })}
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0 text-muted-foreground"
              aria-label={category.name}
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onEdit(category)}>
              <Pencil className="h-4 w-4" />
              {t('common.edit')}
            </DropdownMenuItem>
            {isParent && (
              <DropdownMenuItem onClick={() => onAddSubcategory(category)}>
                <Plus className="h-4 w-4" />
                {t('categories.action.addSubcategory')}
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => onDelete(category)}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
              {t('common.delete')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  };

  return (
    <ul className="divide-y divide-border/60">
      {parents.map((parent) => {
        const children = (childrenByParent.get(parent.id) ?? []).sort((a, b) =>
          a.name.localeCompare(b.name),
        );
        return (
          <li key={parent.id}>
            {renderRow(parent, children)}
            {children.length > 0 && (
              <ul className="ml-5 divide-y divide-border/40 border-l border-border/60 pl-5">
                {children.map((child) => (
                  <li key={child.id}>{renderRow(child, [])}</li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}
