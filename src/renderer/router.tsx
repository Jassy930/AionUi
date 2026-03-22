import React, { Suspense } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import AppLoader from './components/AppLoader';
import RouteErrorBoundary from './components/RouteErrorBoundary';
import { useAuth } from './context/AuthContext';
const Conversation = React.lazy(() => import('./pages/conversation'));
const Guid = React.lazy(() => import('./pages/guid'));
const Tasks = React.lazy(() => import('./pages/tasks'));
const ProjectDetail = React.lazy(() => import('./pages/tasks/ProjectDetail'));
const About = React.lazy(() => import('./pages/settings/About'));
const AgentSettings = React.lazy(() => import('./pages/settings/AgentSettings'));
const SkillsHubSettings = React.lazy(() => import('./pages/settings/SkillsHubSettings'));
const DisplaySettings = React.lazy(() => import('./pages/settings/DisplaySettings'));
const GeminiSettings = React.lazy(() => import('./pages/settings/GeminiSettings'));
const ModeSettings = React.lazy(() => import('./pages/settings/ModeSettings'));
const SystemSettings = React.lazy(() => import('./pages/settings/SystemSettings'));
const ToolsSettings = React.lazy(() => import('./pages/settings/ToolsSettings'));
const WebuiSettings = React.lazy(() => import('./pages/settings/WebuiSettings'));
const ExtensionSettingsPage = React.lazy(() => import('./pages/settings/ExtensionSettingsPage'));
const LoginPage = React.lazy(() => import('./pages/login'));
const ComponentsShowcase = React.lazy(() => import('./pages/test/ComponentsShowcase'));

const withRouteFallback = (Component: React.LazyExoticComponent<React.ComponentType>) => (
  <RouteErrorBoundary>
    <Suspense fallback={<AppLoader />}>
      <Component />
    </Suspense>
  </RouteErrorBoundary>
);

/**
 * Home redirect component that respects viewMode
 * 根据 viewMode 重定向到对应首页
 */
const HomeRedirect: React.FC = () => {
  return <Navigate to='/guid' replace />;
};

const ProtectedLayout: React.FC<{ layout: React.ReactElement }> = ({ layout }) => {
  const { status } = useAuth();

  if (status === 'checking') {
    return <AppLoader />;
  }

  if (status !== 'authenticated') {
    return <Navigate to='/login' replace />;
  }

  return React.cloneElement(layout);
};

const PanelRoute: React.FC<{ layout: React.ReactElement }> = ({ layout }) => {
  const { status } = useAuth();

  return (
    <HashRouter>
      <Routes>
        <Route path='/login' element={status === 'authenticated' ? <HomeRedirect /> : withRouteFallback(LoginPage)} />
        <Route element={<ProtectedLayout layout={layout} />}>
          <Route index element={<HomeRedirect />} />
          <Route path='/guid' element={withRouteFallback(Guid)} />
          <Route path='/tasks' element={withRouteFallback(Tasks)} />
          <Route path='/tasks/:projectId' element={withRouteFallback(ProjectDetail)} />
          <Route path='/conversation/:id' element={withRouteFallback(Conversation)} />
          <Route path='/settings/gemini' element={withRouteFallback(GeminiSettings)} />
          <Route path='/settings/model' element={withRouteFallback(ModeSettings)} />
          <Route path='/settings/agent' element={withRouteFallback(AgentSettings)} />
          <Route path='/settings/skills-hub' element={withRouteFallback(SkillsHubSettings)} />
          <Route path='/settings/display' element={withRouteFallback(DisplaySettings)} />
          <Route path='/settings/webui' element={withRouteFallback(WebuiSettings)} />
          <Route path='/settings/system' element={withRouteFallback(SystemSettings)} />
          <Route path='/settings/about' element={withRouteFallback(About)} />
          <Route path='/settings/tools' element={withRouteFallback(ToolsSettings)} />
          <Route path='/settings/ext/:tabId' element={withRouteFallback(ExtensionSettingsPage)} />
          <Route path='/settings' element={<Navigate to='/settings/gemini' replace />} />
          <Route path='/test/components' element={withRouteFallback(ComponentsShowcase)} />
        </Route>
        <Route path='*' element={status === 'authenticated' ? <HomeRedirect /> : <Navigate to='/login' replace />} />
      </Routes>
    </HashRouter>
  );
};

export default PanelRoute;
