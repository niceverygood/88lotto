import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './AppShell'
import { RequireAuth } from './RequireAuth'
import { RequireNav } from './RequireNav'
import { LoginPage } from '@/features/auth/LoginPage'
import { DashboardPage } from '@/features/dashboard/DashboardPage'
import { MembersPage } from '@/features/members/MembersPage'
import { MyCustomersPage } from '@/features/members/MyCustomersPage'
import { MySmsPage } from '@/features/members/MySmsPage'
import { CommunityPage } from '@/features/community/CommunityPage'
import { SupportPage } from '@/features/support/SupportPage'
import { PaymentsPage } from '@/features/payments/PaymentsPage'
import { ManualPaymentPage } from '@/features/payments/ManualPaymentPage'
import { RevenuePage } from '@/features/revenue/RevenuePage'
import { LottoResultsPage } from '@/features/lotto/LottoResultsPage'
import { RecommendPage } from '@/features/lotto/RecommendPage'
import { BetsPage } from '@/features/bets/BetsPage'
import { AdminsPage } from '@/features/admins/AdminsPage'
import { RolesPage } from '@/features/admins/RolesPage'
import { LogsPage } from '@/features/logs/LogsPage'
import { StatsPage } from '@/features/stats/StatsPage'
import { SettingsLayout } from '@/features/settings/SettingsLayout'
import { SiteSettingsPage } from '@/features/settings/SiteSettingsPage'
import { ReportSettingsPage } from '@/features/settings/ReportSettingsPage'
import { LottoExcludePage } from '@/features/settings/LottoExcludePage'
import { TermsSettingsPage } from '@/features/settings/TermsSettingsPage'
import { ComponentsPage } from '@/features/dev/ComponentsPage'

/**
 * 라우트 정의. /login 은 셸 밖, 그 외는 RequireAuth 로 보호.
 * 모듈 라우트는 권한 매트릭스(nav_access) 기반 RequireNav 로 가드(§5) — 메뉴 숨김과 동일 기준.
 * 대시보드는 리다이렉트 폴백이므로 가드하지 않는다.
 */
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/members" element={<RequireNav navKey="members"><MembersPage /></RequireNav>} />
        <Route path="/my/customers" element={<RequireNav navKey="myCustomers"><MyCustomersPage /></RequireNav>} />
        <Route path="/my/sms" element={<RequireNav navKey="myCustomers"><MySmsPage /></RequireNav>} />
        <Route path="/community" element={<RequireNav navKey="community"><CommunityPage /></RequireNav>} />
        <Route path="/support" element={<RequireNav navKey="support"><SupportPage /></RequireNav>} />
        <Route path="/payments" element={<RequireNav navKey="payments"><PaymentsPage /></RequireNav>} />
        <Route path="/payments/manual" element={<RequireNav navKey="payments"><ManualPaymentPage /></RequireNav>} />
        <Route path="/revenue" element={<RequireNav navKey="revenue"><RevenuePage /></RequireNav>} />
        <Route path="/lotto/results" element={<RequireNav navKey="lotto"><LottoResultsPage /></RequireNav>} />
        <Route path="/lotto/recommend" element={<RequireNav navKey="lotto"><RecommendPage /></RequireNav>} />
        <Route path="/bets" element={<RequireNav navKey="bets"><BetsPage /></RequireNav>} />
        <Route path="/admins" element={<RequireNav navKey="admins"><AdminsPage /></RequireNav>} />
        <Route path="/admins/roles" element={<RequireNav navKey="admins"><RolesPage /></RequireNav>} />
        <Route path="/logs" element={<Navigate to="/logs/admin" replace />} />
        <Route path="/logs/:kind" element={<RequireNav navKey="logs"><LogsPage /></RequireNav>} />
        <Route path="/stats" element={<RequireNav navKey="stats"><StatsPage /></RequireNav>} />
        <Route path="/settings" element={<RequireNav navKey="settings"><SettingsLayout /></RequireNav>}>
          <Route index element={<SiteSettingsPage />} />
          <Route path="report" element={<ReportSettingsPage />} />
          <Route path="lotto-exclude" element={<LottoExcludePage />} />
          <Route path="terms" element={<TermsSettingsPage />} />
        </Route>
        <Route path="/dev/components" element={<ComponentsPage />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  )
}
