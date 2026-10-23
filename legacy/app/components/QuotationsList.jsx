import { useEffect, useState } from 'react';
import { useData } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import { FileText, Download, Share2, Search, ChevronLeft, ChevronRight, Loader2, Wifi, WifiOff, Pencil, X, Save, Trash2, Plus } from 'lucide-react';
import { generateQuotationPDF, generateQuotationPDFAsBase64 } from '../utils/pdfGenerator';
import { useWhatsAppStatus, useSendWhatsAppQuotation } from '../../hooks/useWhatsApp';
import { useFetchProductsByIds, useProducts } from '../../hooks/useProducts';
import { toast } from 'sonner';
import { DEFAULT_QUOTATION_TERMS, DEFAULT_SELECTED_QUOTATION_TERMS } from '../utils/quotationTerms';

const defaultColumns = {
  product: true, size: true, innerPack: true, masterCarton: true,
  quantity: true, totalPieces: true, mrp: true, discount: true,
  finalPrice: true, gst: true, total: true,
};

const getProductId = (quotationProduct) => {
  const product = quotationProduct.product_id?._id
    || quotationProduct.product_id
    || quotationProduct.productId;

  return typeof product === 'object' ? product?._id?.toString() : product?.toString();
};

const getQuotationTerms = (termsConditions) => {
  const paymentTerms = typeof termsConditions?.paymentTerms === 'string'
    ? termsConditions.paymentTerms
    : '';
  const selected = Array.isArray(termsConditions?.selected)
    ? [...new Set(termsConditions.selected)]
    : [...DEFAULT_SELECTED_QUOTATION_TERMS];

  // Older quotations lost this camel-case ID during API validation, even
  // though their payment-term text was saved. Restore the selected state.
  if (paymentTerms.trim() && !selected.includes('paymentTerms')) {
    selected.push('paymentTerms');
  }

  return { selected, paymentTerms };
};

export default function QuotationsList() {
  const { user } = useAuth();
  const {
    quotations,
    quotationsLoading,
    quotationTotal,
    quotationPages,
    quotationParams,
    setQuotationFilter,
    updateQuotation,
  } = useData();

  const isAdmin = user?.userType === 'admin';
  const fetchProductsByIds = useFetchProductsByIds();
  const fetchProductsByIdsAsync = fetchProductsByIds.mutateAsync;
  const sendWhatsAppQuotation = useSendWhatsAppQuotation({ showErrorToast: false });

  const [search,       setSearch]       = useState('');
  const [clientName,   setClientName]   = useState('');
  const [firmName,     setFirmName]     = useState('');
  const [from,         setFrom]         = useState('');
  const [to,           setTo]           = useState('');
  const [sharingId,    setSharingId]    = useState(null); // tracks which quotation is being shared
  const [expandedQuotationIds, setExpandedQuotationIds] = useState(() => new Set());
  const [productNamesById, setProductNamesById] = useState({});
  const [editingQuotation, setEditingQuotation] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [productSearch, setProductSearch] = useState('');
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [selectedSkuIndex, setSelectedSkuIndex] = useState('');
  const productSearchParams = { page: 1, limit: 10, search: productSearch.trim() };
  const { data: productSearchData, isLoading: isSearchingProducts, isError: productSearchFailed } = useProducts({
    params: productSearchParams,
    enabled: isAdmin && showAddProduct && productSearch.trim().length >= 2,
    keepPrevious: false,
  });
  const productSuggestions = productSearchData?.products || productSearchData?.data?.products || [];

  const toggleProducts = (quotationId) => {
    setExpandedQuotationIds((previous) => {
      const next = new Set(previous);
      if (next.has(quotationId)) next.delete(quotationId);
      else next.add(quotationId);
      return next;
    });
  };

  const handleEditQuotation = async (quotation) => {
    const ids = [...new Set((quotation.products || []).map(getProductId).filter(Boolean))];
    let productMap = {};
    if (ids.length > 0) {
      try {
        const response = await fetchProductsByIdsAsync(ids);
        productMap = response?.productMap || response?.data?.productMap || {};
      } catch {
        toast.error('Could not load product details. Please try again.');
        return;
      }
    }

    setEditingQuotation(quotation);
    setShowAddProduct(false);
    setProductSearch('');
    setSelectedProduct(null);
    setSelectedSkuIndex('');
    setEditForm({
      q_id: quotation.q_id || '',
      clientName: quotation.clientName || '',
      firmName: quotation.firmName || '',
      mobile: quotation.mobile || quotation.contact || '',
      email: quotation.email || '',
      address: quotation.address || '',
      gstNumber: quotation.gstNumber || '',
      discount: Number(quotation.discount || 0),
      createdAt: quotation.createdAt ? new Date(quotation.createdAt).toISOString().slice(0, 10) : '',
      termsConditions: getQuotationTerms(quotation.termsConditions),
      products: (quotation.products || []).map((product) => {
        const productId = getProductId(product);
        const details = productMap[productId] || {};
        return {
          productId,
          productName: product.productName || details.name || product.product_id?.name || productNamesById[productId] || 'Product unavailable',
          size: product.size || '',
          innerPack: Number(product.innerPack ?? 1),
          masterPack: Number(product.masterPack ?? 1),
          quantity: Number(product.quatity ?? product.quantity ?? 1),
          mrp: Number(product.mrp || 0),
          discount: Number(product.discount || 0),
          finalPrice: Number(product.finalPrice || 0),
          gstPercentage: Number(product.gstPercentage ?? details.gstPercentage ?? details.gstPercent ?? 0),
        };
      }),
    });
  };

  const addSelectedSkuToQuotation = () => {
    const sku = selectedProduct?.sku?.[Number(selectedSkuIndex)];
    if (!selectedProduct || !sku) {
      toast.error('Select a product and SKU before adding it.');
      return;
    }
    setEditForm((previous) => ({
      ...previous,
      products: [...previous.products, {
        productId: selectedProduct._id,
        productName: selectedProduct.name,
        size: sku.size || '',
        innerPack: Number(sku.innerPack || 1),
        masterPack: Number(sku.masterPack || 1),
        quantity: 1,
        mrp: Number(sku.mrp || 0),
        discount: 0,
        finalPrice: Number(sku.mrp || 0),
        gstPercentage: Number(selectedProduct.gstPercentage ?? 0),
      }],
    }));
    setSelectedProduct(null);
    setSelectedSkuIndex('');
    setProductSearch('');
    setShowAddProduct(false);
  };

  const updateEditProduct = (index, field, value) => {
    setEditForm((previous) => ({
      ...previous,
      products: previous.products.map((product, productIndex) =>
        productIndex === index ? { ...product, [field]: value } : product
      ),
    }));
  };

  const handleSaveQuotation = () => {
    if (!editForm.clientName.trim() || !editForm.q_id.trim() || !editForm.createdAt || editForm.products.length === 0) {
      toast.error('Quotation number, client name, date, and at least one product are required.');
      return;
    }
    if (editForm.termsConditions.selected.includes('paymentTerms') && !editForm.termsConditions.paymentTerms.trim()) {
      toast.error('Enter customized payment terms or uncheck that condition.');
      return;
    }

    const products = editForm.products.map((product) => {
      const totalpcs = product.innerPack * product.quantity;
      const total = totalpcs * product.finalPrice;
      return {
        product_id: product.productId,
        productName: product.productName.trim(),
        size: product.size,
        innerPack: product.innerPack,
        masterPack: product.masterPack,
        quatity: product.quantity,
        totalpcs,
        cartoon: Number(((product.innerPack / product.masterPack) * product.quantity).toFixed(2)),
        mrp: product.mrp,
        discount: product.discount,
        finalPrice: product.finalPrice,
        gstPercentage: product.gstPercentage,
        total,
      };
    });
    const subtotal = products.reduce((sum, product) => sum + product.total, 0);
    const gstamount = products.reduce((sum, product) => sum + (product.total * product.gstPercentage) / 100, 0);
    const payload = {
      q_id: editForm.q_id.trim(),
      clientName: editForm.clientName.trim(),
      firmName: editForm.firmName,
      mobile: editForm.mobile,
      email: editForm.email,
      address: editForm.address,
      gstNumber: editForm.gstNumber,
      discount: Number(editForm.discount),
      createdAt: editForm.createdAt,
      termsConditions: editForm.termsConditions,
      products,
      Subtotal: subtotal,
      gstamount,
      grandtotal: subtotal + gstamount,
    };

    setIsSavingEdit(true);
    updateQuotation(editingQuotation._id, payload, {
      onSuccess: () => {
        setEditingQuotation(null);
        setEditForm(null);
        toast.success('Quotation updated successfully.');
        setIsSavingEdit(false);
      },
      onError: () => setIsSavingEdit(false),
    });
  };

  // Quotations store product IDs. Load their current names once per visible page.
  useEffect(() => {
    const ids = [...new Set(
      quotations.flatMap((quotation) => (quotation.products || []).map(getProductId).filter(Boolean))
    )];

    if (ids.length === 0) {
      setProductNamesById({});
      return undefined;
    }

    let cancelled = false;
    fetchProductsByIdsAsync(ids)
      .then((response) => {
        if (cancelled) return;
        const productMap = response?.productMap || response?.data?.productMap || {};
        setProductNamesById(Object.fromEntries(
          Object.entries(productMap).map(([id, product]) => [id, product.name])
        ));
      })
      .catch(() => {
        if (!cancelled) setProductNamesById({});
      });

    return () => { cancelled = true; };
  }, [quotations, fetchProductsByIdsAsync]);

  // ── WhatsApp status check ─────────────────────────────────────────────────
  const { data: wpStatusData } = useWhatsAppStatus({ refetchInterval: 30_000, retry: false });
  const wpReady = wpStatusData?.data?.ready === true;

  // ── Filters ───────────────────────────────────────────────────────────────
  const applyFilters = () => {
    setQuotationFilter({ search, clientName, firmName, from, to, page: 1 });
  };

  const clearFilters = () => {
    setSearch(''); setClientName(''); setFirmName(''); setFrom(''); setTo('');
    setQuotationFilter({ search: '', clientName: '', firmName: '', from: '', to: '', page: 1 });
  };

  // ── Fetch product details and attach to quotation products ──────────────
  const enrichQuotationWithProducts = async (quotation) => {
    const ids = [...new Set(
      quotation.products
        .map(getProductId)
        .filter(Boolean)
    )];
    if (ids.length === 0) return quotation;
    const res        = await fetchProductsByIds.mutateAsync(ids);
    const productMap = res?.productMap || res?.data?.productMap || {};
    return {
      ...quotation,
      products: quotation.products.map((qp) => ({
        ...qp,
        productDetails: productMap[getProductId(qp)] || {},
      })),
    };
  };

  // ── Download PDF ──────────────────────────────────────────────────────────
  const handleDownload = async (quotation) => {
    const toastId = toast.loading('Generating PDF...');
    try {
      const enriched = await enrichQuotationWithProducts(quotation);
      await generateQuotationPDF(enriched, defaultColumns, 'download');
      toast.success('PDF downloaded successfully', { id: toastId });
    } catch (err) {
      console.error('[DOWNLOAD ERROR]', err);
      toast.error('Failed to generate PDF', { id: toastId });
    }
  };

  // ── Share via WhatsApp backend ─────────────────────────────────────────────
  const handleShare = async (quotation) => {
    if (!wpReady) {
      toast.error('WhatsApp is not connected. Please check server status.');
      return;
    }

    const mobile = quotation.mobile || quotation.contact;
    if (!mobile) {
      toast.error('No mobile number found on this quotation.');
      return;
    }

    setSharingId(quotation._id);

    const toastId = toast.loading('Generating & sending PDF...');
    try {
      const enriched   = await enrichQuotationWithProducts(quotation);
      const base64PDF  = await generateQuotationPDFAsBase64(enriched, defaultColumns);
      const formatted  = String(mobile).replace(/\D/g, '');
      const withCountry = formatted.startsWith('91') ? formatted : `91${formatted}`;
      const caption =
        `*Quotation ${quotation.q_id}*\n\n` +
        `Client : ${quotation.clientName}\n` +
        `Firm   : ${quotation.firmName}\n` +
        `Total  : ₹${quotation.grandtotal?.toFixed(2)}\n\n` +
        `Please find your quotation PDF attached.\n\n- Mahaveer Hospitality`;
      await sendWhatsAppQuotation.mutateAsync({ to: withCountry, caption, pdf: base64PDF });
      toast.success(`Quotation sent to ${quotation.clientName} on WhatsApp ✅`, { id: toastId });
    } catch (err) {
      console.error('[SHARE ERROR]', err);
      const msg = err?.response?.data?.message || 'Failed to send quotation on WhatsApp.';
      toast.error(msg, { id: toastId });
    } finally {
      setSharingId(null);
    }
  };

  // ── Empty state ───────────────────────────────────────────────────────────
  if (!quotationsLoading && quotations.length === 0 && !isAdmin) {
    return (
      <div className="text-center py-12">
        <FileText className="w-12 h-12 sm:w-16 sm:h-16 text-muted mx-auto mb-4" />
        <h3 className="mb-2 text-muted-foreground text-base sm:text-lg">No Quotations Yet</h3>
        <p className="text-muted-foreground text-sm">Create your first quotation from the catalog</p>
      </div>
    );
  }

  return (
    <div>
      {/* ── Header with WhatsApp status indicator ──────────────────────────── */}
      <div className="flex items-center justify-between mb-4 sm:mb-6">
        <h2 className="text-foreground text-lg sm:text-xl">Quotations</h2>
        <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border ${
          wpReady
            ? 'bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800'
            : 'bg-red-50 text-red-600 border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800'
        }`}>
          {wpReady
            ? <><Wifi className="w-3 h-3" /> WhatsApp Connected</>
            : <><WifiOff className="w-3 h-3" /> WhatsApp Offline</>
          }
        </div>
      </div>

      {/* ── Filters — admin only ───────────────────────────────────────────── */}
      {isAdmin && (
        <div className="bg-card border border-border dark:border-primary/20 rounded-lg p-4 mb-6 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <div className="relative lg:col-span-3">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text" value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
                placeholder="Search by ID, client, firm, email, mobile..."
                className="w-full pl-9 pr-4 py-2 bg-background border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring text-foreground dark:border-primary/20"
              />
            </div>
            <input type="text" value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="Filter by client name"
              className="w-full px-3 py-2 bg-background border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring text-foreground dark:border-primary/20" />
            <input type="text" value={firmName} onChange={(e) => setFirmName(e.target.value)} placeholder="Filter by firm name"
              className="w-full px-3 py-2 bg-background border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring text-foreground dark:border-primary/20" />
            <div className="flex gap-2">
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
                className="flex-1 px-3 py-2 bg-background border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring text-foreground dark:border-primary/20" />
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
                className="flex-1 px-3 py-2 bg-background border border-border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring text-foreground dark:border-primary/20" />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={clearFilters} className="px-4 py-2 border border-border text-foreground rounded-lg text-sm hover:bg-muted transition-all">Clear</button>
            <button onClick={applyFilters} className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm hover:bg-primary/90 transition-all">Search</button>
          </div>
        </div>
      )}

      {/* ── Loading ──────────────────────────────────────────────────────────── */}
      {quotationsLoading && (
        <div className="text-center py-12 text-muted-foreground text-sm">Loading quotations...</div>
      )}

      {/* ── Empty ────────────────────────────────────────────────────────────── */}
      {!quotationsLoading && quotations.length === 0 && (
        <div className="text-center py-12">
          <FileText className="w-12 h-12 sm:w-16 sm:h-16 text-muted mx-auto mb-4" />
          <h3 className="mb-2 text-muted-foreground">No Quotations Found</h3>
          <p className="text-muted-foreground text-sm">Try adjusting your filters</p>
        </div>
      )}

      {/* ── Quotation cards ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 sm:gap-6">
        {quotations.map((quotation) => {
          const isSharing = sharingId === quotation._id;
          const mobile    = quotation.mobile || quotation.contact;
          const quotationId = quotation._id || quotation.q_id;
          const products = quotation.products || [];
          const productsExpanded = expandedQuotationIds.has(quotationId);
          const visibleProducts = productsExpanded ? products : products.slice(0, 3);

          return (
            <div
              key={quotation._id}
              className="bg-card border border-border rounded-lg shadow-md p-4 sm:p-6 dark:border-primary/20"
            >
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4 mb-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <FileText className="w-5 h-5 text-primary flex-shrink-0" />
                    <h3 className="text-foreground dark:text-primary text-base sm:text-lg truncate">{quotation.q_id}</h3>
                  </div>
                  <div className="text-sm text-muted-foreground space-y-1">
                    <p className="truncate"><span className="font-medium">Client :</span> {quotation.clientName}</p>
                    <p className="truncate"><span className="font-medium">Firm   :</span> {quotation.firmName}</p>
                    {mobile && (
                      <p><span className="font-medium">Mobile :</span> {mobile}</p>
                    )}
                    <p><span className="font-medium">Date   :</span> {new Date(quotation.createdAt).toLocaleDateString('en-IN')}</p>
                  </div>
                </div>

                <div className="flex flex-col items-start sm:items-end gap-2">
                  <div className="text-base sm:text-lg text-foreground dark:text-primary">
                    <span className="text-sm text-muted-foreground">Total: </span>
                    <span className="font-medium">₹{quotation.grandtotal?.toFixed(2)}</span>
                  </div>

                  <div className="flex gap-2 w-full sm:w-auto">
                    {isAdmin && (
                      <button
                        onClick={() => handleEditQuotation(quotation)}
                        className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-3 sm:px-4 py-2 border border-border text-foreground rounded-lg hover:bg-muted transition-all text-sm"
                      >
                        <Pencil className="w-4 h-4" />
                        <span>Edit</span>
                      </button>
                    )}
                    {/* Download */}
                    <button
                      onClick={() => handleDownload(quotation)}
                      className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-3 sm:px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-all text-sm"
                    >
                      <Download className="w-4 h-4" />
                      <span className="hidden sm:inline">Download</span>
                    </button>

                    {/* Share via WhatsApp */}
                    <button
                      onClick={() => handleShare(quotation)}
                      disabled={isSharing || !wpReady || !mobile}
                      title={
                        !mobile    ? 'No mobile number on this quotation' :
                        !wpReady   ? 'WhatsApp not connected' :
                        'Send PDF on WhatsApp'
                      }
                      className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-3 sm:px-4 py-2 rounded-lg transition-all text-sm border ${
                        wpReady && mobile && !isSharing
                          ? 'bg-green-600 hover:bg-green-700 text-white border-green-600'
                          : 'bg-muted text-muted-foreground border-border cursor-not-allowed opacity-60'
                      }`}
                    >
                      {isSharing
                        ? <Loader2 className="w-4 h-4 animate-spin" />
                        : <Share2 className="w-4 h-4" />
                      }
                      <span className="hidden sm:inline">
                        {isSharing ? 'Sending...' : 'Share'}
                      </span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Products preview */}
              <div className="border-t border-border dark:border-primary/20 pt-3 sm:pt-4">
                <p className="text-sm text-muted-foreground mb-2">Products: {products.length} item(s)</p>
                <div className={`space-y-2 ${productsExpanded ? '' : 'max-h-48 overflow-y-auto'}`}>
                  {visibleProducts.map((qp, index) => (
                    <div key={index} className="flex items-center gap-2 sm:gap-3 text-xs sm:text-sm">
                      <div className="flex-1 min-w-0">
                        <p className="text-foreground truncate">
                        Product: {qp.productName || productNamesById[getProductId(qp)] || qp.productDetails?.name || qp.product_id?.name || 'Product unavailable'}
                        </p>
                        <p className="text-muted-foreground">
                          {qp.size} • Qty: {qp.quatity} • ₹{qp.finalPrice?.toFixed(2)}
                        </p>
                      </div>
                    </div>
                  ))}
                  {products.length > 3 && (
                    <button
                      type="button"
                      onClick={() => toggleProducts(quotationId)}
                      aria-expanded={productsExpanded}
                      className="w-full pt-2 text-center text-xs text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded"
                    >
                      {productsExpanded ? 'Show fewer items' : `+${products.length - 3} more items`}
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {isAdmin && editingQuotation && editForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-6">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-quotation-title"
            className="flex max-h-full w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-border bg-card shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-border p-4 sm:p-5">
              <div>
                <h2 id="edit-quotation-title" className="text-lg font-medium text-foreground">Edit quotation</h2>
                <p className="text-sm text-muted-foreground">Update all saved quotation details and line-item pricing.</p>
              </div>
              <button
                type="button"
                onClick={() => { setEditingQuotation(null); setEditForm(null); }}
                aria-label="Close quotation editor"
                className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-5 overflow-y-auto p-4 sm:p-5">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {[
                  ['q_id', 'Quotation number'],
                  ['clientName', 'Client name'],
                  ['firmName', 'Firm name'],
                  ['mobile', 'Mobile'],
                  ['email', 'Email'],
                  ['address', 'Address'],
                  ['gstNumber', 'GST number'],
                  ['discount', 'Global discount (%)'],
                ].map(([field, label]) => (
                  <label key={field} className="block text-sm text-muted-foreground">
                    {label}
                    <input
                      type={field === 'discount' ? 'number' : 'text'}
                      min={field === 'discount' ? 0 : undefined}
                      max={field === 'discount' ? 100 : undefined}
                      value={editForm[field]}
                      onChange={(event) => setEditForm((previous) => ({ ...previous, [field]: event.target.value }))}
                      className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                  </label>
                ))}
                <label className="block text-sm text-muted-foreground">
                  Quotation date
                  <input
                    type="date"
                    value={editForm.createdAt}
                    onChange={(event) => setEditForm((previous) => ({ ...previous, createdAt: event.target.value }))}
                    className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </label>
              </div>

              <section className="rounded-md border border-border p-3">
                <h3 className="mb-3 font-medium text-foreground">Terms and conditions</h3>
                <div className="space-y-2">
                  {DEFAULT_QUOTATION_TERMS.slice(0, 5).map((term, index) => (
                    <label key={term.id} className="flex items-start gap-2 text-sm text-foreground">
                      <input
                        type="checkbox"
                        checked={editForm.termsConditions.selected.includes(term.id)}
                        onChange={(event) => setEditForm((previous) => ({
                          ...previous,
                          termsConditions: {
                            ...previous.termsConditions,
                            selected: event.target.checked
                              ? [...previous.termsConditions.selected, term.id]
                              : previous.termsConditions.selected.filter((id) => id !== term.id),
                          },
                        }))}
                        className="mt-1 accent-primary"
                      />
                      <span>{index + 1}. {term.text}</span>
                    </label>
                  ))}
                  <div className="flex items-start gap-2 text-sm text-foreground">
                    <input
                      type="checkbox"
                      checked={editForm.termsConditions.selected.includes('paymentTerms')}
                      onChange={(event) => setEditForm((previous) => ({
                        ...previous,
                        termsConditions: {
                          ...previous.termsConditions,
                          selected: event.target.checked
                            ? [...previous.termsConditions.selected, 'paymentTerms']
                            : previous.termsConditions.selected.filter((id) => id !== 'paymentTerms'),
                        },
                      }))}
                      className="mt-1 accent-primary"
                    />
                    <div className="flex-1">
                      <label htmlFor="edit-quotation-payment-terms">6. Payment terms</label>
                      <textarea
                        id="edit-quotation-payment-terms"
                        value={editForm.termsConditions.paymentTerms}
                        onChange={(event) => setEditForm((previous) => ({
                          ...previous,
                          termsConditions: { ...previous.termsConditions, paymentTerms: event.target.value },
                        }))}
                        placeholder="Enter customized payment terms"
                        rows={3}
                        className="mt-1 w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                    </div>
                  </div>
                  {DEFAULT_QUOTATION_TERMS.slice(5).map((term, index) => (
                    <label key={term.id} className="flex items-start gap-2 text-sm text-foreground">
                      <input
                        type="checkbox"
                        checked={editForm.termsConditions.selected.includes(term.id)}
                        onChange={(event) => setEditForm((previous) => ({
                          ...previous,
                          termsConditions: {
                            ...previous.termsConditions,
                            selected: event.target.checked
                              ? [...previous.termsConditions.selected, term.id]
                              : previous.termsConditions.selected.filter((id) => id !== term.id),
                          },
                        }))}
                        className="mt-1 accent-primary"
                      />
                      <span>{index + 7}. {term.text}</span>
                    </label>
                  ))}
                </div>
              </section>

              <div>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-medium text-foreground">Products and pricing</h3>
                  <button
                    type="button"
                    onClick={() => {
                      setShowAddProduct((previous) => !previous);
                      setProductSearch('');
                      setSelectedProduct(null);
                      setSelectedSkuIndex('');
                    }}
                    className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-foreground hover:bg-muted"
                  >
                    <Plus className="h-4 w-4" />
                    {showAddProduct ? 'Close product search' : 'Add product'}
                  </button>
                </div>

                {showAddProduct && (
                  <div className="mb-4 space-y-3 rounded-md border border-border bg-background p-3">
                    <label className="block text-sm text-muted-foreground">
                      Search products
                      <div className="relative mt-1">
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <input
                          type="search"
                          value={productSearch}
                          onChange={(event) => {
                            setProductSearch(event.target.value);
                            setSelectedProduct(null);
                            setSelectedSkuIndex('');
                          }}
                          placeholder="Type at least 2 characters..."
                          className="w-full rounded-md border border-border bg-card py-2 pl-9 pr-3 text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                        />
                      </div>
                    </label>

                    {productSearch.trim().length >= 2 && (
                      <div className="max-h-48 space-y-1 overflow-y-auto">
                        {isSearchingProducts && (
                          <p className="p-2 text-sm text-muted-foreground">Searching products...</p>
                        )}
                        {productSearchFailed && (
                          <p className="p-2 text-sm text-destructive">Could not load product suggestions.</p>
                        )}
                        {!isSearchingProducts && !productSearchFailed && productSuggestions.length === 0 && (
                          <p className="p-2 text-sm text-muted-foreground">No matching products found.</p>
                        )}
                        {productSuggestions.map((product) => (
                          <button
                            key={product._id}
                            type="button"
                            onClick={() => {
                              setSelectedProduct(product);
                              setSelectedSkuIndex('');
                            }}
                            className={`flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors ${
                              selectedProduct?._id === product._id
                                ? 'bg-primary/10 text-foreground'
                                : 'text-foreground hover:bg-muted'
                            }`}
                          >
                            <span className="truncate font-medium">{product.name}</span>
                            <span className="shrink-0 text-xs text-muted-foreground">
                              {product.sku?.length || 0} SKU{product.sku?.length === 1 ? '' : 's'}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}

                    {selectedProduct && (
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <label className="flex-1 text-sm text-muted-foreground">
                          Select SKU / size for {selectedProduct.name}
                          <select
                            value={selectedSkuIndex}
                            onChange={(event) => setSelectedSkuIndex(event.target.value)}
                            className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                          >
                            <option value="">Choose a size...</option>
                            {(selectedProduct.sku || []).map((sku, index) => (
                              <option key={`${sku.size}-${index}`} value={index}>
                                {sku.size} — MRP ₹{Number(sku.mrp || 0).toFixed(2)}
                              </option>
                            ))}
                          </select>
                        </label>
                        <button
                          type="button"
                          onClick={addSelectedSkuToQuotation}
                          disabled={selectedSkuIndex === ''}
                          className="self-end rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Add selected SKU
                        </button>
                      </div>
                    )}
                  </div>
                )}

                <div className="space-y-3">
                  {editForm.products.map((product, index) => (
                    <div key={`${product.productId}-${index}`} className="rounded-md border border-border p-3">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-medium text-foreground">{product.productName}</p>
                          <p className="text-xs text-muted-foreground">Quotation product name</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setEditForm((previous) => ({
                            ...previous,
                            products: previous.products.filter((_, productIndex) => productIndex !== index),
                          }))}
                          aria-label={`Remove ${product.productName} from quotation`}
                          className="rounded-md p-2 text-destructive hover:bg-destructive/10"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                      <label className="mb-3 block text-xs text-muted-foreground">
                        Product name
                        <input
                          type="text"
                          value={product.productName}
                          onChange={(event) => updateEditProduct(index, 'productName', event.target.value)}
                          className="mt-1 w-full rounded-md border border-border bg-background px-2 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                        />
                      </label>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                        {[
                          ['size', 'Size', 'text'],
                          ['innerPack', 'Inner pack', 'number'],
                          ['masterPack', 'Master pack', 'number'],
                          ['quantity', 'Quantity', 'number'],
                          ['mrp', 'MRP', 'number'],
                          ['discount', 'Discount (%)', 'number'],
                          ['finalPrice', 'Final price', 'number'],
                          ['gstPercentage', 'GST (%)', 'number'],
                        ].map(([field, label, type]) => (
                          <label key={field} className="block text-xs text-muted-foreground">
                            {label}
                            <input
                              type={type}
                              min={type === 'number' ? (['innerPack', 'masterPack', 'quantity'].includes(field) ? 1 : 0) : undefined}
                              max={field === 'discount' ? 100 : undefined}
                              step={type === 'number' ? 'any' : undefined}
                              value={product[field]}
                              onChange={(event) => updateEditProduct(
                                index,
                                field,
                                type === 'number' ? Number(event.target.value) : event.target.value,
                              )}
                              className="mt-1 w-full rounded-md border border-border bg-background px-2 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                            />
                          </label>
                        ))}
                      </div>
                      <p className="mt-3 text-right text-sm text-muted-foreground">
                        Line total: ₹{(product.innerPack * product.quantity * product.finalPrice).toFixed(2)}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              {(() => {
                const subtotal = editForm.products.reduce(
                  (sum, product) => sum + product.innerPack * product.quantity * product.finalPrice,
                  0,
                );
                const gstamount = editForm.products.reduce(
                  (sum, product) => sum + (product.innerPack * product.quantity * product.finalPrice * product.gstPercentage) / 100,
                  0,
                );
                return (
                  <div className="space-y-1 border-t border-border pt-3 text-right text-sm text-muted-foreground">
                    <p>Subtotal: ₹{subtotal.toFixed(2)}</p>
                    <p>GST: ₹{gstamount.toFixed(2)}</p>
                    <p className="font-medium text-foreground">Grand total: ₹{(subtotal + gstamount).toFixed(2)}</p>
                  </div>
                );
              })()}
            </div>

            <div className="flex justify-end gap-2 border-t border-border p-4 sm:p-5">
              <button
                type="button"
                onClick={() => { setEditingQuotation(null); setEditForm(null); }}
                className="rounded-md border border-border px-4 py-2 text-sm text-foreground hover:bg-muted"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveQuotation}
                disabled={isSavingEdit}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Save className="h-4 w-4" />
                {isSavingEdit ? 'Saving...' : 'Save changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Pagination ────────────────────────────────────────────────────────── */}
      {isAdmin && quotationPages > 1 && (
        <div className="flex items-center justify-between mt-6">
          <p className="text-sm text-muted-foreground">
            Total: {quotationTotal} quotation{quotationTotal !== 1 ? 's' : ''}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setQuotationFilter({ page: quotationParams.page - 1 })}
              disabled={quotationParams.page <= 1}
              className="p-2 border border-border rounded-lg text-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-all dark:border-primary/20"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-sm text-foreground px-2">
              {quotationParams.page} / {quotationPages}
            </span>
            <button
              onClick={() => setQuotationFilter({ page: quotationParams.page + 1 })}
              disabled={quotationParams.page >= quotationPages}
              className="p-2 border border-border rounded-lg text-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-all dark:border-primary/20"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
