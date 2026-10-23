import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import { LogOut, Grid3x3, FileText, Users, Plus, Building2, Menu, X } from 'lucide-react';
import CompanyManagement from './CompanyManagement';
import CategoryManagement from './CategoryManagement';
import ProductManagement from './ProductManagement';
import QuotationsList from './QuotationsList';
import ThemeToggle from './ThemeToggle';
import UserManagement from './UserManagement';
import WhatsAppConnect from './WhatsAppConnect';
import NewQuotationDialog from './NewQuotationDialog';

export default function AdminDashboard() {
  const { user, logout } = useAuth();
  const [view, setView] = useState('companies');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isNewQuotationOpen, setIsNewQuotationOpen] = useState(false);

  const handleViewChange = (newView) => {
    setView(newView);
    setIsSidebarOpen(false); // Close sidebar on mobile after selection
  };

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background">
      {/* Header */}
      <header className="bg-card shadow-sm border-b border-border dark:border-primary/20 dark:shadow-[0_0_20px_rgba(212,175,55,0.05)]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                className="lg:hidden p-2 hover:bg-muted rounded-lg transition-colors"
              >
                {isSidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </button>
              <div>
                <h1 className="text-lg sm:text-xl md:text-2xl text-foreground dark:text-primary">Mahaveer Hospitality</h1>
                <p className="text-xs sm:text-sm text-muted-foreground">Welcome, {user?.fullName}</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsNewQuotationOpen(true)}
                className="flex items-center gap-2 px-3 sm:px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-all"
              >
                <Plus className="w-4 h-4" />
                <span className="hidden sm:inline">New Quotation</span>
              </button>
              {/* <ThemeToggle /> */}
              <button
                onClick={logout}
                className="flex items-center gap-2 px-3 sm:px-4 py-2 bg-muted text-foreground rounded-lg hover:bg-muted/80 transition-all dark:border dark:border-primary/20 dark:hover:border-primary/40"
              >
                <LogOut className="w-4 h-4" />
                <span className="hidden sm:inline">Logout</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className={`
          fixed top-[73px] bottom-0 left-0 z-40 h-[calc(100dvh-73px)] w-64 overflow-hidden bg-card border-r border-border
          transition-transform duration-300 ease-in-out lg:static lg:h-full lg:flex-none lg:translate-x-0
          dark:border-primary/20
          ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        `}>
          <nav className="p-4 space-y-2">
            <button
              onClick={() => handleViewChange('companies')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all ${view === 'companies' ? 'bg-primary text-primary-foreground dark:shadow-[0_0_15px_rgba(212,175,55,0.3)]' : 'text-foreground hover:bg-muted dark:hover:bg-accent dark:hover:text-primary'}`}
            >
              <Building2 className="w-5 h-5" />
              <span>Companies</span>
            </button>

            <button
              onClick={() => handleViewChange('categories')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all ${view === 'categories' ? 'bg-primary text-primary-foreground dark:shadow-[0_0_15px_rgba(212,175,55,0.3)]' : 'text-foreground hover:bg-muted dark:hover:bg-accent dark:hover:text-primary'}`}
            >
              <Grid3x3 className="w-5 h-5" />
              <span>Categories</span>
            </button>

            <button
              onClick={() => handleViewChange('products')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all ${view === 'products' ? 'bg-primary text-primary-foreground dark:shadow-[0_0_15px_rgba(212,175,55,0.3)]' : 'text-foreground hover:bg-muted dark:hover:bg-accent dark:hover:text-primary'}`}
            >
              <Plus className="w-5 h-5" />
              <span>Products</span>
            </button>

            <button
              onClick={() => handleViewChange('quotations')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all ${view === 'quotations' ? 'bg-primary text-primary-foreground dark:shadow-[0_0_15px_rgba(212,175,55,0.3)]' : 'text-foreground hover:bg-muted dark:hover:bg-accent dark:hover:text-primary'}`}
            >
              <FileText className="w-5 h-5" />
              <span>Quotations</span>
            </button>

            <button
              onClick={() => handleViewChange('users')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all ${view === 'users' ? 'bg-primary text-primary-foreground dark:shadow-[0_0_15px_rgba(212,175,55,0.3)]' : 'text-foreground hover:bg-muted dark:hover:bg-accent dark:hover:text-primary'}`}
            >
              <Users className="w-5 h-5" />
              <span>Users</span>
            </button>

            <button
              onClick={() => handleViewChange('whatsapp')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all ${view === 'whatsapp' ? 'bg-primary text-primary-foreground dark:shadow-[0_0_15px_rgba(212,175,55,0.3)]' : 'text-foreground hover:bg-muted dark:hover:bg-accent dark:hover:text-primary'}`}
            >
              <Users className="w-5 h-5" />
              <span>WhatsApp</span>
            </button>
          </nav>
        </aside>

        {/* Backdrop for mobile */}
        {isSidebarOpen && (
          <div 
            className="fixed top-[73px] bottom-0 inset-x-0 bg-black/50 z-30 lg:hidden"
            onClick={() => setIsSidebarOpen(false)}
          />
        )}

        {/* Main Content */}
        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          {view === 'companies' && <CompanyManagement />}
          {view === 'categories' && <CategoryManagement />}
          {view === 'products' && <ProductManagement />}
          {view === 'quotations' && <QuotationsList />}
          {view === 'users' && <UserManagement />}
          {view === 'whatsapp' && <WhatsAppConnect />}
        </main>
      </div>

      <NewQuotationDialog
        open={isNewQuotationOpen}
        onClose={() => setIsNewQuotationOpen(false)}
        onComplete={() => {
          setIsNewQuotationOpen(false);
          setView('quotations');
        }}
      />
    </div>
  );
}
