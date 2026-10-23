import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import { Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { generateQuotationPDF } from '../utils/pdfGenerator';
import { useFetchProductsByIds } from '../../hooks/useProducts';
import { DEFAULT_QUOTATION_TERMS, DEFAULT_SELECTED_QUOTATION_TERMS } from '../utils/quotationTerms';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL_IMG || '';

export default function QuotationBuilder({ selectedProductsWithSizes, onComplete, onCancel }) {
  const { user }                     = useAuth();
  const { addQuotation }             = useData();
  const fetchProductsByIds = useFetchProductsByIds();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [clientName, setClientName]   = useState('');
  const [firmName, setFirmName]       = useState('');
  const [contact, setContact]         = useState('');
  const [email, setEmail]             = useState('');
  const [address, setAddress]         = useState('');
  const [gstNumber, setGstNumber]     = useState('');
  const [discount, setDiscount]       = useState(0);
  const [selectedTerms, setSelectedTerms] = useState(DEFAULT_SELECTED_QUOTATION_TERMS);
  const [paymentTerms, setPaymentTerms] = useState('');
  const [showColumnDialog, setShowColumnDialog] = useState(false);

  const [selectedColumns, setSelectedColumns] = useState({
    product     : true,
    size        : true,
    innerPack   : true,
    masterCarton: true,
    quantity    : true,
    totalPieces : true,
    mrp         : true,
    discount    : true,
    finalPrice  : true,
    gst         : true,
    total       : true,
  });

  // ── Build initial quotation items from selected products ──────────────────
  const [quotationProducts, setQuotationProducts] = useState(() => {
    const items = [];
    selectedProductsWithSizes.forEach(({ product, selectedSizes }) => {
      selectedSizes.forEach((size) => {
        // backend uses product.sku not product.sizes
        const sizeData = (product.sku || product.sizes || []).find((s) => s.size === size);
        if (sizeData) {
          items.push({
            productId      : product._id || product.id,
            product,
            size,
            innerPack      : sizeData.innerPack  || 1,
            masterPack     : sizeData.masterPack || 1,
            quantity       : 1,
            mrp            : sizeData.mrp,
            productDiscount: 0,
            finalPrice     : sizeData.mrp,
            isNetRate      : false,
          });
        }
      });
    });
    return items;
  });

  // ── Row handlers ──────────────────────────────────────────────────────────
  const handleSizeChange = (index, size) => {
    const rows    = [...quotationProducts];
    // use sku or sizes — whichever exists
    const skuList = rows[index].product.sku || rows[index].product.sizes || [];
    const sizeData = skuList.find((s) => s.size === size);
    if (sizeData) {
      const disc = rows[index].isNetRate ? 0 : rows[index].productDiscount;
      rows[index] = {
        ...rows[index],
        size,
        mrp       : sizeData.mrp,
        innerPack : sizeData.innerPack  || rows[index].innerPack,
        masterPack: sizeData.masterPack || rows[index].masterPack,
        finalPrice: sizeData.mrp - (sizeData.mrp * disc) / 100,
      };
    }
    setQuotationProducts(rows);
  };

  const handleInnerPackChange = (index, val) => {
    const rows = [...quotationProducts];
    rows[index].innerPack = Math.max(1, val);
    setQuotationProducts(rows);
  };

  const handleQuantityChange = (index, val) => {
    const rows = [...quotationProducts];
    rows[index].quantity = Math.max(1, val);
    setQuotationProducts(rows);
  };

  const handleProductDiscountChange = (index, val) => {
    const rows = [...quotationProducts];
    if (rows[index].isNetRate) return;
    const disc = Math.max(0, Math.min(100, val));
    rows[index].productDiscount = disc;
    rows[index].finalPrice = rows[index].mrp - (rows[index].mrp * disc) / 100;
    setQuotationProducts(rows);
  };

  const handleNetRateToggle = (index, checked) => {
    setQuotationProducts((previous) => previous.map((qp, rowIndex) => {
      if (rowIndex !== index) return qp;
      if (checked) return { ...qp, isNetRate: true, productDiscount: 0, finalPrice: qp.mrp };
      return {
        ...qp,
        isNetRate: false,
        productDiscount: discount,
        finalPrice: qp.mrp - (qp.mrp * discount) / 100,
      };
    }));
  };

  const handleNetRateChange = (index, val) => {
    const netRate = Math.max(0, Number.isFinite(val) ? val : 0);
    setQuotationProducts((previous) => previous.map((qp, rowIndex) =>
      rowIndex === index ? { ...qp, finalPrice: netRate } : qp
    ));
  };

  const handleDiscountChange = (val) => {
    const disc = Math.max(0, Math.min(100, val));
    setDiscount(disc);
    setQuotationProducts((prev) =>
      prev.map((qp) => ({
        ...qp,
        productDiscount: qp.isNetRate ? 0 : disc,
        // A manually entered net rate is final and never receives a global discount.
        finalPrice     : qp.isNetRate ? qp.finalPrice : qp.mrp - (qp.mrp * disc) / 100,
      }))
    );
  };

  const removeProduct = (index) => {
    setQuotationProducts((prev) => prev.filter((_, i) => i !== index));
  };

  // ── Totals ────────────────────────────────────────────────────────────────
  const calculateTotals = () => {
    let subtotal = 0;
    let gstAmount = 0;
    quotationProducts.forEach((qp) => {
      const itemTotal = qp.innerPack * qp.quantity * qp.finalPrice;
      subtotal  += itemTotal;
      // backend field is gstPercentage not gstPercent
      const gstPct = qp.product.gstPercentage ?? qp.product.gstPercent ?? 0;
      gstAmount += (itemTotal * gstPct) / 100;
    });
    return { subtotal, gstAmount, grandTotal: subtotal + gstAmount };
  };

  // ── Generate — open column picker first ───────────────────────────────────
  const handleGenerate = () => {
    if (!clientName || !firmName || !contact) {
      toast.error('Please fill in client name, firm name and contact.');
      return;
    }
    if (quotationProducts.length === 0) {
      toast.error('Please add at least one product.');
      return;
    }
    if (selectedTerms.includes('paymentTerms') && !paymentTerms.trim()) {
      toast.error('Enter the customized payment terms or uncheck that condition.');
      return;
    }
    setShowColumnDialog(true);
  };

  // ── Confirm — save + download PDF ─────────────────────────────────────────
  const handleConfirmGenerate = async () => {
    const { subtotal, gstAmount, grandTotal } = calculateTotals();

    const payload = {
      clientName,
      firmName,
      mobile    : contact,
      email,
      address,
      gstNumber,
      discount,
      termsConditions: { selected: selectedTerms, paymentTerms },
      products  : quotationProducts.map((qp) => ({
        product_id : qp.productId,
        productName: qp.product.name,
        size       : qp.size,
        innerPack  : qp.innerPack,
        masterPack : qp.masterPack,
        quatity    : qp.quantity,
        totalpcs   : qp.innerPack * qp.quantity,
        cartoon    : Number(((1 / (qp.masterPack / qp.innerPack)) * qp.quantity).toFixed(2)),
        mrp        : qp.mrp,
        discount   : qp.isNetRate ? 0 : qp.productDiscount,
        finalPrice : qp.finalPrice,
        total      : qp.innerPack * qp.quantity * qp.finalPrice,
        gstPercentage: qp.product.gstPercentage ?? qp.product.gstPercent ?? 0,
      })),
      Subtotal  : subtotal,
      gstamount : gstAmount,
      grandtotal: grandTotal,
    };

    setIsSubmitting(true);

    addQuotation(payload, {
      onSuccess: async (res) => {
        // The API service returns the response body directly.
        const savedQuotation = res?.data || res?.data?.data;

        // fetch full product details (with images) for PDF
        const productIds = quotationProducts.map((qp) => qp.productId).filter(Boolean);
        let productMap   = {};
        if (productIds.length > 0) {
          try {
            const pRes   = await fetchProductsByIds.mutateAsync(productIds);
            productMap   = pRes?.productMap || pRes?.data?.productMap || {};
          } catch { /* skip if fails — PDF will just have no images */ }
        }

        // attach productDetails to each row
        const productsWithDetails = quotationProducts.map((qp) => ({
          ...qp,
          product_id    : qp.productId,
          quatity       : qp.quantity,
          productDetails: productMap[qp.productId?.toString()] || {},
        }));

        const quotationForPDF = {
          quotationNumber: savedQuotation?.q_id || 'MH-??????',
          date           : new Date().toISOString(),
          clientName,
          firmName,
          contact,
          email,
          address,
          gstNumber,
          products       : productsWithDetails,
          discount,
          subtotal,
          gstAmount,
          grandTotal,
          createdBy      : user?.fullName || 'Unknown',
          termsConditions: { selected: selectedTerms, paymentTerms },
        };

        await generateQuotationPDF(quotationForPDF, selectedColumns, 'download');
        setShowColumnDialog(false);
        setIsSubmitting(false);
        toast.success('Quotation generated successfully');
        onComplete();
      },
      onError: () => {
        setIsSubmitting(false);
      },
    });
  };

  const toggleColumn = (col) =>
    setSelectedColumns((prev) => ({ ...prev, [col]: !prev[col] }));

  const { subtotal, gstAmount, grandTotal } = calculateTotals();

  const inputCls = 'w-full px-3 py-2 bg-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring text-foreground dark:border-primary/20 transition-all text-sm';

  return (
    <div className="max-w-5xl mx-auto">
      <div className="bg-card border border-border rounded-lg shadow-md p-4 sm:p-6 mb-6 dark:border-primary/20">
        <h2 className="mb-6 text-foreground dark:text-primary text-lg sm:text-xl">Create Quotation</h2>

        {/* Client Details */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
          <div>
            <label className="block text-sm text-foreground mb-1">Client Name <span className="text-destructive">*</span></label>
            <input type="text" value={clientName} onChange={(e) => setClientName(e.target.value)} className={inputCls} placeholder="Enter client name" />
          </div>
          <div>
            <label className="block text-sm text-foreground mb-1">Firm Name <span className="text-destructive">*</span></label>
            <input type="text" value={firmName} onChange={(e) => setFirmName(e.target.value)} className={inputCls} placeholder="Enter firm name" />
          </div>
          <div>
            <label className="block text-sm text-foreground mb-1">Contact <span className="text-destructive">*</span></label>
            <input type="tel" value={contact} onChange={(e) => setContact(e.target.value)} className={inputCls} placeholder="Enter contact number" />
          </div>
          <div>
            <label className="block text-sm text-foreground mb-1">Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} placeholder="Enter email" />
          </div>
          <div>
            <label className="block text-sm text-foreground mb-1">Address</label>
            <input type="text" value={address} onChange={(e) => setAddress(e.target.value)} className={inputCls} placeholder="Enter address" />
          </div>
          <div>
            <label className="block text-sm text-foreground mb-1">GST Number</label>
            <input type="text" value={gstNumber} onChange={(e) => setGstNumber(e.target.value)} className={inputCls} placeholder="Enter GST number" />
          </div>
        </div>

        {/* Global Discount */}
        <div className="mb-6">
          <label className="block text-sm text-foreground mb-1">Global Discount (%)</label>
          <input type="number" value={discount} onChange={(e) => handleDiscountChange(Number(e.target.value))} className={`${inputCls} sm:w-48`} min="0" max="100" placeholder="0" />
        </div>

        {/* Products Table */}
        <div className="mb-6">
          <h3 className="mb-4 text-foreground text-base sm:text-lg">Products</h3>

          {/* Mobile cards */}
          <div className="block lg:hidden space-y-4">
            {quotationProducts.map((qp, index) => {
              const skuList = qp.product.sku || qp.product.sizes || [];
              return (
                <div key={index} className="border border-border dark:border-primary/20 rounded-lg p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      {qp.product.img ? (
                        <img src={`${BACKEND_URL}${qp.product.img}`} alt={qp.product.name} className="w-14 h-14 object-contain rounded flex-shrink-0" />
                      ) : (
                        <div className="w-14 h-14 bg-muted rounded flex-shrink-0" />
                      )}
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{qp.product.name}</p>
                        <p className="text-xs text-muted-foreground">MRP: ₹{qp.mrp}</p>
                      </div>
                    </div>
                    <button onClick={() => removeProduct(index)} className="p-1.5 text-destructive hover:bg-destructive/10 rounded flex-shrink-0">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1">Size</label>
                      <select value={qp.size} onChange={(e) => handleSizeChange(index, e.target.value)} className="w-full px-2 py-1.5 bg-background border border-border rounded text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring">
                        {skuList.map((s) => <option key={s.size} value={s.size}>{s.size}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1">Inner Pack</label>
                      <input type="number" value={qp.innerPack} onChange={(e) => handleInnerPackChange(index, Number(e.target.value))} className="w-full px-2 py-1.5 bg-background border border-border rounded text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring" min="1" />
                    </div>
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1">Quantity</label>
                      <input type="number" value={qp.quantity} onChange={(e) => handleQuantityChange(index, Number(e.target.value))} className="w-full px-2 py-1.5 bg-background border border-border rounded text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring" min="1" />
                    </div>
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1">Disc %</label>
                      <input type="number" value={qp.productDiscount} onChange={(e) => handleProductDiscountChange(index, Number(e.target.value))} disabled={qp.isNetRate} className="w-full px-2 py-1.5 bg-background border border-border rounded text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50" min="0" max="100" />
                    </div>
                    <label className="col-span-2 flex items-center gap-2 rounded border border-border px-3 py-2 text-sm text-foreground">
                      <input type="checkbox" checked={qp.isNetRate} onChange={(e) => handleNetRateToggle(index, e.target.checked)} className="accent-primary" />
                      Net rate (ignore discounts)
                    </label>
                  </div>
                  <div className="text-sm border-t border-border pt-2 space-y-1">
                    <div className="flex justify-between"><span className="text-muted-foreground">Total Pcs:</span><span>{qp.innerPack * qp.quantity}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Carton:</span><span>{((1 / (qp.masterPack / qp.innerPack)) * qp.quantity).toFixed(2)}</span></div>
                    <div className="flex items-center justify-between gap-3"><span className="text-muted-foreground">{qp.isNetRate ? 'Net Rate:' : 'Final Price:'}</span>{qp.isNetRate ? <input type="number" value={qp.finalPrice} onChange={(e) => handleNetRateChange(index, Number(e.target.value))} className="w-28 rounded border border-border bg-background px-2 py-1 text-right text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring" min="0" step="0.01" /> : <span>₹{qp.finalPrice.toFixed(2)}</span>}</div>
                    <div className="flex justify-between font-medium"><span>Total:</span><span>₹{(qp.innerPack * qp.quantity * qp.finalPrice).toFixed(2)}</span></div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Desktop table */}
          <div className="hidden lg:block overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-3 px-2 text-foreground">Product</th>
                  <th className="text-left py-3 px-2 text-foreground">Size</th>
                  <th className="text-left py-3 px-2 text-foreground">Inner</th>
                  <th className="text-left py-3 px-2 text-foreground">Qty</th>
                  <th className="text-left py-3 px-2 text-foreground">Total Pcs</th>
                  <th className="text-left py-3 px-2 text-foreground">Carton</th>
                  <th className="text-left py-3 px-2 text-foreground">MRP</th>
                  <th className="text-left py-3 px-2 text-foreground">Net Rate</th>
                  <th className="text-left py-3 px-2 text-foreground">Disc %</th>
                  <th className="text-left py-3 px-2 text-foreground">Final Price</th>
                  <th className="text-left py-3 px-2 text-foreground">Total</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {quotationProducts.map((qp, index) => {
                  const skuList = qp.product.sku || qp.product.sizes || [];
                  return (
                    <tr key={index} className="border-b border-border/50">
                      <td className="py-3 px-2">
                        <div className="flex items-center gap-2">
                          {qp.product.img ? (
                            <img src={`${BACKEND_URL}${qp.product.img}`} alt={qp.product.name} className="w-10 h-10 object-contain rounded flex-shrink-0" />
                          ) : (
                            <div className="w-10 h-10 bg-muted rounded flex-shrink-0" />
                          )}
                          <span className="text-foreground">{qp.product.name}</span>
                        </div>
                      </td>
                      <td className="py-3 px-2">
                        <select value={qp.size} onChange={(e) => handleSizeChange(index, e.target.value)} className="px-2 py-1 bg-background border border-border rounded text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring">
                          {skuList.map((s) => <option key={s.size} value={s.size}>{s.size}</option>)}
                        </select>
                      </td>
                      <td className="py-3 px-2">
                        <input type="number" value={qp.innerPack} onChange={(e) => handleInnerPackChange(index, Number(e.target.value))} className="w-16 px-2 py-1 bg-background border border-border rounded text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring" min="1" />
                      </td>
                      <td className="py-3 px-2">
                        <input type="number" value={qp.quantity} onChange={(e) => handleQuantityChange(index, Number(e.target.value))} className="w-16 px-2 py-1 bg-background border border-border rounded text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring" min="1" />
                      </td>
                      <td className="py-3 px-2 text-foreground">{qp.innerPack * qp.quantity}</td>
                      <td className="py-3 px-2 text-foreground">{((1 / (qp.masterPack / qp.innerPack)) * qp.quantity).toFixed(2)}</td>
                      <td className="py-3 px-2 text-muted-foreground">₹{qp.mrp}</td>
                      <td className="py-3 px-2">
                        <label className="flex cursor-pointer items-center gap-2 text-xs text-foreground">
                          <input type="checkbox" checked={qp.isNetRate} onChange={(e) => handleNetRateToggle(index, e.target.checked)} className="h-4 w-4 accent-primary" />
                          Use net rate
                        </label>
                      </td>
                      <td className="py-3 px-2">
                        <input type="number" value={qp.productDiscount} onChange={(e) => handleProductDiscountChange(index, Number(e.target.value))} disabled={qp.isNetRate} className="w-16 px-2 py-1 bg-background border border-border rounded text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50" min="0" max="100" />
                      </td>
                      <td className="py-3 px-2 text-foreground">{qp.isNetRate ? <input type="number" value={qp.finalPrice} onChange={(e) => handleNetRateChange(index, Number(e.target.value))} className="w-20 px-2 py-1 bg-background border border-border rounded text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring" min="0" step="0.01" aria-label={`Net rate for ${qp.product.name}`} /> : <>₹{qp.finalPrice.toFixed(2)}</>}</td>
                      <td className="py-3 px-2 text-foreground font-medium">₹{(qp.innerPack * qp.quantity * qp.finalPrice).toFixed(2)}</td>
                      <td className="py-3 px-2">
                        <button onClick={() => removeProduct(index)} className="p-1.5 text-destructive hover:bg-destructive/10 rounded">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Totals */}
        <div className="border-t border-border pt-4">
          <div className="flex flex-col items-end gap-2 mb-6">
            <div className="flex justify-between w-full md:w-64 text-sm"><span className="text-muted-foreground">Subtotal:</span><span className="text-foreground">₹{subtotal.toFixed(2)}</span></div>
            <div className="flex justify-between w-full md:w-64 text-sm"><span className="text-muted-foreground">GST:</span><span className="text-foreground">₹{gstAmount.toFixed(2)}</span></div>
            <div className="flex justify-between w-full md:w-64 border-t border-border pt-2"><span className="text-foreground font-medium">Grand Total:</span><span className="text-foreground font-medium">₹{grandTotal.toFixed(2)}</span></div>
          </div>
          <section className="mb-6 rounded-lg border border-border p-4">
            <h3 className="mb-3 text-foreground font-medium">Terms and conditions</h3>
            <div className="space-y-2">
              {DEFAULT_QUOTATION_TERMS.slice(0, 5).map((term, index) => (
                <label key={term.id} className="flex items-start gap-2 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={selectedTerms.includes(term.id)}
                    onChange={(event) => setSelectedTerms((previous) =>
                      event.target.checked
                        ? [...previous, term.id]
                        : previous.filter((id) => id !== term.id)
                    )}
                    className="mt-1 accent-primary"
                  />
                  <span>{index + 1}. {term.text}</span>
                </label>
              ))}
              <div className="flex items-start gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={selectedTerms.includes('paymentTerms')}
                  onChange={(event) => setSelectedTerms((previous) =>
                    event.target.checked
                      ? [...previous, 'paymentTerms']
                      : previous.filter((id) => id !== 'paymentTerms')
                  )}
                  className="mt-1 accent-primary"
                />
                <div className="flex-1">
                  <label htmlFor="quotation-payment-terms">6. Payment terms</label>
                  <textarea
                    id="quotation-payment-terms"
                    value={paymentTerms}
                    onChange={(event) => setPaymentTerms(event.target.value)}
                    placeholder="Enter customized payment terms"
                    rows={3}
                    className={`${inputCls} mt-2 resize-y`}
                  />
                </div>
              </div>
              {DEFAULT_QUOTATION_TERMS.slice(5).map((term, index) => (
                <label key={term.id} className="flex items-start gap-2 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={selectedTerms.includes(term.id)}
                    onChange={(event) => setSelectedTerms((previous) =>
                      event.target.checked
                        ? [...previous, term.id]
                        : previous.filter((id) => id !== term.id)
                    )}
                    className="mt-1 accent-primary"
                  />
                  <span>{index + 7}. {term.text}</span>
                </label>
              ))}
            </div>
          </section>
          <div className="flex gap-3 justify-end">
            <button onClick={onCancel} className="px-6 py-2 border border-border text-foreground rounded-lg hover:bg-muted transition-all">Cancel</button>
            <button onClick={handleGenerate} disabled={isSubmitting} className="px-6 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-all disabled:opacity-60">
              {isSubmitting ? 'Saving...' : 'Generate Quotation'}
            </button>
          </div>
        </div>
      </div>

      {/* ── Column picker — plain div instead of Dialog (fixes SlotClone ref error) ── */}
      {showColumnDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-card border border-border rounded-lg shadow-xl p-6 w-full max-w-sm mx-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-foreground font-medium">Select Columns for PDF</h3>
              <button type="button" onClick={() => setShowColumnDialog(false)} className="p-1 hover:bg-muted rounded">
                <X className="w-4 h-4 text-foreground" />
              </button>
            </div>

            <div className="space-y-2 mb-6">
              {Object.keys(selectedColumns).map((col) => (
                <label key={col} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedColumns[col]}
                    onChange={() => toggleColumn(col)}
                    className="h-4 w-4 rounded border-border text-primary focus:ring-ring"
                  />
                  <span className="text-sm text-foreground capitalize">{col.replace(/([A-Z])/g, ' $1')}</span>
                </label>
              ))}
            </div>

            <div className="flex gap-3 justify-end">
              <button onClick={() => setShowColumnDialog(false)} className="px-4 py-2 border border-border text-foreground rounded-lg hover:bg-muted text-sm">Cancel</button>
              <button onClick={handleConfirmGenerate} disabled={isSubmitting} className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 text-sm disabled:opacity-60">
                {isSubmitting ? 'Saving...' : 'Confirm & Download'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
