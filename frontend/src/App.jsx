import { Link, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import { Button, EmptyState, Toaster } from './components/ui'
import { AppDataProvider } from './lib/store'
import Dashboard from './pages/Dashboard'
import Deck from './pages/Deck'
import Ingest from './pages/Ingest'
import Library from './pages/Library'
import MaterialDetail from './pages/MaterialDetail'
import Review from './pages/Review'
import Settings from './pages/Settings'
import { Compass } from 'lucide-react'

function NotFound() {
  return (
    <EmptyState
      icon={Compass}
      title="Page not found"
      description="That route does not exist in RecallCraft."
      action={
        <Button as={Link} to="/" variant="primary">
          Back to dashboard
        </Button>
      }
    />
  )
}

export default function App() {
  return (
    <AppDataProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="library" element={<Library />} />
          <Route path="library/:materialId" element={<MaterialDetail />} />
          <Route path="ingest" element={<Ingest />} />
          <Route path="deck" element={<Deck />} />
          <Route path="review" element={<Review />} />
          <Route path="settings" element={<Settings />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
      <Toaster />
    </AppDataProvider>
  )
}
