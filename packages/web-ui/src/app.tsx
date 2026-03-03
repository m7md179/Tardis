import { BrowserRouter, Routes, Route, Navigate, NavLink, Outlet } from 'react-router';
import { isAuthenticated, logout } from './lib/auth';
import { LoginPage } from './pages/login';
import { DashboardPage } from './pages/dashboard';
import { PluginsPage } from './pages/plugins';
import { LLMConfigPage } from './pages/llm-config';
import { ProactivePage } from './pages/proactive';
import { MemoriesPage } from './pages/memories';
import { TracesPage } from './pages/traces';
import { TraceDetailPage } from './pages/trace-detail';

function RequireAuth({ children }: { children: React.ReactNode }) {
  if (!isAuthenticated()) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: '\u2302' },
  { to: '/plugins', label: 'Plugins', icon: '\u2699' },
  { to: '/llm', label: 'LLM Config', icon: '\u2731' },
  { to: '/proactive', label: 'Proactive', icon: '\u231A' },
  { to: '/memories', label: 'Memories', icon: '\u2601' },
  { to: '/traces', label: 'Traces', icon: '\u25B6' },
] as const;

function Layout() {
  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <aside className="w-56 shrink-0 border-r border-gray-800 bg-gray-900 flex flex-col">
        <div className="p-4 border-b border-gray-800">
          <h1 className="text-lg font-bold tracking-tight text-blue-400">TARDIS</h1>
          <p className="text-xs text-gray-500">Admin Dashboard</p>
        </div>

        <nav className="flex-1 p-2 space-y-0.5">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${
                  isActive
                    ? 'bg-blue-600/20 text-blue-400'
                    : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
                }`
              }
            >
              <span className="text-base">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="p-2 border-t border-gray-800">
          <button
            onClick={logout}
            className="w-full px-3 py-2 text-sm text-gray-400 hover:text-red-400 hover:bg-gray-800 rounded-md text-left transition-colors"
          >
            Logout
          </button>
        </div>
      </aside>

      {/* Content */}
      <main className="flex-1 overflow-y-auto p-6">
        <Outlet />
      </main>
    </div>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          element={
            <RequireAuth>
              <Layout />
            </RequireAuth>
          }
        >
          <Route index element={<DashboardPage />} />
          <Route path="plugins" element={<PluginsPage />} />
          <Route path="llm" element={<LLMConfigPage />} />
          <Route path="proactive" element={<ProactivePage />} />
          <Route path="memories" element={<MemoriesPage />} />
          <Route path="traces" element={<TracesPage />} />
          <Route path="traces/:id" element={<TraceDetailPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
