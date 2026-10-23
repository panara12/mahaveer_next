import { useMemo, useState } from 'react';
import { FilePlus2, Search, X } from 'lucide-react';
import { useProducts } from '../../hooks/useProducts';
import ProductCardWithSizes from './ProductCardWithSizes';
import QuotationBuilder from './QuotationBuilder';

export default function NewQuotationDialog({ open, onClose, onComplete }) {
  const [step, setStep] = useState('products');
  const [search, setSearch] = useState('');
  const [selectedProductsWithSizes, setSelectedProductsWithSizes] = useState([]);
  const { data, isLoading } = useProducts({
    params: { page: 1, limit: 100, search: search.trim() },
    enabled: open && step === 'products',
    keepPrevious: true,
  });
  const products = data?.products || data?.data?.products || [];
  const selectedSizeCount = useMemo(
    () => selectedProductsWithSizes.reduce((total, item) => total + item.selectedSizes.length, 0),
    [selectedProductsWithSizes],
  );

  if (!open) return null;

  const close = () => {
    setStep('products');
    setSearch('');
    setSelectedProductsWithSizes([]);
    onClose();
  };

  const updateProductSizes = (product, selectedSizes) => {
    setSelectedProductsWithSizes((current) => {
      if (selectedSizes.length === 0) return current.filter((item) => item.product._id !== product._id);
      const index = current.findIndex((item) => item.product._id === product._id);
      if (index === -1) return [...current, { product, selectedSizes }];
      const next = [...current];
      next[index] = { product, selectedSizes };
      return next;
    });
  };

  if (step === 'builder') {
    return (
      <div className="fixed inset-0 z-50 overflow-y-auto bg-card" role="dialog" aria-modal="true" aria-label="Create quotation">
        <div className="min-h-dvh bg-card px-3 py-4 sm:px-6 sm:py-6">
          <div className="sticky top-0 z-10 mx-auto mb-4 flex max-w-5xl items-center justify-between border-b border-border bg-card py-3 sm:py-4">
            <button onClick={() => setStep('products')} className="text-sm text-muted-foreground hover:text-foreground">
              ← Change products
            </button>
            <button onClick={close} className="rounded-md p-2 hover:bg-muted" aria-label="Close new quotation dialog">
              <X className="h-5 w-5" />
            </button>
          </div>
          <QuotationBuilder
            selectedProductsWithSizes={selectedProductsWithSizes}
            onCancel={close}
            onComplete={() => {
              close();
              onComplete?.();
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="new-quotation-title">
      <div className="flex max-h-[90dvh] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-xl">
        <div className="flex items-start justify-between border-b border-border p-4 sm:p-5">
          <div>
            <h2 id="new-quotation-title" className="text-lg font-semibold text-foreground">New Quotation</h2>
            <p className="mt-1 text-sm text-muted-foreground">Select one or more product sizes to include.</p>
          </div>
          <button onClick={close} className="rounded-md p-2 hover:bg-muted" aria-label="Close new quotation dialog">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="border-b border-border p-4 sm:px-5">
          <label className="relative block max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search products" className="w-full rounded-md border border-border bg-background py-2 pl-9 pr-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring" />
          </label>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
          {isLoading ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Loading products…</p>
          ) : products.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">No products found.</p>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {products.map((product) => {
                const selected = selectedProductsWithSizes.find((item) => item.product._id === product._id);
                return <ProductCardWithSizes key={product._id} product={{ ...product, image: product.img, sizes: product.sku || [] }} selectedSizes={selected?.selectedSizes || []} onSizesChange={(sizes) => updateProductSizes(product, sizes)} />;
              })}
            </div>
          )}
        </div>

        <div className="flex flex-col-reverse gap-3 border-t border-border p-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <p className="text-sm text-muted-foreground">{selectedSizeCount} product size{selectedSizeCount === 1 ? '' : 's'} selected</p>
          <div className="flex gap-3">
            <button onClick={close} className="rounded-lg border border-border px-4 py-2 text-sm text-foreground hover:bg-muted">Cancel</button>
            <button onClick={() => setStep('builder')} disabled={selectedSizeCount === 0} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50">
              <FilePlus2 className="h-4 w-4" /> Continue
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
