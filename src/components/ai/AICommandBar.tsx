import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { AmbientStrip } from './AmbientStrip';
import { CommandPalette } from './CommandPalette';

const HIDDEN_ROUTES = [
  '/auth',
  '/login',
  '/register',
  '/peopleos/copilot',
  '/candidate-form',
  '/interview-registration',
  '/onboard',
  '/display/',
  '/break-desk',
  '/candidate-portal',
  '/portal/',
];

const ROUTE_CONTEXT: Record<string, string> = {
  '/dashboard': 'generic',
  '/my-dashboard': 'generic',
  '/ceo/dashboard': 'ceo_summary',
  '/operations/dashboard': 'generic',
  '/operations-dashboard': 'generic',
  '/quality/dashboard': 'generic',
  '/quality-dashboard': 'generic',
  '/wfm/dashboard': 'roster_risk',
  '/wfm-attendance': 'attendance_risk',
  '/hr/dashboard': 'people_risk',
  '/manager/dashboard': 'role_insights',
  '/recruiter-dashboard': 'onboarding_status',
  '/payroll-hr/dashboard': 'payroll_readiness',
  '/call-master': 'generic',
  '/attendance': 'attendance_risk',
};

function getContextType(pathname: string): string {
  if (ROUTE_CONTEXT[pathname]) return ROUTE_CONTEXT[pathname];
  for (const [route, context] of Object.entries(ROUTE_CONTEXT)) {
    if (pathname.startsWith(`${route}/`)) return context;
  }
  return 'generic';
}

export function AICommandBar() {
  const { user } = useAuth();
  const location = useLocation();
  const [paletteOpen, setPaletteOpen] = useState(false);

  const pathname = location.pathname;
  const isHidden = !user || HIDDEN_ROUTES.some((route) => pathname.startsWith(route));
  const contextType = getContextType(pathname);

  useEffect(() => {
    if (isHidden) return;
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        event.stopPropagation();
        setPaletteOpen((previous) => !previous);
      }
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [isHidden]);

  useEffect(() => {
    setPaletteOpen(false);
  }, [pathname]);

  if (isHidden) return null;

  return (
    <>
      <AmbientStrip
        contextType={contextType}
        onOpen={() => setPaletteOpen(true)}
        open={paletteOpen}
      />
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        contextType={contextType}
      />
    </>
  );
}
