import { useState } from 'react';
import api from '@/lib/api';
import { generatePdfForInvoice } from '@/lib/pdfGenerator';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import { Plus, Download, Edit, Trash2, Mail, FileText, ArrowRight, CheckCircle, ClipboardList } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

export const Invoices = () => {
  const queryClient = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState(null);
  const [conversionSource, setConversionSource] = useState(null);
  const [isFullAmountPaid, setIsFullAmountPaid] = useState(false);
  const [formData, setFormData] = useState({
    client_id: '',
    invoice_date: new Date().toISOString().split('T')[0],
    due_date: '',
    valid_from: new Date().toISOString().split('T')[0],
    valid_till: '',
    items: [],
    subtotal: 0,
    cgst: 0,
    sgst: 0,
    igst: 0,
    total: 0,
    amount_paid: 0,
    total_due: 0,
    status: 'pending',
    invoice_type: 'invoice',
    is_recurring: false,
    notes: '',
  });
  const [selectedServices, setSelectedServices] = useState([]);

  const getInvoiceTypeLabel = (type) => {
    if (type === 'quotation') return 'Quotation';
    if (type === 'proforma') return 'Proforma';
    if (type === 'sale_receipt') return 'Sale Receipt';
    return 'Invoice';
  };

  const openCreateDialog = (type) => {
    setEditingInvoice(null);
    setConversionSource(null);
    setIsFullAmountPaid(false);
    setFormData((prev) => ({
      ...prev,
      invoice_type: type,
      invoice_date: new Date().toISOString().split('T')[0],
      due_date: '',
      valid_from: new Date().toISOString().split('T')[0],
      valid_till: '',
      amount_paid: 0,
      total_due: 0,
      status: 'pending',
    }));
    setIsDialogOpen(true);
  };

  const openConversionDialog = (invoice) => {
    setEditingInvoice(null);
    setConversionSource(invoice);
    setIsFullAmountPaid(false);
    setFormData({
      client_id: invoice.client_id,
      invoice_date: new Date().toISOString().split('T')[0],
      due_date: '',
      valid_from: invoice.valid_from || invoice.invoice_date || new Date().toISOString().split('T')[0],
      valid_till: invoice.valid_till || invoice.due_date || '',
      items: invoice.items,
      subtotal: invoice.subtotal,
      cgst: invoice.cgst,
      sgst: invoice.sgst,
      igst: invoice.igst,
      total: invoice.total,
      amount_paid: 0,
      total_due: invoice.total,
      status: 'pending',
      invoice_type: 'invoice',
      is_recurring: invoice.is_recurring,
      notes: invoice.notes || '',
    });
    setIsDialogOpen(true);
  };

  const {
    data,
    isLoading: loading,
  } = useQuery({
    queryKey: ['invoices'],
    staleTime: 60000,
    queryFn: async () => {
      const [invoicesRes, clientsRes, servicesRes, settingsRes] = await Promise.all([
        api.get('/invoices'),
        api.get('/clients'),
        api.get('/services'),
        api.get('/settings'),
      ]);

      return {
        invoices: invoicesRes.data,
        clients: clientsRes.data,
        services: servicesRes.data,
        settings: settingsRes.data,
      };
    },
  });

  const allInvoices = data?.invoices ?? [];
  const invoices = allInvoices.filter((invoice) => invoice.invoice_type !== 'sale_receipt');
  const clients = data?.clients ?? [];
  const services = data?.services ?? [];
  const settings = data?.settings ?? null;

  const addServiceToInvoice = (serviceId) => {
    const service = services.find(s => s.id === serviceId);
    if (!service) return;

    let basePrice;
    
    if (service.gst_type === 'included') {
      // GST is included, so extract base price
      // Formula: base = total / (1 + gst_percentage/100)
      basePrice = service.price / (1 + service.gst_percentage / 100);
    } else {
      // GST will be added on top
      basePrice = service.price;
    }

    const newItem = {
      description: service.name,
      quantity: 1,
      rate: basePrice,
      amount: basePrice,
    };

    const newItems = [...formData.items, newItem];
    calculateTotals(newItems);
  };

  const calculateTotals = (items) => {
    const subtotal = items.reduce((sum, item) => sum + item.amount, 0);
    const igst = subtotal * 0.18; // 18% IGST
    const total = subtotal + igst;
    
    setFormData((prev) => {
      const normalizedPaid = isFullAmountPaid ? total : Math.min(Math.max(prev.amount_paid || 0, 0), total);
      const totalDue = Math.max(total - normalizedPaid, 0);
      const nextStatus = prev.invoice_type === 'invoice'
        ? (normalizedPaid >= total ? 'paid' : prev.status === 'paid' ? 'pending' : prev.status)
        : prev.status;
      return { ...prev, items, subtotal, cgst: 0, sgst: 0, igst, total, amount_paid: normalizedPaid, total_due: totalDue, status: nextStatus };
    });
  };

  const handleItemChange = (index, field, value) => {
    const newItems = [...formData.items];
    newItems[index][field] = value;
    
    if (field === 'quantity' || field === 'rate') {
      newItems[index].amount = newItems[index].quantity * newItems[index].rate;
    }
    
    calculateTotals(newItems);
  };

  const removeItem = (index) => {
    const newItems = formData.items.filter((_, i) => i !== index);
    calculateTotals(newItems);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.client_id) {
      toast.error('Please select a client');
      return;
    }
    if (formData.items.length === 0) {
      toast.error('Please add at least one item');
      return;
    }
    
    try {
      const isProforma = formData.invoice_type === 'proforma';
      const normalizedAmountPaid = formData.invoice_type === 'invoice' ? formData.amount_paid : 0;
      const normalizedTotalDue = formData.invoice_type === 'invoice'
        ? Math.max(formData.total - normalizedAmountPaid, 0)
        : 0;
      const normalizedStatus = formData.invoice_type === 'invoice'
        ? (normalizedAmountPaid >= formData.total ? 'paid' : formData.status === 'paid' ? 'pending' : formData.status)
        : formData.status;
      const payload = {
        ...formData,
        invoice_date: isProforma ? formData.valid_from : formData.invoice_date,
        due_date: isProforma ? formData.valid_till : formData.due_date,
        amount_paid: normalizedAmountPaid,
        total_due: normalizedTotalDue,
        status: normalizedStatus,
      };

      if (conversionSource) {
        const conversionPayload = {
          ...payload,
          invoice_type: 'invoice',
          source_proforma_id: conversionSource.id,
          source_proforma_number: conversionSource.invoice_number,
        };
        await api.post('/invoices', conversionPayload);
        toast.success('Proforma converted to invoice successfully');
      } else if (editingInvoice) {
        await api.put(`/invoices/${editingInvoice.id}`, payload);
        toast.success('Invoice updated successfully');
      } else {
        await api.post('/invoices', payload);
        const typeLabel = formData.invoice_type === 'quotation' ? 'Quotation' : formData.invoice_type === 'proforma' ? 'Proforma' : 'Invoice';
        toast.success(`${typeLabel} created successfully`);
      }
      setIsDialogOpen(false);
      resetForm();
      await queryClient.invalidateQueries({ queryKey: ['invoices'] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to save invoice');
    }
  };

  const handleEdit = (invoice) => {
    setEditingInvoice(invoice);
    setFormData({
      client_id: invoice.client_id,
      invoice_date: invoice.invoice_date,
      due_date: invoice.due_date,
      valid_from: invoice.valid_from || invoice.invoice_date,
      valid_till: invoice.valid_till || invoice.due_date,
      items: invoice.items,
      subtotal: invoice.subtotal,
      cgst: invoice.cgst,
      sgst: invoice.sgst,
      igst: invoice.igst,
      total: invoice.total,
      amount_paid: invoice.amount_paid || 0,
      total_due: invoice.total_due || Math.max(Number(invoice.total || 0) - Number(invoice.amount_paid || 0), 0),
      status: invoice.status,
      invoice_type: invoice.invoice_type,
      is_recurring: invoice.is_recurring,
      notes: invoice.notes || '',
    });
    setIsFullAmountPaid(Number(invoice.amount_paid || 0) >= Number(invoice.total || 0));
    setIsDialogOpen(true);
  };

  const handleConvertToInvoice = async (quotationId) => {
    try {
      await api.post(`/invoices/${quotationId}/convert-to-invoice`);
      toast.success('Quotation converted to invoice successfully');
      await queryClient.invalidateQueries({ queryKey: ['invoices'] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
    } catch (error) {
      toast.error('Failed to convert quotation');
    }
  };

  const handleDownloadPDF = async (invoice) => {
    try {
      const client = clients.find(c => c.id === invoice.client_id);
      if (!client || !settings) {
        toast.error('Missing client or settings data');
        return;
      }
      
      const pdf = await generatePdfForInvoice(invoice, client, settings);
      const fileName = invoice.invoice_type === 'sale_receipt'
        ? `Sale-Receipt-${invoice.invoice_number}.pdf`
        : `${invoice.invoice_number}.pdf`;
      pdf.save(fileName);
      toast.success('PDF downloaded successfully');
    } catch (error) {
      console.error('PDF Error:', error);
      toast.error('Failed to generate PDF: ' + error.message);
    }
  };

  const handleMarkAsPaid = async (invoice) => {
    if (!window.confirm(`Mark invoice ${invoice.invoice_number} as paid?`)) return;
    try {
      const paidAmount = Number(invoice.total || 0);
      await api.put(`/invoices/${invoice.id}`, { status: 'paid', amount_paid: paidAmount, total_due: 0, paid_at: new Date().toISOString() });
      toast.success('Invoice marked as paid');
      await queryClient.invalidateQueries({ queryKey: ['invoices'] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to mark invoice as paid');
    }
  };

  const handleSendEmail = async (invoice) => {
    try {
      const response = await api.post(`/invoices/${invoice.id}/send-email`);
      toast.success(response.data.message);
    } catch (error) {
      const detail = error?.response?.data?.detail;
      toast.error(detail || 'Failed to send email');
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Are you sure you want to delete this invoice?')) return;
    try {
      await api.delete(`/invoices/${id}`);
      toast.success('Invoice deleted successfully');
      await queryClient.invalidateQueries({ queryKey: ['invoices'] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
    } catch (error) {
      toast.error('Failed to delete invoice');
    }
  };

  const resetForm = () => {
    setFormData({
      client_id: '',
      invoice_date: new Date().toISOString().split('T')[0],
      due_date: '',
      valid_from: new Date().toISOString().split('T')[0],
      valid_till: '',
      items: [],
      subtotal: 0,
      cgst: 0,
      sgst: 0,
      igst: 0,
      total: 0,
      amount_paid: 0,
      total_due: 0,
      status: 'pending',
      invoice_type: 'invoice',
      is_recurring: false,
      notes: '',
    });
    setEditingInvoice(null);
    setSelectedServices([]);
    setIsFullAmountPaid(false);
    setConversionSource(null);
  };

  if (loading) {
    return (
      <div className="p-8 min-h-screen bg-gray-50">
        <div className="text-gray-600 font-body text-lg">Loading...</div>
      </div>
    );
  }

  return (
    <div className="p-8 min-h-screen bg-gray-50" data-testid="invoices-page">
      <div className="max-w-7xl mx-auto">
        <div className="flex justify-between items-start mb-8">
          <div>
            <h1 className="font-heading font-bold text-4xl text-gray-900 mb-2">
              Invoices, Proforma & Quotations
            </h1>
            <p className="font-body text-gray-600">
              Create and manage invoices, proforma, and quotations
            </p>
          </div>
          <div className="flex gap-3">
            <Button
              data-testid="create-quotation-button"
              onClick={() => openCreateDialog('quotation')}
              className="bg-orange-600 hover:bg-orange-700 text-white font-body font-medium h-11 px-6 transition-all active:scale-95"
            >
              <FileText className="w-5 h-5 mr-2" strokeWidth={1.5} />
              Create Quotation
            </Button>
            <Button
              data-testid="create-proforma-button"
              onClick={() => openCreateDialog('proforma')}
              className="bg-purple-600 hover:bg-purple-700 text-white font-body font-medium h-11 px-6 transition-all active:scale-95"
            >
              <ClipboardList className="w-5 h-5 mr-2" strokeWidth={1.5} />
              Create Proforma
            </Button>
            <Button
              data-testid="create-invoice-button"
              onClick={() => openCreateDialog('invoice')}
              className="bg-blue-600 hover:bg-blue-700 text-white font-body font-medium h-11 px-6 transition-all active:scale-95"
            >
              <Plus className="w-5 h-5 mr-2" strokeWidth={1.5} />
              Create Invoice
            </Button>
          </div>
        </div>

        <Dialog open={isDialogOpen} onOpenChange={(open) => {
          setIsDialogOpen(open);
          if (!open) resetForm();
        }}>
          <DialogContent className="bg-white border border-gray-200 rounded-md max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="font-heading font-bold text-2xl text-gray-900">
                {editingInvoice ? `Edit ${getInvoiceTypeLabel(formData.invoice_type)}` : `Create New ${getInvoiceTypeLabel(formData.invoice_type)}`}
              </DialogTitle>
            </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-6" data-testid="invoice-form">
                <div>
                  <Label className="text-sm font-medium text-gray-700">Client *</Label>
                  <Select
                    value={formData.client_id}
                    onValueChange={(value) => setFormData({ ...formData, client_id: value })}
                  >
                    <SelectTrigger data-testid="client-select" className="mt-1.5 h-11 bg-gray-50 border-gray-300">
                      <SelectValue placeholder="Select client" />
                    </SelectTrigger>
                    <SelectContent className="bg-white border-gray-200">
                      {clients.map((client) => (
                        <SelectItem key={client.id} value={client.id}>
                          {client.name} {client.business_name ? `(${client.business_name})` : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                
                {formData.invoice_type === 'proforma' ? (
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label className="text-sm font-medium text-gray-700">Valid From *</Label>
                      <Input
                        type="date"
                        data-testid="valid-from-input"
                        value={formData.valid_from}
                        onChange={(e) => setFormData({ ...formData, valid_from: e.target.value })}
                        className="mt-1.5 h-11 bg-gray-50 border-gray-300"
                        required
                      />
                    </div>
                    <div>
                      <Label className="text-sm font-medium text-gray-700">Valid Till *</Label>
                      <Input
                        type="date"
                        data-testid="valid-till-input"
                        value={formData.valid_till}
                        onChange={(e) => setFormData({ ...formData, valid_till: e.target.value })}
                        className="mt-1.5 h-11 bg-gray-50 border-gray-300"
                        required
                      />
                    </div>
                  </div>
                ) : (
                  <div className={`grid ${formData.invoice_type === 'invoice' ? 'grid-cols-3' : 'grid-cols-2'} gap-4`}>
                    <div>
                      <Label className="text-sm font-medium text-gray-700">Invoice Date *</Label>
                      <Input
                        type="date"
                        data-testid="invoice-date-input"
                        value={formData.invoice_date}
                        onChange={(e) => setFormData({ ...formData, invoice_date: e.target.value })}
                        className="mt-1.5 h-11 bg-gray-50 border-gray-300"
                        required
                      />
                    </div>
                    <div>
                      <Label className="text-sm font-medium text-gray-700">Due Date *</Label>
                      <Input
                        type="date"
                        data-testid="due-date-input"
                        value={formData.due_date}
                        onChange={(e) => setFormData({ ...formData, due_date: e.target.value })}
                        className="mt-1.5 h-11 bg-gray-50 border-gray-300"
                        required
                      />
                    </div>
                    {formData.invoice_type === 'invoice' && (
                      <div>
                        <Label className="text-sm font-medium text-gray-700">Status</Label>
                        <Select
                          value={formData.status}
                          onValueChange={(value) => {
                            if (value === 'paid') {
                              setIsFullAmountPaid(true);
                              setFormData((prev) => ({ ...prev, status: value, amount_paid: prev.total, total_due: 0 }));
                              return;
                            }
                            setIsFullAmountPaid(false);
                            setFormData((prev) => {
                              const amountPaid = Math.min(prev.amount_paid || 0, prev.total);
                              const totalDue = Math.max(prev.total - amountPaid, 0);
                              return { ...prev, status: value, amount_paid: amountPaid, total_due: totalDue };
                            });
                          }}
                        >
                          <SelectTrigger className="mt-1.5 h-11 bg-gray-50 border-gray-300">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="bg-white border-gray-200">
                            <SelectItem value="pending">Pending</SelectItem>
                            <SelectItem value="paid">Paid</SelectItem>
                            <SelectItem value="overdue">Overdue</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>
                )}

                <div>
                  <Label className="text-sm font-medium text-gray-700 mb-2 block">Add Services</Label>
                  <Select onValueChange={addServiceToInvoice}>
                    <SelectTrigger className="h-11 bg-gray-50 border-gray-300">
                      <SelectValue placeholder="Select a service to add" />
                    </SelectTrigger>
                    <SelectContent className="bg-white border-gray-200">
                      {services.map((service) => (
                        <SelectItem key={service.id} value={service.id}>
                          {service.name} - ₹{service.price.toFixed(2)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label className="text-sm font-medium text-gray-700 mb-2 block">Items *</Label>
                  {formData.items.map((item, index) => (
                    <div key={index} className="flex gap-2 mb-2">
                      <Input
                        placeholder="Description"
                        data-testid={`item-description-${index}`}
                        value={item.description}
                        onChange={(e) => handleItemChange(index, 'description', e.target.value)}
                        className="flex-1 h-10 bg-gray-50 border-gray-300"
                      />
                      <Input
                        type="number"
                        placeholder="Qty"
                        data-testid={`item-quantity-${index}`}
                        value={item.quantity}
                        onChange={(e) => handleItemChange(index, 'quantity', parseFloat(e.target.value) || 0)}
                        className="w-20 h-10 bg-gray-50 border-gray-300"
                      />
                      <Input
                        type="number"
                        placeholder="Rate"
                        data-testid={`item-rate-${index}`}
                        value={item.rate}
                        onChange={(e) => handleItemChange(index, 'rate', parseFloat(e.target.value) || 0)}
                        className="w-28 h-10 bg-gray-50 border-gray-300"
                      />
                      <Input
                        value={`₹${item.amount.toFixed(2)}`}
                        disabled
                        className="w-32 h-10 bg-gray-100 border-gray-300 text-blue-600 font-semibold"
                      />
                      {formData.items.length > 1 && (
                        <Button
                          type="button"
                          onClick={() => removeItem(index)}
                          className="bg-red-600 hover:bg-red-700 h-10 px-3"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  ))}
                  <Button
                    type="button"
                    data-testid="add-item-button"
                    onClick={() => setFormData(prev => ({ ...prev, items: [...prev.items, { description: '', quantity: 1, rate: 0, amount: 0 }] }))}
                    className="mt-2 bg-gray-100 hover:bg-gray-200 text-gray-700 font-body h-10"
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Add Custom Item
                  </Button>
                </div>

                <div className="bg-gray-50 border border-gray-200 rounded-md p-4 space-y-2">
                  <div className="flex justify-between font-body text-gray-700">
                    <span>Subtotal:</span>
                    <span className="font-mono font-semibold">₹{formData.subtotal.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between font-body text-gray-700">
                    <span>IGST (18%):</span>
                    <span className="font-mono font-semibold">₹{formData.igst.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between font-heading font-bold text-xl text-gray-900 pt-2 border-t border-gray-300">
                    <span>Total:</span>
                    <span className="font-mono text-blue-600">₹{formData.total.toFixed(2)}</span>
                  </div>
                </div>

                {formData.invoice_type === 'invoice' && (
                  <div className="bg-gray-50 border border-gray-200 rounded-md p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm font-medium text-gray-700">Amount Paid</Label>
                      <div className="flex items-center gap-2">
                        <Checkbox
                          checked={isFullAmountPaid}
                          onCheckedChange={(checked) => {
                            const isChecked = Boolean(checked);
                            setIsFullAmountPaid(isChecked);
                            setFormData((prev) => {
                              const amountPaid = isChecked ? prev.total : Math.min(prev.amount_paid || 0, prev.total);
                              const totalDue = Math.max(prev.total - amountPaid, 0);
                              const nextStatus = amountPaid >= prev.total ? 'paid' : prev.status === 'paid' ? 'pending' : prev.status;
                              return { ...prev, amount_paid: amountPaid, total_due: totalDue, status: nextStatus };
                            });
                          }}
                          id="full-amount-paid"
                        />
                        <Label htmlFor="full-amount-paid" className="text-sm text-gray-600">Full amount</Label>
                      </div>
                    </div>
                    <Input
                      type="number"
                      data-testid="amount-paid-input"
                      value={formData.amount_paid}
                      onChange={(e) => {
                        const value = Math.min(Math.max(parseFloat(e.target.value) || 0, 0), formData.total);
                        setFormData((prev) => {
                          const totalDue = Math.max(prev.total - value, 0);
                          const nextStatus = value >= prev.total ? 'paid' : prev.status === 'paid' ? 'pending' : prev.status;
                          return { ...prev, amount_paid: value, total_due: totalDue, status: nextStatus };
                        });
                        setIsFullAmountPaid(value >= formData.total);
                      }}
                      disabled={isFullAmountPaid}
                      className="h-11 bg-white border-gray-300"
                      placeholder="Enter custom amount paid"
                    />
                    <div className="flex justify-between font-body text-gray-700">
                      <span>Total Dues:</span>
                      <span className="font-mono font-semibold">₹{formData.total_due.toFixed(2)}</span>
                    </div>
                  </div>
                )}

                <div>
                  <Label className="text-sm font-medium text-gray-700">Notes</Label>
                  <Input
                    data-testid="invoice-notes-input"
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    className="mt-1.5 h-11 bg-gray-50 border-gray-300"
                    placeholder="Additional notes..."
                  />
                </div>

                <div className="flex gap-4">
                  <Button
                    type="submit"
                    data-testid="invoice-submit-button"
                    className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-body font-medium h-11"
                  >
                    {editingInvoice ? 'Update' : 'Create'} {getInvoiceTypeLabel(formData.invoice_type)}
                  </Button>
                  <Button
                    type="button"
                    onClick={() => {
                      setIsDialogOpen(false);
                      resetForm();
                    }}
                    className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-body"
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            </DialogContent>
        </Dialog>

        {invoices.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-md p-12 text-center">
            <div className="text-gray-500 font-body mb-2">No invoices yet</div>
            <p className="text-gray-400 text-sm">Create your first invoice to get started</p>
          </div>
        ) : (
          <div className="bg-white border border-gray-200 rounded-md overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full" data-testid="invoices-table">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50">
                    <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider py-3 px-4">Number</th>
                    <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider py-3 px-4">Client</th>
                    <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider py-3 px-4">Date</th>
                    <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider py-3 px-4">Type</th>
                    <th className="text-right text-xs font-medium text-gray-500 uppercase tracking-wider py-3 px-4">Amount</th>
                    <th className="text-center text-xs font-medium text-gray-500 uppercase tracking-wider py-3 px-4">Status</th>
                    <th className="text-right text-xs font-medium text-gray-500 uppercase tracking-wider py-3 px-4">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((invoice) => {
                    const client = clients.find(c => c.id === invoice.client_id);
                    return (
                      <tr key={invoice.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors" data-testid={`invoice-row-${invoice.id}`}>
                        <td className="py-4 px-4 font-mono text-gray-900 font-medium">{invoice.invoice_number}</td>
                        <td className="py-4 px-4 font-body text-gray-600">{client?.name || 'N/A'}</td>
                        <td className="py-4 px-4 font-body text-gray-600">{invoice.invoice_date}</td>
                        <td className="py-4 px-4">
                          <span className="px-2 py-1 bg-gray-100 border border-gray-300 rounded text-xs uppercase font-medium text-gray-700">
                            {invoice.invoice_type}
                          </span>
                        </td>
                        <td className="py-4 px-4 font-mono text-right text-gray-900 font-semibold">
                          ₹{invoice.total.toLocaleString('en-IN')}
                        </td>
                        <td className="py-4 px-4 text-center">
                          <span
                            className={`inline-block px-3 py-1 rounded-full text-xs font-medium uppercase ${
                              invoice.status === 'paid'
                                ? 'bg-green-100 text-green-700'
                                : invoice.status === 'pending'
                                ? 'bg-orange-100 text-orange-700'
                                : 'bg-red-100 text-red-700'
                            }`}
                          >
                            {invoice.status}
                          </span>
                        </td>
                        <td className="py-4 px-4">
                          <div className="flex gap-2 justify-end">
                            {invoice.invoice_type === 'quotation' && (
                              <button
                                data-testid={`convert-${invoice.id}`}
                                onClick={() => handleConvertToInvoice(invoice.id)}
                                className="text-green-600 hover:text-green-700 transition-colors"
                                title="Convert to Invoice"
                              >
                                <ArrowRight className="w-4 h-4" />
                              </button>
                            )}
                            {invoice.invoice_type === 'proforma' && (
                              <button
                                data-testid={`convert-proforma-${invoice.id}`}
                                onClick={() => openConversionDialog(invoice)}
                                className="text-green-600 hover:text-green-700 transition-colors"
                                title="Convert to Invoice"
                              >
                                <ArrowRight className="w-4 h-4" />
                              </button>
                            )}
                            {invoice.invoice_type === 'invoice' && invoice.status !== 'paid' && (
                              <button
                                data-testid={`mark-paid-${invoice.id}`}
                                onClick={() => handleMarkAsPaid(invoice)}
                                className="text-emerald-600 hover:text-emerald-700 transition-colors"
                                title="Mark as Paid"
                              >
                                <CheckCircle className="w-4 h-4" />
                              </button>
                            )}
                            <button
                              data-testid={`edit-invoice-${invoice.id}`}
                              onClick={() => handleEdit(invoice)}
                              className="text-blue-600 hover:text-blue-700 transition-colors"
                              title="Edit"
                            >
                              <Edit className="w-4 h-4" />
                            </button>
                            <button
                              data-testid={`download-pdf-${invoice.id}`}
                              onClick={() => handleDownloadPDF(invoice)}
                              className="text-purple-600 hover:text-purple-700 transition-colors"
                              title="Download PDF"
                            >
                              <Download className="w-4 h-4" />
                            </button>
                            <button
                              data-testid={`send-email-${invoice.id}`}
                              onClick={() => handleSendEmail(invoice)}
                              className="text-orange-600 hover:text-orange-700 transition-colors"
                              title="Send Email"
                            >
                              <Mail className="w-4 h-4" />
                            </button>
                            <button
                              data-testid={`delete-invoice-${invoice.id}`}
                              onClick={() => handleDelete(invoice.id)}
                              className="text-red-600 hover:text-red-700 transition-colors"
                              title="Delete"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Invoices;
