import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, SearchX, Tags } from 'lucide-react';

import { useI18n } from '@/app/i18n';
import { useToast } from '@/components/ui/toaster';
import { deleteCategory, fetchCategories, type Category } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/EmptyState';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { CategoryForm } from './CategoryForm';
import { CategoryTree } from './CategoryTree';

interface Props {
  /** Opens the search box pre-filled (used by "View category" on a budget). */
  initialSearch?: string;
}

type CategoryType = 'income' | 'expense';

interface Section {
  type: CategoryType;
  title: string;
  blurb: string;
  count: number;
  addLabel: string;
  items: Category[];
}

/** Categories tab: income/expense categories and their subcategories. */
export function CategoriesTab({ initialSearch }: Props) {
  const { t } = useI18n();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [search, setSearch] = React.useState(initialSearch ?? '');
  const [formOpen, setFormOpen] = React.useState(false);
  const [formType, setFormType] = React.useState<CategoryType>('expense');
  const [formParent, setFormParent] = React.useState('');
  const [editing, setEditing] = React.useState<Category | null>(null);
  const [pendingDelete, setPendingDelete] = React.useState<Category | null>(null);
  const [deleting, setDeleting] = React.useState(false);

  React.useEffect(() => {
    if (initialSearch !== undefined) setSearch(initialSearch);
  }, [initialSearch]);

  const categoriesQuery = useQuery({ queryKey: ['categories'], queryFn: () => fetchCategories() });
  const categories = React.useMemo(() => categoriesQuery.data ?? [], [categoriesQuery.data]);

  const filtered = React.useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return categories;
    return categories.filter(
      (c) => c.name.toLowerCase().includes(needle) || (c.icon ?? '').toLowerCase().includes(needle),
    );
  }, [categories, search]);

  const refresh = React.useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['categories'] });
  }, [queryClient]);

  const openCreate = (type: CategoryType, parentId = '') => {
    setEditing(null);
    setFormType(type);
    setFormParent(parentId);
    setFormOpen(true);
  };

  const openEdit = (category: Category) => {
    setEditing(category);
    setFormParent(category.parent_id ?? '');
    setFormType(category.type === 'income' ? 'income' : 'expense');
    setFormOpen(true);
  };

  const handleDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    const target = pendingDelete;
    try {
      await deleteCategory(target.id);
      setPendingDelete(null);
      await refresh();
      toast({ title: t('categories.deleted', { name: target.name }) });
    } catch (err) {
      // The API refuses to delete categories that are still in use (409).
      toast({
        title: err instanceof Error ? err.message : t('categories.failedDelete'),
        variant: 'error',
      });
      setPendingDelete(null);
    } finally {
      setDeleting(false);
    }
  };

  const sections: Section[] = [
    {
      type: 'expense',
      title: t('categories.tabExpenses'),
      blurb: t('categories.expensesSectionBlurb'),
      count: categories.filter((c) => c.type === 'expense').length,
      addLabel: t('categories.action.addExpense'),
      items: filtered.filter((c) => c.type === 'expense'),
    },
    {
      type: 'income',
      title: t('categories.tabIncome'),
      blurb: t('categories.incomeSectionBlurb'),
      count: categories.filter((c) => c.type === 'income').length,
      addLabel: t('categories.action.addIncome'),
      items: filtered.filter((c) => c.type === 'income'),
    },
  ];

  const loading = categoriesQuery.isLoading;
  const loadFailed = categoriesQuery.isError;
  const nothingAtAll = !loading && !loadFailed && categories.length === 0;
  const noMatches = !loading && !loadFailed && categories.length > 0 && filtered.length === 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{t('categories.title')}</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{t('categories.subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full min-w-[10rem] sm:w-56">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('categories.search')}
              aria-label={t('categories.searchAria')}
            />
          </div>
          <Button
            variant="outline"
            className="gap-1.5 text-success"
            onClick={() => openCreate('expense')}
          >
            <Plus className="h-4 w-4" />
            {t('categories.action.addExpense')}
          </Button>
          <Button
            variant="outline"
            className="gap-1.5 text-primary"
            onClick={() => openCreate('income')}
          >
            <Plus className="h-4 w-4" />
            {t('categories.action.addIncome')}
          </Button>
        </div>
      </div>

      {loading ? (
        <Card className="space-y-3 p-5">
          {[0, 1, 2, 3].map((row) => (
            <div key={row} className="flex items-center gap-3">
              <Skeleton className="h-[34px] w-[34px] rounded-md" />
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-4 w-8" />
            </div>
          ))}
        </Card>
      ) : loadFailed ? (
        <Card className="p-7">
          <EmptyState
            icon={<Tags className="h-8 w-8" />}
            title={t('categories.failedLoad')}
            description={t('categories.failedLoadDesc')}
            action={
              <Button variant="outline" onClick={() => void categoriesQuery.refetch()}>
                {t('common.retry')}
              </Button>
            }
          />
        </Card>
      ) : nothingAtAll ? (
        <Card className="p-7">
          <EmptyState
            icon={<Tags className="h-8 w-8" />}
            title={t('categories.noTitle')}
            description={t('categories.noDesc')}
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button className="gap-1.5" onClick={() => openCreate('expense')}>
                  <Plus className="h-4 w-4" />
                  {t('categories.action.addExpense')}
                </Button>
                <Button
                  variant="outline"
                  className="gap-1.5"
                  onClick={() => openCreate('income')}
                >
                  <Plus className="h-4 w-4" />
                  {t('categories.action.addIncome')}
                </Button>
              </div>
            }
          />
        </Card>
      ) : noMatches ? (
        <Card className="p-7">
          <EmptyState
            icon={<SearchX className="h-8 w-8" />}
            title={t('categories.noMatchingTitle')}
            description={t('categories.noMatchingDesc', { query: search })}
          />
        </Card>
      ) : (
        sections
          .filter((section) => section.items.length > 0)
          .map((section) => (
            <Card
              key={section.type}
              className="overflow-hidden border-border bg-surface shadow-card"
            >
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-5">
                <div>
                  <h3 className="text-base font-semibold">
                    {section.title}
                    <span className="ml-2 text-sm font-normal text-dim">{section.count}</span>
                  </h3>
                  <p className="mt-0.5 text-sm text-muted-foreground">{section.blurb}</p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  onClick={() => openCreate(section.type)}
                >
                  <Plus className="h-4 w-4" />
                  {section.addLabel}
                </Button>
              </div>
              <CategoryTree
                categories={section.items}
                onEdit={openEdit}
                onAddSubcategory={(parent) =>
                  openCreate(parent.type === 'income' ? 'income' : 'expense', parent.id)
                }
                onDelete={setPendingDelete}
              />
            </Card>
          ))
      )}

      <CategoryForm
        open={formOpen}
        onOpenChange={setFormOpen}
        categories={categories}
        editing={editing}
        initialType={formType}
        initialParentId={formParent}
        onSaved={(name) => {
          const label = editing
            ? t('categories.updated', { name: editing.name })
            : t('categories.created', { name });
          setFormOpen(false);
          setEditing(null);
          setFormParent('');
          void refresh();
          toast({ title: label, variant: 'success' });
        }}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        title={t('categories.deleteTitle', { name: pendingDelete?.name ?? '' })}
        description={t('categories.deleteMessage')}
        busy={deleting}
        destructive
        onConfirm={() => void handleDelete()}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}

