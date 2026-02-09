import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { generateSaleReceiptPDF } from '@/lib/pdfGenerator';
import { Download } from 'lucide-react';
import { toast } from 'sonner';

export const FinalSale = () => {
  const { data, isLoading } = useQuery({
    queryKey: ['final-sales'],
    staleTime: 60000,
    queryFn: async () => {
      const [invoicesRes, clientsRes, settingsRes] = await Promise.all([
        api.get('/invoices'),
        api.get('/clients'),
        api.get('/settings'),
      ]);

      return {
        invoices: invoicesRes.data,
        clients: clientsRes.data,
        settings: settingsRes.data,
      };
    },
  });

  const saleReceipts = (data?.invoices ?? []).filter((invoice) => invoice.invoice_type === 'sale_receipt');
  const clients = data?.clients ?? [];
  const settings = data?.settings ?? null;

  const handleDownloadPDF = async (receipt) => {
    try {
      const client = clients.find((c) => c.id === receipt.client_id);
      if (!client || !settings) {
        toast.error('Missing client or settings data');
        return;
      }
      const pdf = await generateSaleReceiptPDF(receipt, client, settings);
      pdf.save(`Sale-Receipt-${receipt.invoice_number}.pdf`);
      toast.success('Sale receipt downloaded successfully');
    } catch (error) {
      console.error('PDF Error:', error);
      toast.error('Failed to generate PDF: ' + error.message);
    }
  };

  if (isLoading) {
    return (
      <div className="p-8 min-h-screen bg-gray-50">
        <div className="text-gray-600 font-body text-lg">Loading...</div>
      </div>
    );
  }

  return (
    <div className="p-8 min-h-screen bg-gray-50" data-testid="final-sale-page">
      <div className="max-w-7xl mx-auto">
        <div className="flex justify-between items-start mb-8">
          <div>
            <h1 className="font-heading font-bold text-4xl text-gray-900 mb-2">
              Final Sale
            </h1>
            <p className="font-body text-gray-600">
              Sale receipts generated for paid invoices
            </p>
          </div>
        </div>

        {saleReceipts.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-md p-12 text-center">
            <div className="text-gray-500 font-body mb-2">No sale receipts yet</div>
            <p className="text-gray-400 text-sm">Mark an invoice as paid to generate a sale receipt.</p>
          </div>
        ) : (
          <div className="bg-white border border-gray-200 rounded-md overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full" data-testid="final-sale-table">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50">
                    <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider py-3 px-4">Receipt #</th>
                    <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider py-3 px-4">Source Invoice</th>
                    <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider py-3 px-4">Client</th>
                    <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider py-3 px-4">Date</th>
                    <th className="text-right text-xs font-medium text-gray-500 uppercase tracking-wider py-3 px-4">Amount</th>
                    <th className="text-right text-xs font-medium text-gray-500 uppercase tracking-wider py-3 px-4">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {saleReceipts.map((receipt) => {
                    const client = clients.find((c) => c.id === receipt.client_id);
                    return (
                      <tr key={receipt.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                        <td className="py-4 px-4 font-mono text-gray-900 font-medium">{receipt.invoice_number}</td>
                        <td className="py-4 px-4 font-body text-gray-600">{receipt.source_invoice_number || 'N/A'}</td>
                        <td className="py-4 px-4 font-body text-gray-600">{client?.name || 'N/A'}</td>
                        <td className="py-4 px-4 font-body text-gray-600">{receipt.invoice_date}</td>
                        <td className="py-4 px-4 font-mono text-right text-gray-900 font-semibold">
                          ₹{Number(receipt.total || 0).toLocaleString('en-IN')}
                        </td>
                        <td className="py-4 px-4">
                          <div className="flex gap-2 justify-end">
                            <button
                              data-testid={`download-sale-receipt-${receipt.id}`}
                              onClick={() => handleDownloadPDF(receipt)}
                              className="text-purple-600 hover:text-purple-700 transition-colors"
                              title="Download PDF"
                            >
                              <Download className="w-4 h-4" />
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

export default FinalSale;
