import * as React from 'react';
import { useSearchParams } from 'react-router-dom';
import { Camera, ChevronDown, QrCode, Receipt } from 'lucide-react';

import { useI18n } from '@/app/i18n';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { ItemsPricesTab } from './ItemsPricesTab';
import { OverviewTab } from './OverviewTab';
import { ProductDetailDialog } from './ProductDetailDialog';
import { ReceiptDetailDialog } from './ReceiptDetailDialog';
import { ReceiptReviewCard } from './ReceiptReviewCard';
import { ReceiptsTab } from './ReceiptsTab';
import { ScanReceiptCard } from './ScanReceiptCard';
import { StoreDetailDialog } from './StoreDetailDialog';
import { StoresTab } from './StoresTab';
import { useReceiptScanner } from './useReceiptScanner';

type TabKey = 'overview' | 'scan' | 'receipts' | 'items' | 'stores';

const TABS: TabKey[] = ['overview', 'scan', 'receipts', 'items', 'stores'];
const TAB_LABEL: Record<TabKey, string> = {
  overview: 'receipts.tabOverview',
  scan: 'receipts.tabScan',
  receipts: 'receipts.tabReceipts',
  items: 'receipts.tabItems',
  stores: 'receipts.tabStores',
};

/**
 * Receipts: scanning, receipt history and the price-tracking database built
 * from them.
 *
 * Tabs live in the URL, and the cross-links (receipt → product → store) are
 * handled here so every tab can open every detail dialog.
 */
export function ReceiptsPage() {
  const { t } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const scanner = useReceiptScanner();

  const rawTab = searchParams.get('tab');
  const tab: TabKey = TABS.includes(rawTab as TabKey) ? (rawTab as TabKey) : 'overview';

  const [receiptId, setReceiptId] = React.useState<string | null>(null);
  const [productId, setProductId] = React.useState<string | null>(null);
  const [storeId, setStoreId] = React.useState<string | null>(null);

  const goToTab = (next: TabKey) => {
    const params = new URLSearchParams(searchParams);
    if (next === 'overview') {
      params.delete('tab');
    } else {
      params.set('tab', next);
    }
    setSearchParams(params, { replace: true });
  };

  // "Scan receipt" in the header picks a method and lands on the scan tab.
  const startScan = (method: 'qr' | 'photo') => {
    scanner.setMethod(method);
    goToTab('scan');
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="max-md:hidden">
        <h1 className="text-[30px] font-bold leading-tight tracking-[-0.02em]">
          {t('receipts.pageTitle')}
        </h1>
        <p className="mt-1.5 max-w-2xl text-base text-muted-foreground">
          {t('receipts.pageSubtitle')}
        </p>
      </div>

      {/* Phone: the scan CTA is the header action. */}
      <div className="flex items-center justify-between gap-2 md:hidden">
        <h1 className="min-w-0 truncate text-xl font-bold tracking-[-0.01em]">
          {t('receipts.pageTitle')}
        </h1>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button className="shrink-0 gap-1.5">
              <Receipt className="h-4 w-4" />
              {t('receipts.scanCta')}
              <ChevronDown className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => startScan('qr')}>
              <QrCode className="h-4 w-4" />
              {t('receipts.methodQr')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => startScan('photo')}>
              <Camera className="h-4 w-4" />
              {t('receipts.methodPhoto')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="hidden justify-end md:flex">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button className="gap-1.5">
              <Receipt className="h-4 w-4" />
              {t('receipts.scanCta')}
              <ChevronDown className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => startScan('qr')}>
              <QrCode className="h-4 w-4" />
              {t('receipts.methodQr')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => startScan('photo')}>
              <Camera className="h-4 w-4" />
              {t('receipts.methodPhoto')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Local navigation (scrollable on narrow screens) */}
      <div
        className="flex gap-1 overflow-x-auto rounded-md bg-muted p-1"
        role="tablist"
        aria-label={t('receipts.pageTitle')}
      >
        {TABS.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => goToTab(key)}
            className={cn(
              'shrink-0 rounded-sm px-3.5 py-1.5 text-sm font-medium transition-colors',
              tab === key
                ? 'bg-primary/15 text-foreground ring-1 ring-inset ring-primary/40'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t(TAB_LABEL[key] as 'receipts.tabOverview')}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <OverviewTab
          scanner={scanner}
          onOpenScan={() => goToTab('scan')}
          onStartScan={startScan}
          onOpenReceipts={() => goToTab('receipts')}
          onOpenItems={() => goToTab('items')}
          onOpenStores={() => goToTab('stores')}
          onOpenReceipt={setReceiptId}
          onOpenProduct={setProductId}
          onOpenStore={setStoreId}
        />
      )}

      {tab === 'scan' && (
        <div className="space-y-4">
          <ScanReceiptCard scanner={scanner} />
          <ReceiptReviewCard scanner={scanner} onSaved={() => goToTab('receipts')} />
        </div>
      )}

      {tab === 'receipts' && <ReceiptsTab onOpenProduct={setProductId} />}
      {tab === 'items' && <ItemsPricesTab />}
      {tab === 'stores' && <StoresTab />}

      {/* Cross-tab dialogs, so any tab can complete a receipt/product/store path. */}
      <ReceiptDetailDialog
        receiptId={receiptId}
        onOpenChange={(open) => !open && setReceiptId(null)}
        onOpenProduct={(id) => {
          setReceiptId(null);
          setProductId(id);
        }}
      />
      <ProductDetailDialog
        productId={productId}
        onOpenChange={(open) => !open && setProductId(null)}
        onOpenStore={(id) => {
          setProductId(null);
          setStoreId(id);
        }}
      />
      <StoreDetailDialog
        storeId={storeId}
        onOpenChange={(open) => !open && setStoreId(null)}
        onOpenReceipt={(id) => {
          setStoreId(null);
          setReceiptId(id);
        }}
        onOpenProduct={(id) => {
          setStoreId(null);
          setProductId(id);
        }}
      />
    </div>
  );
}
